use crate::files::{self, FileData, SaveRequest, atomic_write};
use ignore::{WalkBuilder, overrides::OverrideBuilder};
use regex::{NoExpand, Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

// A project listing is for quick open and search, not an index: past this the result says
// it was cut short instead of using more memory.
const MAX_FILES: usize = 50_000;
const MAX_MATCHES: usize = 5_000;
// Larger files are skipped by project search; they can still be opened and searched alone.
const MAX_SEARCH_BYTES: u64 = 4 * 1024 * 1024;
const PREVIEW_CHARS: usize = 240;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectSettings {
    pub format_on_save: bool,
    pub tab_size: u8,
    pub insert_spaces: bool,
    /// Glob patterns (gitignore syntax) left out of quick open and project search.
    pub exclude: Vec<String>,
}
impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            format_on_save: false,
            tab_size: 4,
            insert_spaces: true,
            exclude: Vec::new(),
        }
    }
}
impl ProjectSettings {
    fn validate(&self) -> Result<(), String> {
        if !(1..=16).contains(&self.tab_size) {
            return Err("Tab size must be between 1 and 16".into());
        }
        if self.exclude.len() > 100
            || self
                .exclude
                .iter()
                .any(|p| p.trim().is_empty() || p.len() > 200 || p.contains('\n'))
        {
            return Err("Exclude patterns must be 1–200 characters, at most 100 of them".into());
        }
        Ok(())
    }
}

/// An existing directory, canonical, so the same folder always has the same key.
pub fn root(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Project folder is missing or inaccessible: {e}"))?;
    if !path.is_dir() {
        return Err("A project must be a folder".into());
    }
    Ok(path)
}
fn inside(root: &Path, path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("File is missing or inaccessible: {e}"))?;
    if !path.starts_with(root) {
        return Err("The file is outside the project".into());
    }
    Ok(path)
}
pub fn display(path: &Path) -> String {
    crate::directory::display(path)
}
fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Files under the root, honouring `.gitignore` (also outside Git repositories), the
/// project's exclude patterns and skipping `.git`.
fn walk(root: &Path, exclude: &[String]) -> Result<WalkBuilder, String> {
    let mut overrides = OverrideBuilder::new(root);
    for pattern in exclude {
        overrides
            .add(&format!("!{}", pattern.trim()))
            .map_err(|e| format!("Invalid exclude pattern {pattern}: {e}"))?;
    }
    let mut builder = WalkBuilder::new(root);
    builder
        .hidden(false)
        .parents(false)
        .git_global(false)
        .require_git(false)
        .follow_links(false)
        .overrides(overrides.build().map_err(|e| e.to_string())?)
        .filter_entry(|entry| entry.file_name() != ".git")
        .sort_by_file_path(|a, b| a.cmp(b));
    Ok(builder)
}

#[derive(Serialize)]
pub struct ProjectFiles {
    files: Vec<String>,
    truncated: bool,
}
pub fn files(root: &Path, exclude: &[String]) -> Result<ProjectFiles, String> {
    let mut files = Vec::new();
    for entry in walk(root, exclude)?.build() {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if files.len() == MAX_FILES {
            return Ok(ProjectFiles {
                files,
                truncated: true,
            });
        }
        files.push(relative(root, entry.path()));
    }
    Ok(ProjectFiles {
        files,
        truncated: false,
    })
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub text: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub whole_word: bool,
}
pub fn pattern(query: &Query) -> Result<Regex, String> {
    if query.text.is_empty() {
        return Err("Enter text to search for".into());
    }
    if query.text.contains('\n') {
        return Err("Search works within single lines".into());
    }
    let mut source = if query.regex {
        query.text.clone()
    } else {
        regex::escape(&query.text)
    };
    if query.whole_word {
        source = format!(r"\b(?:{source})\b");
    }
    RegexBuilder::new(&source)
        .case_insensitive(!query.match_case)
        .multi_line(false)
        .size_limit(1 << 20)
        .build()
        .map_err(|e| format!("Invalid regular expression: {e}"))
}
fn utf16(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}

