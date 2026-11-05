//! Code analysis with clang-tidy (see `docs/decisions/017-code-analysis.md`): the program is
//! chosen in a native dialog or found on `PATH`, and runs only when the user asks, on one
//! file or on every file of the active CMake build folder's `compile_commands.json`. Rust
//! builds every command line; the renderer names only a project root and a file in it.
use crate::cmake::jobs::{JobEvent, Jobs};
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread,
};
use tauri::{Manager, State, WebviewWindow, ipc::Channel};

const MAX_JOBS: u8 = 16;
// A run reports at most this many findings per file; a broken header can produce thousands.
const MAX_FINDINGS: usize = 1000;
const MAX_RELATED: usize = 20;

/// When clang-tidy runs on its own: never, or on the saved file after a save.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AutoAnalysis {
    #[default]
    Off,
    OnSave,
}
/// Workspace Settings → IDE → Code Analysis.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct AnalysisSettings {
    /// clang-tidy checks: clangd's live ones and the commands that run the program.
    pub clang_tidy_enabled: bool,
    pub max_parallel_jobs: u8,
    pub auto_analysis: AutoAnalysis,
    /// The checks clang-tidy runs on a project without a `.clang-tidy` of its own, whose file
    /// always wins.
    pub default_checks: String,
    /// Compiler warnings for clangd and clang-tidy, added before the project's own flags (so
    /// its `-Wno-…` still win): without `-Wall`, nothing reports an unused variable.
    pub warning_flags: String,
}
/// Everything generally useful: `*` also holds other projects' house styles (llvmlibc,
/// fuchsia, altera…), which report every line, and these three only ever disagree with taste.
pub const DEFAULT_CHECKS: &str = "bugprone-*,cert-*,clang-analyzer-*,concurrency-*,\
cppcoreguidelines-*,misc-*,modernize-*,performance-*,portability-*,readability-*,\
-modernize-use-trailing-return-type,-readability-identifier-length,\
-readability-magic-numbers";
pub const DEFAULT_WARNINGS: &str = "-Wall -Wextra";
impl Default for AnalysisSettings {
    fn default() -> Self {
        Self {
            clang_tidy_enabled: true,
            max_parallel_jobs: 2,
            auto_analysis: AutoAnalysis::Off,
            default_checks: DEFAULT_CHECKS.into(),
            warning_flags: DEFAULT_WARNINGS.into(),
        }
    }
}
impl AnalysisSettings {
    fn validate(&self) -> Result<(), String> {
        if !(1..=MAX_JOBS).contains(&self.max_parallel_jobs) {
            return Err(format!("Parallel jobs must be between 1 and {MAX_JOBS}"));
        }
        // These reach a program's command line: nothing but what they are named for.
        if self.default_checks.len() > 4000
            || !self
                .default_checks
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_*,.".contains(c))
        {
            return Err("Checks are a comma-separated list like bugprone-*,-misc-*".into());
        }
        if self.warning_flags.len() > 1000
            || !self.warning_flags.split_whitespace().all(valid_warning)
        {
            return Err("Warning flags are compiler warnings like -Wall -Wno-unused".into());
        }
        Ok(())
    }
    fn warnings(&self) -> Vec<&str> {
        self.warning_flags.split_whitespace().collect()
    }
}
fn valid_warning(flag: &str) -> bool {
    flag == "-pedantic"
        || flag.strip_prefix("-W").is_some_and(|rest| {
            rest.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_=+".contains(c))
        })
}
/// Whether the database's compiler is MSVC's: for `cl` and `clang-cl`, `-Wall` means every
/// warning there is (`-Weverything`), so the flags say `-W4` instead.
fn msvc_driver(command: &str) -> bool {
    let first = match command.strip_prefix('"') {
        Some(rest) => rest.split('"').next().unwrap_or(rest),
        None => command.split_whitespace().next().unwrap_or(command),
    };
    let name = first.rsplit(['/', '\\']).next().unwrap_or(first);
    let name = name.to_ascii_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    name == "cl" || name == "clang-cl"
}
fn for_driver<'a>(flags: &[&'a str], msvc: bool) -> Vec<&'a str> {
    flags
        .iter()
        .map(|&flag| if msvc && flag == "-Wall" { "-W4" } else { flag })
        .collect()
}
/// The compilation database with the warning flags right after each entry's compiler.
/// Entries it cannot read stay as they are.
fn database_with_flags(text: &str, flags: &[&str]) -> Result<String, String> {
    let mut entries: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("compile_commands.json: {e}"))?;
    for entry in entries
        .as_array_mut()
        .ok_or("compile_commands.json: not a list")?
    {
        if let Some(arguments) = entry.get_mut("arguments").and_then(|a| a.as_array_mut()) {
            let msvc = arguments
                .first()
                .and_then(|a| a.as_str())
                .is_some_and(msvc_driver);
            for (at, flag) in for_driver(flags, msvc).into_iter().enumerate() {
                arguments.insert((at + 1).min(arguments.len()), flag.into());
            }
        } else if let Some(command) = entry.get("command").and_then(|c| c.as_str()) {
            // The compiler is the first word, or a quoted first word.
            let end = match command.strip_prefix('"') {
                Some(rest) => rest.find('"').map_or(command.len(), |at| at + 2),
                None => command.find(char::is_whitespace).unwrap_or(command.len()),
            };
            let (compiler, rest) = command.split_at(end);
            let added = for_driver(flags, msvc_driver(command)).join(" ");
            entry["command"] = format!("{compiler} {added}{rest}").into();
        }
    }
    serde_json::to_string(&entries).map_err(|e| e.to_string())
}
/// The folder clangd reads its compilation database from: a copy in the app's cache with the
/// warning flags added, written again at each start, so nothing changes in the build folder.
/// The build folder itself when no flags are set or the copy cannot be made.
pub fn clangd_database(app: &tauri::AppHandle, build: &Path) -> PathBuf {
    let made = (|| -> Result<PathBuf, String> {
        let settings = stored(app)?.settings;
        let flags = settings.warnings();
        if flags.is_empty() {
            return Ok(build.to_path_buf());
        }
        let text =
            fs::read_to_string(build.join("compile_commands.json")).map_err(|e| e.to_string())?;
        let text = database_with_flags(&text, &flags)?;
        let folder = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("clangd-database")
            .join(
                uuid::Uuid::new_v5(
                    &uuid::Uuid::NAMESPACE_URL,
                    build.to_string_lossy().as_bytes(),
                )
                .to_string(),
            );
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        atomic_write(&folder.join("compile_commands.json"), text.as_bytes())?;
        Ok(folder)
    })();
    made.unwrap_or_else(|_| build.to_path_buf())
}
/// A `.clang-tidy` applies to `file`, as clang-tidy itself finds it: in a folder above it.
fn has_tidy_config(file: &Path) -> bool {
    file.ancestors()
        .skip(1)
        .any(|folder| folder.join(".clang-tidy").is_file())
}
/// What the settings add to a clang-tidy command line for `file`.
fn tidy_arguments(settings: &AnalysisSettings, file: &Path, msvc: bool) -> Vec<String> {
    let mut args = Vec::new();
    if !has_tidy_config(file) && !settings.default_checks.trim().is_empty() {
        args.push(format!("--checks={}", settings.default_checks.trim()));
    }
    for flag in for_driver(&settings.warnings(), msvc) {
        args.push(format!("--extra-arg={flag}"));
    }
    args
}
#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Stored {
    settings: AnalysisSettings,
    /// The clang-tidy program chosen in the native dialog.
    program: Option<PathBuf>,
}
static LOCK: Mutex<()> = Mutex::new(());
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
fn stored_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("analysis.json"))
}
fn stored(app: &tauri::AppHandle) -> Result<Stored, String> {
    let _guard = lock(&LOCK);
    let path = stored_path(app)?;
    let Ok(bytes) = fs::read(&path) else {
        return Ok(Stored::default());
    };
    serde_json::from_slice::<Stored>(&bytes)
        .ok()
        .filter(|s| s.settings.validate().is_ok())
        .ok_or_else(|| format!("The analysis settings are damaged: {}", path.display()))
}
fn update_stored(app: &tauri::AppHandle, change: impl FnOnce(&mut Stored)) -> Result<(), String> {
    let mut all = stored(app).unwrap_or_default();
    change(&mut all);
    let _guard = lock(&LOCK);
    let path = stored_path(app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(&all).map_err(|e| e.to_string())?,
    )
}
/// Whether clangd runs the project's clang-tidy checks while editing.
pub fn live_clang_tidy(app: &tauri::AppHandle) -> bool {
    stored(app).map_or(true, |s| s.settings.clang_tidy_enabled)
}