/// A match in a line. Columns and lengths are UTF-16 code units, the unit of editor offsets.
#[derive(Serialize, Debug, PartialEq)]
pub struct Match {
    line: u32,
    column: u32,
    length: u32,
    preview: String,
    /// Where the match starts within `preview`, in UTF-16 code units.
    offset: u32,
}
#[derive(Serialize)]
pub struct FileMatches {
    path: String,
    relative: String,
    revision: String,
    matches: Vec<Match>,
}
#[derive(Serialize)]
pub struct SearchResult {
    files: Vec<FileMatches>,
    truncated: bool,
    /// Files left out because they are not UTF-8 text or too large.
    skipped: u32,
}
fn preview(line: &str, start: usize) -> (String, u32) {
    let before: Vec<char> = line[..start].chars().collect();
    let skip = before.len().saturating_sub(60);
    let text: String = line.chars().skip(skip).take(PREVIEW_CHARS).collect();
    let offset = utf16(&before[skip..].iter().collect::<String>());
    (text, offset)
}
pub fn matches(text: &str, pattern: &Regex, limit: usize) -> Vec<Match> {
    let mut found = Vec::new();
    for (index, line) in text.split('\n').enumerate() {
        for m in pattern.find_iter(line) {
            if m.is_empty() {
                continue;
            }
            if found.len() == limit {
                return found;
            }
            let (preview, offset) = preview(line, m.start());
            found.push(Match {
                line: index as u32 + 1,
                column: utf16(&line[..m.start()]),
                length: utf16(m.as_str()),
                preview,
                offset,
            });
        }
    }
    found
}
pub fn search(root: &Path, query: &Query, exclude: &[String]) -> Result<SearchResult, String> {
    let pattern = pattern(query)?;
    let mut result = SearchResult {
        files: Vec::new(),
        truncated: false,
        skipped: 0,
    };
    let mut total = 0;
    for entry in walk(root, exclude)?.build() {
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX) > MAX_SEARCH_BYTES {
            result.skipped += 1;
            continue;
        }
        let Ok(bytes) = fs::read(entry.path()) else {
            result.skipped += 1;
            continue;
        };
        let Ok(file) = files::decode(entry.path(), &bytes) else {
            result.skipped += 1;
            continue;
        };
        let found = matches(&file.text, &pattern, MAX_MATCHES - total);
        if found.is_empty() {
            continue;
        }
        total += found.len();
        result.files.push(FileMatches {
            path: display(entry.path()),
            relative: relative(root, entry.path()),
            revision: file.revision,
            matches: found,
        });
        if total == MAX_MATCHES {
            result.truncated = true;
            break;
        }
    }
    Ok(result)
}

/// Replaces every match, line by line, exactly as `search` reported them. `$1` style groups
/// expand only for regular expressions.
pub fn replace_text(text: &str, query: &Query, replacement: &str) -> Result<String, String> {
    let pattern = pattern(query)?;
    Ok(text
        .split('\n')
        .map(|line| {
            if query.regex {
                pattern.replace_all(line, replacement)
            } else {
                pattern.replace_all(line, NoExpand(replacement))
            }
        })
        .collect::<Vec<_>>()
        .join("\n"))
}

#[derive(Deserialize)]
pub struct Target {
    path: String,
    revision: String,
}
#[derive(Serialize)]
pub struct Replaced {
    path: String,
    error: Option<String>,
    file: Option<FileData>,
}
/// Rewrites closed files only when they still have the searched revision; a changed file is
/// reported, not overwritten. Each file is replaced atomically with its encoding kept.
pub fn replace(
    root: &Path,
    query: &Query,
    replacement: &str,
    targets: &[Target],
) -> Result<Vec<Replaced>, String> {
    pattern(query)?;
    Ok(targets
        .iter()
        .map(|target| {
            let outcome = inside(root, &target.path).and_then(|path| {
                let current = files::read(&path)?;
                if current.revision != target.revision {
                    return Err(files::CHANGED_ON_DISK.into());
                }
                let text = replace_text(&current.text, query, replacement)?;
                files::save(
                    &path,
                    &SaveRequest {
                        path: None,
                        text,
                        revision: None,
                        bom: current.bom,
                        ending: current.ending.clone(),
                        name: current.name.clone(),
                        excluded_paths: Vec::new(),
                    },
                    Some(&target.revision),
                )
            });
            match outcome {
                Ok(file) => Replaced {
                    path: target.path.clone(),
                    error: None,
                    file: Some(file),
                },
                Err(error) => Replaced {
                    path: target.path.clone(),
                    error: Some(error),
                    file: None,
                },
            }
        })
        .collect())
}

static SETTINGS: Mutex<()> = Mutex::new(());
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("ide-projects.json"))
}
fn stored(path: &Path) -> Result<BTreeMap<String, ProjectSettings>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|_| {
        format!(
            "The IDE project settings file is damaged and was left unchanged: {}",
            path.display()
        )
    })
}
pub fn settings_for(app: &tauri::AppHandle, root: &Path) -> Result<ProjectSettings, String> {
    let _guard = SETTINGS.lock().map_err(|e| e.to_string())?;
    Ok(stored(&settings_path(app)?)?
        .remove(&display(root))
        .unwrap_or_default())
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}
#[derive(Serialize)]
pub struct Opened {
    root: String,
    name: String,
    settings: ProjectSettings,
}
fn opened(app: &tauri::AppHandle, root: PathBuf) -> Result<Opened, String> {
    Ok(Opened {
        name: root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| display(&root)),
        settings: settings_for(app, &root)?,
        root: display(&root),
    })
}
/// Shows the folder picker; with `path` reopens a known folder (for example a project
/// panel that is still open).
#[tauri::command]
pub async fn project_open(
    app: tauri::AppHandle,
    path: Option<String>,
) -> Result<Option<Opened>, String> {
    let path = match path {
        Some(path) => path,
        None => {
            let Some(folder) = rfd::AsyncFileDialog::new()
                .set_title("Open project folder")
                .pick_folder()
                .await
            else {
                return Ok(None);
            };
            folder.path().to_string_lossy().into_owned()
        }
    };
    let root = root(&path)?;
    let project = opened(&app, root)?;
    // Only a convenience for the next IDE: a failure here must not fail the opening.
    let _ = remember(&app, &project.root);
    Ok(Some(project))
}