fn program_name() -> &'static str {
    if cfg!(windows) {
        "clang-tidy.exe"
    } else {
        "clang-tidy"
    }
}
fn fallbacks() -> Vec<PathBuf> {
    if cfg!(windows) {
        ["ProgramFiles", "ProgramFiles(x86)"]
            .iter()
            .filter_map(env::var_os)
            .map(|dir| PathBuf::from(dir).join(r"LLVM\bin\clang-tidy.exe"))
            .collect()
    } else {
        (12..=30)
            .rev()
            .flat_map(|v| {
                [
                    PathBuf::from(format!("/usr/bin/clang-tidy-{v}")),
                    PathBuf::from(format!("/usr/lib/llvm-{v}/bin/clang-tidy")),
                ]
            })
            .collect()
    }
}
/// The chosen program while it exists; else `PATH`, the usual LLVM folders, or beside clangd.
fn find_program(app: &tauri::AppHandle, chosen: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(path) = chosen {
        return crate::lsp::executable(&path).then_some(path);
    }
    env::var_os("PATH")
        .and_then(|paths| {
            env::split_paths(&paths)
                .map(|dir| dir.join(program_name()))
                .find(|p| crate::lsp::executable(p))
        })
        .or_else(|| fallbacks().into_iter().find(|p| crate::lsp::executable(p)))
        .or_else(|| {
            crate::lsp::clangd_program(app)
                .and_then(|clangd| Some(clangd.parent()?.join(program_name())))
                .filter(|p| crate::lsp::executable(p))
        })
}
/// `clang-tidy --version`'s version line, a fixed query.
fn version(program: &Path) -> Option<String> {
    let mut command = Command::new(program);
    command.arg("--version");
    crate::cmake::kits::hide_window(&mut command);
    let output = command.output().ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| line.contains("version"))
        .map(|line| line.trim().to_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisInfo {
    settings: AnalysisSettings,
    /// The clang-tidy that will run, or `None` when none was found.
    program: Option<String>,
    /// Chosen in settings rather than found.
    configured: bool,
    version: Option<String>,
}
fn info(app: &tauri::AppHandle) -> Result<AnalysisInfo, String> {
    let stored = stored(app)?;
    let configured = stored.program.is_some();
    let program = find_program(app, stored.program);
    Ok(AnalysisInfo {
        settings: stored.settings,
        version: program.as_deref().and_then(version),
        program: program.map(|p| p.to_string_lossy().into_owned()),
        configured,
    })
}

// ---------------------------------------------------------------------------------------
// clang-tidy's `--export-fixes` YAML: LLVM's block style with plain, single-quoted ('' is a
// quote) and double-quoted (backslash escapes) scalars. Only that subset is read.

#[derive(Debug, PartialEq)]
enum Yaml {
    Map(Vec<(String, Yaml)>),
    Seq(Vec<Yaml>),
    Str(String),
}
impl Yaml {
    fn get(&self, key: &str) -> Option<&Yaml> {
        match self {
            Yaml::Map(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    fn str(&self, key: &str) -> Option<&str> {
        match self.get(key)? {
            Yaml::Str(s) => Some(s),
            _ => None,
        }
    }
    fn items(&self, key: &str) -> &[Yaml] {
        match self.get(key) {
            Some(Yaml::Seq(items)) => items,
            _ => &[],
        }
    }
}
fn indent(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}
fn unquote(text: &str) -> Result<String, String> {
    let text = text.trim();
    if let Some(inner) = text.strip_prefix('\'') {
        let inner = inner.strip_suffix('\'').ok_or("Unterminated quoted text")?;
        return Ok(inner.replace("''", "'"));
    }
    if let Some(inner) = text.strip_prefix('"') {
        let inner = inner.strip_suffix('"').ok_or("Unterminated quoted text")?;
        let mut out = String::new();
        let mut chars = inner.chars();
        while let Some(c) = chars.next() {
            if c != '\\' {
                out.push(c);
                continue;
            }
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('0') => out.push('\0'),
                Some('\\') => out.push('\\'),
                Some('"') => out.push('"'),
                Some('/') => out.push('/'),
                Some(' ') => out.push(' '),
                Some(kind @ ('x' | 'u' | 'U')) => {
                    let width = match kind {
                        'x' => 2,
                        'u' => 4,
                        _ => 8,
                    };
                    let hex: String = chars.by_ref().take(width).collect();
                    let code = u32::from_str_radix(&hex, 16).map_err(|_| "Bad escape")?;
                    out.push(char::from_u32(code).ok_or("Bad escape")?);
                }
                _ => return Err("Bad escape".into()),
            }
        }
        return Ok(out);
    }
    Ok(text.to_owned())
}
/// Whether a scalar is complete: plain, or quoted up to its closing quote.
fn closed(text: &str) -> bool {
    let mut chars = text.chars();
    match chars.next() {
        Some('\'') => {
            let mut chars = chars.peekable();
            while let Some(c) = chars.next() {
                if c == '\'' && chars.next_if_eq(&'\'').is_none() {
                    return true;
                }
            }
            false
        }
        Some('"') => {
            while let Some(c) = chars.next() {
                match c {
                    '\\' => {
                        chars.next();
                    }
                    '"' => return true,
                    _ => (),
                }
            }
            false
        }
        _ => true,
    }
}
/// A quoted scalar continued on the following lines (LLVM folds long ones): joined as YAML
/// folds them, a line break between two lines is one space.
fn scalar(first: &str, lines: &[String], at: &mut usize) -> Result<String, String> {
    let mut text = first.trim().to_owned();
    while !closed(&text) && *at < lines.len() {
        text.push(' ');
        text.push_str(lines[*at].trim());
        *at += 1;
    }
    unquote(&text)
}
fn parse_block(lines: &mut Vec<String>, at: &mut usize, level: usize) -> Result<Yaml, String> {
    let sequence = lines
        .get(*at)
        .is_some_and(|l| indent(l) == level && l.trim_start().starts_with("- "));
    if sequence {
        let mut items = Vec::new();
        while let Some(line) = lines.get(*at) {
            if indent(line) != level || !line.trim_start().starts_with("- ") {
                break;
            }
            // `- key: value` starts a map one level deeper.
            lines[*at] = format!("{}  {}", " ".repeat(level), &line[level + 2..]);
            items.push(parse_block(lines, at, level + 2)?);
        }
        return Ok(Yaml::Seq(items));
    }
    let mut entries = Vec::new();
    while let Some(line) = lines.get(*at) {
        if indent(line) != level {
            if indent(line) > level {
                return Err(format!("Unexpected indentation: {line}"));
            }
            break;
        }
        let line = line.trim().to_owned();
        let (key, rest) = line
            .split_once(':')
            .ok_or_else(|| format!("Expected a key: {line}"))?;
        *at += 1;
        let rest = rest.trim();
        let value = if rest.is_empty() {
            match lines.get(*at) {
                Some(next) if indent(next) > level => {
                    let deeper = indent(next);
                    parse_block(lines, at, deeper)?
                }
                Some(next) if indent(next) == level && next.trim_start().starts_with("- ") => {
                    parse_block(lines, at, level)?
                }
                _ => Yaml::Str(String::new()),
            }
        } else if rest == "[]" {
            Yaml::Seq(Vec::new())
        } else if rest == "{}" {
            Yaml::Map(Vec::new())
        } else {
            Yaml::Str(scalar(rest, lines, at)?)
        };
        entries.push((key.trim().to_owned(), value));
    }
    Ok(Yaml::Map(entries))
}
fn parse_yaml(text: &str) -> Result<Yaml, String> {
    let mut lines: Vec<String> = text
        .lines()
        .map(|l| l.trim_end_matches('\r').to_owned())
        .filter(|l| !l.trim().is_empty() && l.trim() != "---" && l.trim() != "...")
        .collect();
    let mut at = 0;
    let document = parse_block(&mut lines, &mut at, 0)?;
    if at != lines.len() {
        return Err(format!("Unexpected line: {}", lines[at]));
    }
    Ok(document)
}

// ---------------------------------------------------------------------------------------
// Findings, in the positions of the language server protocol (zero-based lines, UTF-16
// columns), so the renderer treats them like clangd's diagnostics.

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    line: u32,
    character: u32,
}
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Edit {
    path: String,
    start: Position,
    end: Position,
    new_text: String,
}
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Related {
    path: String,
    position: Position,
    message: String,
}
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    path: String,
    position: Position,
    /// 1 error, 2 warning, 3 information.
    severity: u8,
    /// clang-tidy's own level (`Warning`, `Error`, `Remark`).
    level: String,
    rule: String,
    message: String,
    related: Vec<Related>,
    /// The check's replacements; empty when it offers none.
    fix: Vec<Edit>,
}

/// File texts read to turn byte offsets into positions, by the path clang-tidy wrote.
#[derive(Default)]
struct Texts {
    files: HashMap<String, Option<(String, Vec<u8>)>>,
}
impl Texts {
    /// The file's display path and bytes; `None` when it cannot be read.
    fn get(&mut self, path: &str) -> Option<&(String, Vec<u8>)> {
        self.files
            .entry(path.to_owned())
            .or_insert_with(|| {
                let canonical = Path::new(path).canonicalize().ok()?;
                let bytes = fs::read(&canonical).ok()?;
                Some((
                    crate::project::display(&crate::git::plain(&canonical)),
                    bytes,
                ))
            })
            .as_ref()
    }
    fn position(&mut self, path: &str, offset: usize) -> Option<(String, Position)> {
        let (shown, bytes) = self.get(path)?;
        if offset > bytes.len() {
            return None;
        }
        let before = &bytes[..offset];
        let line = before.iter().filter(|&&b| b == b'\n').count() as u32;
        // A UTF-8 BOM is not part of the first line's text.
        let bom = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            3
        } else {
            0
        };
        let start = before
            .iter()
            .rposition(|&b| b == b'\n')
            .map_or(bom.min(offset), |i| i + 1);
        let character = String::from_utf8_lossy(&before[start..])
            .encode_utf16()
            .count() as u32;
        Some((shown.clone(), Position { line, character }))
    }
    /// The SHA-256 of each file read, so a fix is applied only to the text it was made for.
    fn hashes(&self) -> BTreeMap<String, String> {
        self.files
            .values()
            .flatten()
            .map(|(shown, bytes)| {
                let hash = Sha256::digest(bytes);
                (
                    shown.clone(),
                    hash.iter().map(|b| format!("{b:02x}")).collect(),
                )
            })
            .collect()
    }
}
fn severity(level: &str) -> u8 {
    match level {
        "Error" => 1,
        "Warning" => 2,
        _ => 3,
    }
}
fn findings_from_yaml(document: &Yaml, texts: &mut Texts) -> Vec<Finding> {
    let mut found = Vec::new();
    for diagnostic in document.items("Diagnostics").iter().take(MAX_FINDINGS) {
        let Some(message) = diagnostic.get("DiagnosticMessage") else {
            continue;
        };
        let place = |item: &Yaml, texts: &mut Texts| {
            let path = item.str("FilePath")?;
            let offset = item.str("FileOffset")?.parse().ok()?;
            texts.position(path, offset)
        };
        // A diagnostic without a file (a command line problem) has nowhere to show.
        let Some((path, position)) = place(message, texts) else {
            continue;
        };
        let mut fix = Vec::new();
        for replacement in message.items("Replacements") {
            let (Some(file), Some(offset), Some(length)) = (
                replacement.str("FilePath"),
                replacement
                    .str("Offset")
                    .and_then(|o| o.parse::<usize>().ok()),
                replacement
                    .str("Length")
                    .and_then(|l| l.parse::<usize>().ok()),
            ) else {
                fix.clear();
                break;
            };
            // A replacement in an unreadable file makes the whole fix unusable.
            let (Some((shown, start)), Some((_, end))) = (
                texts.position(file, offset),
                texts.position(file, offset + length),
            ) else {
                fix.clear();
                break;
            };
            fix.push(Edit {
                path: shown,
                start,
                end,
                new_text: replacement.str("ReplacementText").unwrap_or("").to_owned(),
            });
        }
        let related = diagnostic
            .items("Notes")
            .iter()
            .filter_map(|note| {
                let (path, position) = place(note, texts)?;
                Some(Related {
                    path,
                    position,
                    message: note.str("Message")?.to_owned(),
                })
            })
            .take(MAX_RELATED)
            .collect();
        let level = diagnostic.str("Level").unwrap_or("Warning").to_owned();
        found.push(Finding {
            path,
            position,
            severity: severity(&level),
            level,
            rule: diagnostic.str("DiagnosticName").unwrap_or("").to_owned(),
            message: message.str("Message").unwrap_or("").to_owned(),
            related,
            fix,
        });
    }
    found
}
/// clang-tidy's text output (`file:line:column: warning: message [check]`), for a run that
/// wrote no fixes file (a crash or a fatal error). Columns there count bytes.
fn findings_from_text(output: &str, texts: &mut Texts) -> Vec<Finding> {
    let pattern = regex::Regex::new(
        r"^(.+?):(\d+):(\d+): (warning|error|fatal error|remark): (.*?)(?: \[([^\[\]]+)\])?$",
    )
    .expect("valid pattern");
    let mut found = Vec::new();
    for line in output.lines() {
        let Some(caps) = pattern.captures(line.trim_end()) else {
            continue;
        };
        let (Ok(row), Ok(column)) = (caps[2].parse::<usize>(), caps[3].parse::<usize>()) else {
            continue;
        };
        let Some((shown, bytes)) = texts.get(&caps[1]).cloned() else {
            continue;
        };
        // The byte offset of that line and column, then the protocol's position.
        let start = bytes
            .split_inclusive(|&b| b == b'\n')
            .take(row.saturating_sub(1))
            .map(<[u8]>::len)
            .sum::<usize>();
        let Some((_, position)) = texts.position(&caps[1], start + column.saturating_sub(1)) else {
            continue;
        };
        let level = match &caps[4] {
            "warning" => "Warning",
            "remark" => "Remark",
            _ => "Error",
        };
        found.push(Finding {
            path: shown,
            position,
            severity: severity(level),
            level: level.to_owned(),
            rule: caps.get(6).map_or("", |m| m.as_str()).to_owned(),
            message: caps[5].to_owned(),
            related: Vec::new(),
            fix: Vec::new(),
        });
        if found.len() == MAX_FINDINGS {
            break;
        }
    }
    found
}