#[derive(Serialize, Deserialize)]
struct Recent {
    root: String,
}
fn recent_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("ide-recent.json"))
}
fn remember(app: &tauri::AppHandle, root: &str) -> Result<(), String> {
    let path = recent_path(app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    let recent = Recent {
        root: root.to_owned(),
    };
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(&recent).map_err(|e| e.to_string())?,
    )
}
/// The folder opened last, while it still exists; the first IDE of a window reopens it.
#[tauri::command]
pub fn project_recent(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Ok(bytes) = fs::read(recent_path(&app)?) else {
        return Ok(None);
    };
    Ok(serde_json::from_slice::<Recent>(&bytes)
        .ok()
        .filter(|recent| root(&recent.root).is_ok())
        .map(|recent| recent.root))
}
#[tauri::command]
pub async fn project_files(app: tauri::AppHandle, root: String) -> Result<ProjectFiles, String> {
    blocking(move || {
        let root = self::root(&root)?;
        files(&root, &settings_for(&app, &root)?.exclude)
    })
    .await
}
#[tauri::command]
pub async fn project_search(
    app: tauri::AppHandle,
    root: String,
    query: Query,
) -> Result<SearchResult, String> {
    blocking(move || {
        let root = self::root(&root)?;
        search(&root, &query, &settings_for(&app, &root)?.exclude)
    })
    .await
}
/// The replacement for one open document, so editor buffers get exactly what files get.
#[tauri::command]
pub fn project_replace_text(
    text: String,
    query: Query,
    replacement: String,
) -> Result<String, String> {
    replace_text(&text, &query, &replacement)
}
#[tauri::command]
pub async fn project_replace(
    root: String,
    query: Query,
    replacement: String,
    targets: Vec<Target>,
) -> Result<Vec<Replaced>, String> {
    blocking(move || replace(&self::root(&root)?, &query, &replacement, &targets)).await
}
#[tauri::command]
pub fn project_set_settings(
    app: tauri::AppHandle,
    root: String,
    settings: ProjectSettings,
) -> Result<ProjectSettings, String> {
    settings.validate()?;
    for pattern in &settings.exclude {
        ignore::gitignore::GitignoreBuilder::new("")
            .add_line(None, pattern)
            .map_err(|e| format!("Invalid exclude pattern {pattern}: {e}"))?;
    }
    let root = self::root(&root)?;
    let _guard = SETTINGS.lock().map_err(|e| e.to_string())?;
    let path = settings_path(&app)?;
    let mut all = stored(&path)?;
    if settings == ProjectSettings::default() {
        all.remove(&display(&root));
    } else {
        all.insert(display(&root), settings.clone());
    }
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(&all).map_err(|e| e.to_string())?,
    )?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn query(text: &str) -> Query {
        Query {
            text: text.into(),
            regex: false,
            match_case: false,
            whole_word: false,
        }
    }

    #[test]
    fn listing_honours_gitignore_excludes_and_skips_git() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        for (path, text) in [
            (".gitignore", "build/\n*.o\n"),
            ("src/main.cpp", "int main() {}\n"),
            ("src/main.o", "x"),
            ("build/out.txt", "x"),
            ("third_party/lib.h", "x"),
            (".git/HEAD", "ref: refs/heads/main\n"),
            (".clang-format", "BasedOnStyle: LLVM\n"),
        ] {
            fs::create_dir_all(root.join(path).parent().unwrap()).unwrap();
            fs::write(root.join(path), text).unwrap();
        }
        let listed = files(&root, &["third_party/".into()]).unwrap();
        assert_eq!(
            listed.files,
            [".clang-format", ".gitignore", "src/main.cpp"]
        );
        assert!(!listed.truncated);
    }

    #[test]
    fn search_reports_utf16_columns_and_skips_binary_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("a.cpp"), "// ğüş Value\r\nint value = 1;\r\n").unwrap();
        fs::write(root.join("b.bin"), b"value\0\x01").unwrap();
        let result = search(&root, &query("value"), &[]).unwrap();
        assert_eq!(result.files.len(), 1);
        assert_eq!(result.skipped, 1);
        let found = &result.files[0].matches;
        assert_eq!((found[0].line, found[0].column, found[0].length), (1, 7, 5));
        assert_eq!((found[1].line, found[1].column), (2, 4));
        let mut word = query("Value");
        word.match_case = true;
        word.whole_word = true;
        assert_eq!(search(&root, &word, &[]).unwrap().files[0].matches.len(), 1);
        assert!(search(&root, &query(""), &[]).is_err());
    }

    #[test]
    fn replace_keeps_encoding_and_refuses_changed_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let path = root.join("a.cpp");
        fs::write(&path, b"\xef\xbb\xbfint old = old;\r\n").unwrap();
        let mut regex = query(r"(o)ld");
        regex.regex = true;
        assert_eq!(
            replace_text("old\nfold", &regex, "${1}k-$1").unwrap(),
            "ok-o\nfok-o"
        );
        assert_eq!(replace_text("a.b", &query("."), "$0").unwrap(), "a$0b");
        let revision = files::read(&path).unwrap().revision;
        let target = |revision: &str| Target {
            path: display(&path),
            revision: revision.into(),
        };
        let done = replace(&root, &query("old"), "new", &[target(&revision)]).unwrap();
        assert!(done[0].error.is_none(), "{:?}", done[0].error);
        assert_eq!(fs::read(&path).unwrap(), b"\xef\xbb\xbfint new = new;\r\n");
        let stale = replace(&root, &query("new"), "x", &[target(&revision)]).unwrap();
        assert!(stale[0].error.is_some());
        assert_eq!(fs::read(&path).unwrap(), b"\xef\xbb\xbfint new = new;\r\n");
        let outside = tempfile::NamedTempFile::new().unwrap();
        let foreign = Target {
            path: display(outside.path()),
            revision,
        };
        assert!(
            replace(&root, &query("x"), "y", &[foreign]).unwrap()[0]
                .error
                .is_some()
        );
    }
}