// ---------------------------------------------------------------------------------------
// Runs.

/// The source files of a compilation database inside the project, without the build folder.
fn database_files(database: &Path, root: &Path, build: &Path) -> Result<Vec<PathBuf>, String> {
    let text = fs::read(database).map_err(|e| format!("{}: {e}", database.display()))?;
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&text)
        .map_err(|e| format!("{} is not a compilation database: {e}", database.display()))?;
    let build = build.canonicalize().unwrap_or_else(|_| build.to_owned());
    let mut files = BTreeSet::new();
    for entry in entries {
        let (Some(file), Some(directory)) = (
            entry.get("file").and_then(|f| f.as_str()),
            entry.get("directory").and_then(|d| d.as_str()),
        ) else {
            continue;
        };
        let path = Path::new(directory).join(file);
        let Ok(path) = path.canonicalize() else {
            continue;
        };
        if path.starts_with(root) && !path.starts_with(&build) {
            files.insert(path);
        }
    }
    Ok(files.into_iter().collect())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileResult {
    /// The analyzed file.
    path: String,
    findings: Vec<Finding>,
    /// SHA-256 of every file a finding or fix refers to, as analyzed.
    hashes: BTreeMap<String, String>,
    code: Option<i32>,
}
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AnalysisEvent {
    /// The files to analyze and the build folder their compile commands come from.
    Started {
        total: usize,
        build: String,
    },
    Output {
        text: String,
    },
    File {
        result: FileResult,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    files: usize,
    cancelled: bool,
}

/// A running analysis: its window, whether it was cancelled and how many workers it has.
type Running = (String, Arc<AtomicBool>, usize);
/// The analyses running per window and project; their clang-tidy processes are `jobs`.
#[derive(Clone, Default)]
pub struct Analyses {
    running: Arc<Mutex<HashMap<String, Running>>>,
    jobs: Jobs,
}
impl Analyses {
    fn key(window: &str, root: &Path) -> String {
        format!("{window}|{}", root.display())
    }
    fn worker(key: &str, n: usize) -> String {
        format!("{key}|{n}")
    }
    fn cancel(&self, key: &str) {
        if let Some((window, cancelled, workers)) = lock(&self.running).get(key) {
            cancelled.store(true, Ordering::SeqCst);
            for n in 0..*workers {
                self.jobs.cancel(window, &Self::worker(key, n));
            }
        }
    }
    pub fn close_window(&self, window: &str) {
        for (_, cancelled, _) in lock(&self.running).values().filter(|r| r.0 == window) {
            cancelled.store(true, Ordering::SeqCst);
        }
        self.jobs.close_window(window);
    }
    pub fn close_all(&self) {
        for (_, cancelled, _) in lock(&self.running).values() {
            cancelled.store(true, Ordering::SeqCst);
        }
        self.jobs.close_all();
    }
}

/// One clang-tidy process on one file; its findings come from the fixes file it writes.
#[allow(clippy::too_many_arguments)]
fn analyze(
    jobs: &Jobs,
    window: &str,
    key: &str,
    program: &Path,
    build: &Path,
    env: &[(String, String)],
    scratch: &Path,
    file: &Path,
    extra: &[String],
    sink: &Arc<dyn Fn(AnalysisEvent) + Send + Sync>,
) -> Result<(FileResult, bool), String> {
    let fixes = scratch.join(format!("{}.yaml", uuid::Uuid::new_v4()));
    let mut args = vec![
        "-p".to_owned(),
        build.display().to_string(),
        format!("--export-fixes={}", fixes.display()),
    ];
    args.extend_from_slice(extra);
    args.push(crate::git::plain(file).display().to_string());
    let output = Arc::new(Mutex::new(String::new()));
    let collected = output.clone();
    let finished = jobs.run(
        window,
        key,
        program,
        &args,
        build,
        env,
        Arc::new(move |JobEvent::Output { text }| lock(&collected).push_str(&text)),
    )?;
    let output = lock(&output).clone();
    sink(AnalysisEvent::Output {
        text: format!(
            "[clang-tidy] {}\n{output}{}",
            crate::cmake::jobs::shown(program, &args),
            if output.is_empty() || output.ends_with('\n') {
                ""
            } else {
                "\n"
            }
        ),
    });
    let mut texts = Texts::default();
    let findings = match fs::read_to_string(&fixes).ok().map(|t| parse_yaml(&t)) {
        Some(Ok(document)) => findings_from_yaml(&document, &mut texts),
        Some(Err(error)) => {
            sink(AnalysisEvent::Output {
                text: format!(
                    "[analysis] Could not read the fixes file ({error}); fixes are left out.\n"
                ),
            });
            findings_from_text(&output, &mut texts)
        }
        None => findings_from_text(&output, &mut texts),
    };
    let _ = fs::remove_file(&fixes);
    // The analyzed file belongs to the result even without findings.
    let analyzed = texts
        .get(&file.display().to_string())
        .map(|(shown, _)| shown.clone())
        .unwrap_or_else(|| crate::project::display(&crate::git::plain(file)));
    Ok((
        FileResult {
            path: analyzed,
            findings,
            hashes: texts.hashes(),
            code: finished.code,
        },
        finished.cancelled,
    ))
}

#[tauri::command]
pub async fn analysis_info(app: tauri::AppHandle) -> Result<AnalysisInfo, String> {
    crate::directory::blocking(move || info(&app)).await
}
#[tauri::command]
pub async fn analysis_set_settings(
    app: tauri::AppHandle,
    settings: AnalysisSettings,
) -> Result<AnalysisInfo, String> {
    settings.validate()?;
    crate::directory::blocking(move || {
        update_stored(&app, |s| s.settings = settings)?;
        info(&app)
    })
    .await
}
/// Lets the user pick clang-tidy in a native dialog; `reset` goes back to detection. The
/// path never comes from the renderer.
#[tauri::command]
pub async fn analysis_choose_program(
    app: tauri::AppHandle,
    reset: bool,
) -> Result<Option<AnalysisInfo>, String> {
    let program = if reset {
        None
    } else {
        let Some(file) = rfd::AsyncFileDialog::new()
            .set_title("Choose the clang-tidy program")
            .pick_file()
            .await
        else {
            return Ok(None);
        };
        let path = file.path().canonicalize().map_err(|e| e.to_string())?;
        if !crate::lsp::executable(&path) {
            return Err("That file is not an executable program".into());
        }
        Some(path)
    };
    crate::directory::blocking(move || {
        update_stored(&app, |s| s.program = program)?;
        info(&app).map(Some)
    })
    .await
}

/// Runs clang-tidy on `file` (inside the project), or on every source file of the active
/// build folder's compilation database, a few at a time. Nothing configures the project:
/// without a `compile_commands.json` the run fails with an explanation.
#[tauri::command]
pub async fn analysis_run(
    app: tauri::AppHandle,
    window: WebviewWindow,
    analyses: State<'_, Analyses>,
    root: String,
    file: Option<String>,
    events: Channel<AnalysisEvent>,
) -> Result<Summary, String> {
    let analyses = analyses.inner().clone();
    let label = window.label().to_owned();
    crate::directory::blocking(move || {
        let root = crate::project::root(&root)?;
        let stored = stored(&app)?;
        if !stored.settings.clang_tidy_enabled {
            return Err("clang-tidy is turned off (Settings → IDE → Code Analysis)".into());
        }
        let program = find_program(&app, stored.program).ok_or(
            "clang-tidy was not found. Install LLVM's clang-tidy or choose the program in Settings → IDE → Code Analysis.",
        )?;
        let cmake = crate::project::settings_for(&app, &root)?.cmake;
        let active = crate::cmake::resolve(&app, &root, &cmake)?;
        let database = active.build.join("compile_commands.json");
        if !database.is_file() {
            return Err(format!(
                "No compile_commands.json in {}. Configure the project with CMake first (the Visual Studio generator writes none).",
                active.build.display()
            ));
        }
        let files = match file {
            Some(file) => {
                let path = Path::new(&file)
                    .canonicalize()
                    .map_err(|e| format!("{file}: {e}"))?;
                if !path.starts_with(&root) || !path.is_file() {
                    return Err("The file is not in the project".into());
                }
                vec![path]
            }
            None => database_files(&database, &root, &active.build)?,
        };
        let msvc = fs::read_to_string(&database)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|entries| {
                let first = entries.get(0)?.clone();
                let compiler = first
                    .get("command")
                    .or_else(|| first.get("arguments")?.get(0))?;
                Some(msvc_driver(compiler.as_str()?))
            })
            .unwrap_or(false);
        let settings = stored.settings.clone();
        let key = Analyses::key(&label, &root);
        let workers = (stored.settings.max_parallel_jobs as usize).clamp(1, files.len().max(1));
        let cancelled = Arc::new(AtomicBool::new(false));
        {
            let mut running = lock(&analyses.running);
            if running.contains_key(&key) {
                return Err("An analysis is already running for this project".into());
            }
            running.insert(key.clone(), (label.clone(), cancelled.clone(), workers));
        }
        let sink: Arc<dyn Fn(AnalysisEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = events.send(event);
        });
        let result = (|| {
            let env = active.environment(&app)?;
            let scratch = app
                .path()
                .app_cache_dir()
                .map_err(|e| e.to_string())?
                .join("analysis");
            fs::create_dir_all(&scratch).map_err(|e| format!("{}: {e}", scratch.display()))?;
            sink(AnalysisEvent::Started {
                total: files.len(),
                build: crate::project::display(&crate::git::plain(&active.build)),
            });
            let next = AtomicUsize::new(0);
            let done = AtomicUsize::new(0);
            let failure = Mutex::new(None::<String>);
            thread::scope(|scope| {
                for n in 0..workers {
                    let worker = Analyses::worker(&key, n);
                    let (next, done, failure, cancelled) = (&next, &done, &failure, &cancelled);
                    let (files, sink, env, scratch) = (&files, &sink, &env, &scratch);
                    let (jobs, label, program, build) =
                        (&analyses.jobs, &label, &program, &active.build);
                    let settings = &settings;
                    scope.spawn(move || {
                        while !cancelled.load(Ordering::SeqCst) {
                            let Some(file) = files.get(next.fetch_add(1, Ordering::SeqCst))
                            else {
                                break;
                            };
                            let extra = tidy_arguments(settings, file, msvc);
                            match analyze(
                                jobs, label, &worker, program, build, env, scratch, file, &extra,
                                sink,
                            ) {
                                Ok((_, true)) => break,
                                Ok((result, false)) => {
                                    done.fetch_add(1, Ordering::SeqCst);
                                    sink(AnalysisEvent::File { result });
                                }
                                Err(error) => {
                                    cancelled.store(true, Ordering::SeqCst);
                                    *lock(failure) = Some(error);
                                }
                            }
                        }
                    });
                }
            });
            if let Some(error) = lock(&failure).take() {
                return Err(error);
            }
            Ok(Summary {
                files: done.load(Ordering::SeqCst),
                cancelled: cancelled.load(Ordering::SeqCst),
            })
        })();
        lock(&analyses.running).remove(&key);
        result
    })
    .await
}
#[tauri::command]
pub fn analysis_cancel(
    window: WebviewWindow,
    analyses: State<Analyses>,
    root: String,
) -> Result<(), String> {
    let root = crate::project::root(&root)?;
    analyses.cancel(&Analyses::key(window.label(), &root));
    Ok(())
}
/// Whether the files still have the text a fix was made for (by SHA-256).
#[tauri::command]
pub async fn analysis_check(hashes: BTreeMap<String, String>) -> Result<Vec<String>, String> {
    crate::directory::blocking(move || {
        Ok(hashes
            .into_iter()
            .filter(|(path, hash)| {
                let current = fs::read(path).ok().map(|bytes| {
                    Sha256::digest(bytes)
                        .iter()
                        .map(|b| format!("{b:02x}"))
                        .collect::<String>()
                });
                current.as_deref() != Some(hash.as_str())
            })
            .map(|(path, _)| path)
            .collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXES: &str = r#"---
MainSourceFile:  'MAIN'
Diagnostics:
  - DiagnosticName:  modernize-use-nullptr
    DiagnosticMessage:
      Message:         use nullptr
      FilePath:        'MAIN'
      FileOffset:      46
      Replacements:
        - FilePath:        'MAIN'
          Offset:          46
          Length:          4
          ReplacementText: nullptr
    Level:           Warning
    BuildDirectory:  'BUILD'
  - DiagnosticName:  readability-braces-around-statements
    DiagnosticMessage:
      Message:         'statement should be inside braces, it''s safer'
      FilePath:        'MAIN'
      FileOffset:      51
      Replacements:
        - FilePath:        'MAIN'
          Offset:          51
          Length:          0
          ReplacementText: ' {'
        - FilePath:        'MAIN'
          Offset:          61
          Length:          0
          ReplacementText: "\n}"
    Notes:
      - Message:         'see here'
        FilePath:        'MAIN'
        FileOffset:      0
        Replacements:    []
    Level:           Error
    BuildDirectory:  'BUILD'
...
"#;
    const SOURCE: &str = "#include <cstddef>\nint f(int *p) {\n  if (p == NULL) return 0;\n  int unused = 1;\n  return *p;\n}\n";

    #[test]
    fn fixes_yaml_is_read_into_findings_with_protocol_positions() {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("a.cpp");
        fs::write(&main, SOURCE).unwrap();
        let yaml = FIXES
            .replace("MAIN", &main.display().to_string().replace('\'', "''"))
            .replace("BUILD", "build");
        let document = parse_yaml(&yaml).unwrap();
        let mut texts = Texts::default();
        let found = findings_from_yaml(&document, &mut texts);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].rule, "modernize-use-nullptr");
        assert_eq!(
            found[0].position,
            Position {
                line: 2,
                character: 11
            }
        );
        assert_eq!(found[0].fix[0].new_text, "nullptr");
        assert_eq!(
            found[0].fix[0].end,
            Position {
                line: 2,
                character: 15
            }
        );
        assert_eq!(
            found[1].message,
            "statement should be inside braces, it's safer"
        );
        assert_eq!(found[1].severity, 1);
        assert_eq!(found[1].fix[1].new_text, "\n}");
        assert_eq!(found[1].related[0].message, "see here");
        assert_eq!(
            found[1].related[0].position,
            Position {
                line: 0,
                character: 0
            }
        );
        assert_eq!(texts.hashes().len(), 1);
    }

    #[test]
    fn text_output_is_the_fallback_and_counts_utf16_columns() {
        let dir = tempfile::tempdir().unwrap();
        let main = dir.path().join("b.cpp");
        fs::write(&main, "// ğ\nint x = NULL;\n").unwrap();
        let shown = main.display().to_string();
        let output = format!(
            "1 warning generated.\n{shown}:2:9: warning: use nullptr [modernize-use-nullptr]\n    2 | int x = NULL;\n{shown}:1:6: error: oops\n"
        );
        let found = findings_from_text(&output, &mut Texts::default());
        assert_eq!(found.len(), 2);
        assert_eq!(
            found[0].position,
            Position {
                line: 1,
                character: 8
            }
        );
        assert_eq!(found[0].rule, "modernize-use-nullptr");
        // Byte column 6 follows the two-byte ğ: the fifth UTF-16 unit.
        assert_eq!(
            found[1].position,
            Position {
                line: 0,
                character: 4
            }
        );
        assert_eq!(found[1].rule, "");
        assert_eq!(found[1].severity, 1);
    }

    #[test]
    fn scalars_and_broken_yaml() {
        assert_eq!(unquote(r#""a\tb\\c\"dç""#).unwrap(), "a\tb\\c\"dç");
        assert_eq!(unquote("'it''s'").unwrap(), "it's");
        assert_eq!(unquote("plain text").unwrap(), "plain text");
        assert!(unquote("'open").is_err());
        let folded = parse_yaml("A: 'one\n  two'\nB: x\n").unwrap();
        assert_eq!(folded.str("A"), Some("one two"));
        assert_eq!(folded.str("B"), Some("x"));
        assert!(parse_yaml("A: x\n    B: y\n").is_err());
        assert_eq!(parse_yaml("D: []\n").unwrap().items("D").len(), 0);
    }

    #[test]
    fn database_files_stay_in_the_project_and_out_of_the_build_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let build = root.join("build");
        fs::create_dir_all(&build).unwrap();
        fs::write(root.join("a.cpp"), "").unwrap();
        fs::write(build.join("gen.cpp"), "").unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("o.cpp"), "").unwrap();
        let entries = serde_json::json!([
            {"directory": build, "file": "../a.cpp"},
            {"directory": build, "file": root.join("a.cpp")},
            {"directory": build, "file": "gen.cpp"},
            {"directory": outside.path(), "file": "o.cpp"},
            {"directory": build, "file": "missing.cpp"},
        ]);
        let database = build.join("compile_commands.json");
        fs::write(&database, entries.to_string()).unwrap();
        let files = database_files(&database, &root, &build).unwrap();
        assert_eq!(files, vec![root.join("a.cpp")]);
    }

    #[test]
    fn warning_flags_reach_every_kind_of_database_entry() {
        let text = r#"[
            {"directory":"/b","file":"a.cpp","command":"/usr/bin/g++ -Wno-unused -c a.cpp"},
            {"directory":"/b","file":"b.cpp","command":"\"C:/Program Files/g++.exe\" -c b.cpp"},
            {"directory":"/b","file":"c.cpp","arguments":["clang++","-c","c.cpp"]},
            {"directory":"/b","file":"d.cpp","command":"C:\\VC\\cl.exe /c d.cpp"}
        ]"#;
        let out: serde_json::Value =
            serde_json::from_str(&database_with_flags(text, &["-Wall", "-Wextra"]).unwrap())
                .unwrap();
        assert_eq!(
            out[0]["command"],
            "/usr/bin/g++ -Wall -Wextra -Wno-unused -c a.cpp"
        );
        assert_eq!(
            out[1]["command"],
            "\"C:/Program Files/g++.exe\" -Wall -Wextra -c b.cpp"
        );
        assert_eq!(
            out[2]["arguments"],
            serde_json::json!(["clang++", "-Wall", "-Wextra", "-c", "c.cpp"])
        );
        // For cl, -Wall would be every warning there is.
        assert_eq!(out[3]["command"], "C:\\VC\\cl.exe -W4 -Wextra /c d.cpp");
        assert!(database_with_flags("{}", &["-Wall"]).is_err());
    }
    #[test]
    fn checks_apply_only_without_the_projects_own_file() {
        let dir = tempfile::tempdir().unwrap();
        let (with, without) = (dir.path().join("a"), dir.path().join("b"));
        fs::create_dir_all(with.join("src")).unwrap();
        fs::create_dir_all(&without).unwrap();
        fs::write(with.join(".clang-tidy"), "Checks: '-*'").unwrap();
        let settings = AnalysisSettings {
            default_checks: "bugprone-*".into(),
            warning_flags: "-Wall".into(),
            ..Default::default()
        };
        assert_eq!(
            tidy_arguments(&settings, &with.join("src/x.cpp"), false),
            ["--extra-arg=-Wall"]
        );
        assert_eq!(
            tidy_arguments(&settings, &without.join("x.cpp"), false),
            ["--checks=bugprone-*", "--extra-arg=-Wall"]
        );
        assert_eq!(
            tidy_arguments(&settings, &without.join("x.cpp"), true),
            ["--checks=bugprone-*", "--extra-arg=-W4"]
        );
    }
    #[test]
    fn settings_only_take_checks_and_warnings() {
        let bad = [
            ("a b", "-Wall"),
            ("a;rm", "-Wall"),
            ("", "--load=evil.dll"),
            ("", "-Wall -o/tmp/x"),
            ("", "-Xclang"),
        ];
        for (default_checks, warning_flags) in bad {
            let settings = AnalysisSettings {
                default_checks: default_checks.into(),
                warning_flags: warning_flags.into(),
                ..Default::default()
            };
            assert!(
                settings.validate().is_err(),
                "{default_checks} {warning_flags}"
            );
        }
        let settings = AnalysisSettings {
            default_checks: "*,-llvmlibc-*,bugprone-*".into(),
            warning_flags: "-Wall -Wno-unused-parameter -Werror=return-type -pedantic".into(),
            ..Default::default()
        };
        assert!(settings.validate().is_ok());
    }
    #[test]
    fn settings_are_validated() {
        let mut settings = AnalysisSettings::default();
        assert!(settings.validate().is_ok());
        assert!(settings.clang_tidy_enabled);
        settings.max_parallel_jobs = 0;
        assert!(settings.validate().is_err());
        let read: AnalysisSettings = serde_json::from_str(r#"{"autoAnalysis": "onSave"}"#).unwrap();
        assert_eq!(read.auto_analysis, AutoAnalysis::OnSave);
        assert_eq!(read.max_parallel_jobs, 2);
    }

    /// The real program, where it is installed: one file of a small compilation database.
    #[test]
    fn clang_tidy_reports_a_check_with_its_fix_when_installed() {
        let Some(program) = env::var_os("PATH").and_then(|paths| {
            env::split_paths(&paths)
                .map(|d| d.join(program_name()))
                .find(|p| crate::lsp::executable(p))
        }) else {
            eprintln!("clang-tidy is not on PATH; skipped");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let root = crate::git::plain(&root);
        let build = root.join("build");
        fs::create_dir_all(&build).unwrap();
        fs::write(root.join("a.cpp"), SOURCE).unwrap();
        fs::write(
            root.join(".clang-tidy"),
            "Checks: '-*,modernize-use-nullptr'\n",
        )
        .unwrap();
        let entries = serde_json::json!([{
            "directory": build,
            "arguments": ["clang++", "-std=c++17", "-c", root.join("a.cpp")],
            "file": root.join("a.cpp"),
        }]);
        fs::write(build.join("compile_commands.json"), entries.to_string()).unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let seen = events.clone();
        let sink: Arc<dyn Fn(AnalysisEvent) + Send + Sync> =
            Arc::new(move |event| lock(&seen).push(event));
        let (result, cancelled) = analyze(
            &Jobs::default(),
            "main",
            "test",
            &program,
            &build,
            &[],
            &build,
            &root.join("a.cpp"),
            &[],
            &sink,
        )
        .unwrap();
        assert!(!cancelled);
        let finding = result
            .findings
            .iter()
            .find(|f| f.rule == "modernize-use-nullptr")
            .expect("the nullptr check");
        assert_eq!(
            finding.position,
            Position {
                line: 2,
                character: 11
            }
        );
        assert_eq!(finding.fix[0].new_text, "nullptr");
        assert!(
            matches!(&lock(&events)[0], AnalysisEvent::Output { text } if text.starts_with("[clang-tidy]"))
        );
        // The fixes file is gone again.
        assert_eq!(
            fs::read_dir(&build).unwrap().count(),
            1,
            "only compile_commands.json is left"
        );
    }
}
