//! Rust projects (see `docs/decisions/033-rust.md`), after VS Code's rust-analyzer extension:
//! finding rustup's tools, the settings of Workspace Settings → IDE → Rust and the
//! configuration rust-analyzer gets. Rust builds that configuration; the renderer never sends
//! rust-analyzer settings, which can name commands (`overrideCommand`) for it to run.
use crate::cmake::kits;
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Manager;

const QUERY: Duration = Duration::from_secs(10);
static STORE: Mutex<()> = Mutex::new(());

/// What rust-analyzer's check on save runs.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum CheckCommand {
    #[default]
    Check,
    Clippy,
}
impl CheckCommand {
    pub fn name(self) -> &'static str {
        match self {
            Self::Check => "check",
            Self::Clippy => "clippy",
        }
    }
}

/// Workspace Settings → IDE → Rust.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct RustSettings {
    /// rust-analyzer runs `cargo check` (or Clippy) after a Rust file is saved.
    pub check_on_save: bool,
    pub check_command: CheckCommand,
    /// rust-analyzer builds and runs the project's build scripts and procedural macros: code
    /// of the project and its dependencies (VS Code asks for workspace trust for this).
    pub build_scripts: bool,
    /// Type and parameter name hints in the code.
    pub inlay_hints: bool,
    pub build_before_run: bool,
    /// Build, Run and Test with `--offline`: Cargo downloads no dependencies.
    pub offline: bool,
    /// 0 leaves it to Cargo.
    pub parallel_jobs: u16,
}
impl Default for RustSettings {
    fn default() -> Self {
        Self {
            check_on_save: true,
            check_command: CheckCommand::Check,
            build_scripts: true,
            inlay_hints: true,
            build_before_run: true,
            offline: false,
            parallel_jobs: 0,
        }
    }
}
impl RustSettings {
    fn validate(&self) -> Result<(), String> {
        if self.parallel_jobs > 1024 {
            return Err("Parallel jobs must be between 0 and 1024".into());
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct Stored {
    settings: RustSettings,
    /// Chosen in a native dialog; otherwise found on `PATH` or in Cargo's home.
    cargo: Option<PathBuf>,
}
fn config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("rust.json"))
}
fn stored(app: &tauri::AppHandle) -> Result<Stored, String> {
    let _guard = STORE.lock().map_err(|e| e.to_string())?;
    let path = config_file(app)?;
    if !path.exists() {
        return Ok(Stored::default());
    }
    serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?).map_err(|_| {
        format!(
            "The Rust settings file is damaged and was left unchanged: {}",
            path.display()
        )
    })
}
fn update_stored(app: &tauri::AppHandle, change: impl FnOnce(&mut Stored)) -> Result<(), String> {
    let mut value = stored(app)?;
    change(&mut value);
    let _guard = STORE.lock().map_err(|e| e.to_string())?;
    let path = config_file(app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?,
    )
}
pub fn settings(app: &tauri::AppHandle) -> RustSettings {
    stored(app).map(|s| s.settings).unwrap_or_default()
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_owned()
    }
}
/// Cargo's `bin` folder, where rustup puts its tools.
pub fn cargo_bin() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = env::var_os("CARGO_HOME") {
        dirs.push(PathBuf::from(home).join("bin"));
    }
    for home in ["USERPROFILE", "HOME"].iter().filter_map(env::var_os) {
        let dir = PathBuf::from(home).join(".cargo").join("bin");
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}
fn on_path(program: &str) -> Option<PathBuf> {
    env::split_paths(&env::var_os("PATH")?)
        .map(|dir| dir.join(program))
        .find(|path| crate::lsp::executable(path))
}
/// rustup's proxies (`cargo`, `rust-analyzer` in Cargo's `bin`) run the tool of the folder's
/// toolchain (`rust-toolchain.toml`); a proxy of a component that is not installed fails.
fn rustup_beside(program: &Path) -> Option<PathBuf> {
    let rustup = program.parent()?.join(exe("rustup"));
    crate::lsp::executable(&rustup).then_some(rustup)
}
/// The real program behind a rustup proxy for this folder, from the fixed query
/// `rustup which <tool>`; `None` when the toolchain has no such component.
fn rustup_which(rustup: &Path, tool: &str, cwd: Option<&Path>) -> Option<PathBuf> {
    let mut command = Command::new(rustup);
    command.args(["which", tool]);
    if let Some(cwd) = cwd {
        command.current_dir(crate::git::plain(cwd));
    }
    let out = kits::query(&mut command, QUERY)?;
    let path = PathBuf::from(String::from_utf8_lossy(&out).trim());
    crate::lsp::executable(&path).then_some(path)
}

/// rust-analyzer as found: the real program, or why rustup's proxy cannot start one.
pub struct Found {
    pub path: Option<PathBuf>,
    pub note: Option<String>,
}
/// rust-analyzer on `PATH` or in Cargo's home (rustup's proxy resolved for `cwd`), then the
/// one VS Code's rust-analyzer extension ships. Nothing is downloaded or installed.
pub fn find_rust_analyzer(cwd: Option<&Path>) -> Found {
    let name = exe("rust-analyzer");
    let mut candidates: Vec<PathBuf> = on_path(&name).into_iter().collect();
    candidates.extend(cargo_bin().into_iter().map(|dir| dir.join(&name)));
    let mut note = None;
    for candidate in candidates {
        if !crate::lsp::executable(&candidate) {
            continue;
        }
        let Some(rustup) = rustup_beside(&candidate) else {
            return Found {
                path: Some(candidate),
                note: None,
            };
        };
        match rustup_which(&rustup, "rust-analyzer", cwd) {
            Some(real) => {
                return Found {
                    path: Some(real),
                    note: None,
                };
            }
            None => {
                note = Some(
                    "rustup's toolchain has no rust-analyzer: run `rustup component add \
                     rust-analyzer`, or choose the program."
                        .into(),
                )
            }
        }
    }
    if let Some(path) = vscode_server() {
        return Found {
            path: Some(path),
            note: None,
        };
    }
    Found { path: None, note }
}
/// The server of the newest rust-analyzer extension installed in VS Code.
fn vscode_server() -> Option<PathBuf> {
    let home = ["USERPROFILE", "HOME"].iter().find_map(env::var_os)?;
    let dir = PathBuf::from(home).join(".vscode").join("extensions");
    let mut found: Vec<(Vec<u64>, PathBuf)> = fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let rest = name.strip_prefix("rust-lang.rust-analyzer-")?;
            let version = rest
                .split('-')
                .next()?
                .split('.')
                .map(|n| n.parse().ok())
                .collect::<Option<Vec<u64>>>()?;
            let server = entry.path().join("server").join(exe("rust-analyzer"));
            crate::lsp::executable(&server).then_some((version, server))
        })
        .collect();
    found.sort();
    found.pop().map(|(_, path)| path)
}

/// Cargo: chosen, on `PATH` or in Cargo's home. rustup's proxy is kept (it picks the
/// project's toolchain itself).
pub fn cargo_program(app: &tauri::AppHandle) -> Result<Option<(PathBuf, bool)>, String> {
    if let Some(chosen) = stored(app)?.cargo {
        return Ok(crate::lsp::executable(&chosen).then_some((chosen, true)));
    }
    let name = exe("cargo");
    Ok(on_path(&name)
        .or_else(|| {
            cargo_bin()
                .into_iter()
                .map(|dir| dir.join(&name))
                .find(|p| crate::lsp::executable(p))
        })
        .map(|p| (p, false)))
}
/// rust-analyzer's settings, as VS Code's extension sends them (`rust-analyzer.*`). File
/// changes are watched by the server; it gets no command overrides.
pub fn analyzer_config(settings: &RustSettings) -> Value {
    json!({
        "checkOnSave": settings.check_on_save,
        "check": { "command": settings.check_command.name() },
        "cargo": {
            "buildScripts": { "enable": settings.build_scripts },
            "autoreload": true,
        },
        "procMacro": { "enable": settings.build_scripts },
        "files": { "watcher": "server" },
        "inlayHints": {
            "typeHints": { "enable": settings.inlay_hints },
            "parameterHints": { "enable": settings.inlay_hints },
            "chainingHints": { "enable": settings.inlay_hints },
            "closingBraceHints": { "enable": false },
        },
        "lens": { "enable": false },
    })
}
/// rust-analyzer's own `cargo` calls (metadata, check) never download: Mozaik makes no
/// network request of its own. A user's Build may (see `offline`).
pub fn analyzer_env() -> Vec<(String, String)> {
    vec![("CARGO_NET_OFFLINE".into(), "true".into())]
}

/// Server messages from the renderer to rust-analyzer: its configuration is Rust's alone.
pub fn outgoing(message: &str, config: &Value) -> Result<Option<String>, String> {
    // Only these methods carry settings; everything else passes unread.
    if !message.contains("\"initialize\"") && !message.contains("didChangeConfiguration") {
        return Ok(None);
    }
    let mut value: Value = serde_json::from_str(message).map_err(|_| "Invalid server message")?;
    match value["method"].as_str() {
        Some("initialize") => {
            value["params"]["initializationOptions"] = config.clone();
            Ok(Some(value.to_string()))
        }
        Some("workspace/didChangeConfiguration") => {
            Err("rust-analyzer's settings come from Workspace Settings".into())
        }
        _ => Ok(None),
    }
}
/// rust-analyzer asks for its settings with `workspace/configuration`; Rust answers itself.
pub fn configuration_answer(message: &str, config: &Value) -> Option<String> {
    if !message.contains("workspace/configuration") {
        return None;
    }
    let value: Value = serde_json::from_str(message).ok()?;
    if value["method"] != "workspace/configuration" || value.get("id").is_none() {
        return None;
    }
    let items = value["params"]["items"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let result: Vec<Value> = items
        .iter()
        .map(|item| match item["section"].as_str() {
            Some("rust-analyzer") | None => config.clone(),
            Some(section) => section
                .strip_prefix("rust-analyzer.")
                .and_then(|path| {
                    path.split('.')
                        .try_fold(config, |v, key| v.get(key))
                        .cloned()
                })
                .unwrap_or(Value::Null),
        })
        .collect();
    Some(json!({ "jsonrpc": "2.0", "id": value["id"], "result": result }).to_string())
}

pub fn require_cargo(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    cargo_program(app)?.map(|(p, _)| p).ok_or_else(|| {
        "Cargo was not found. Install Rust (rustup) or choose cargo in settings.".into()
    })
}

/// A project's Cargo choices, kept with its IDE settings in the app config directory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectCargo {
    /// Empty is `dev`; `release` builds with `--release`.
    pub profile: String,
    /// A target id (`cargo:<kind>:<package>:<name>`); `None` builds the default members.
    pub build_target: Option<String>,
    pub run_target: Option<String>,
    /// Run's arguments and working folder (relative to the project), by target id.
    pub launch: BTreeMap<String, crate::cmake::Launch>,
}
pub const PROFILES: [&str; 2] = ["dev", "release"];
impl ProjectCargo {
    pub fn validate(&self) -> Result<(), String> {
        if !self.profile.is_empty() && !PROFILES.contains(&self.profile.as_str()) {
            return Err(format!("Unknown Cargo profile {}", self.profile));
        }
        for id in [&self.build_target, &self.run_target].into_iter().flatten() {
            TargetId::parse(id).ok_or_else(|| format!("Invalid Cargo target {id}"))?;
        }
        if self.launch.len() > 200
            || self.launch.iter().any(|(id, launch)| {
                TargetId::parse(id).is_none()
                    || launch.cwd.len() > 500
                    || launch.cwd.contains(['\0', '\n', '\r'])
                    || launch.args.len() > 100
                    || launch
                        .args
                        .iter()
                        .any(|a| a.len() > 2000 || a.contains('\0'))
            })
        {
            return Err("Run arguments: at most 100 per target, 2000 characters each".into());
        }
        Ok(())
    }
    fn release(&self) -> bool {
        self.profile == "release"
    }
    /// The folder of the profile's output in the target directory.
    fn profile_dir(&self) -> &'static str {
        if self.release() { "release" } else { "debug" }
    }
}

/// The kinds of Cargo targets Mozaik builds or runs by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Lib,
    Bin,
    Example,
    Test,
    Bench,
}
impl Kind {
    fn parse(text: &str) -> Option<Self> {
        Some(match text {
            "lib" => Self::Lib,
            "bin" => Self::Bin,
            "example" => Self::Example,
            "test" => Self::Test,
            "bench" => Self::Bench,
            _ => return None,
        })
    }
    fn name(self) -> &'static str {
        match self {
            Self::Lib => "lib",
            Self::Bin => "bin",
            Self::Example => "example",
            Self::Test => "test",
            Self::Bench => "bench",
        }
    }
    /// The kind of a Cargo metadata target: a library of any crate type is a library.
    fn of(kinds: &[String]) -> Option<Self> {
        if kinds.iter().any(|k| {
            ["lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"].contains(&k.as_str())
        }) {
            return Some(Self::Lib);
        }
        kinds.iter().find_map(|k| Self::parse(k))
    }
    pub fn runnable(self) -> bool {
        matches!(self, Self::Bin | Self::Example)
    }
}
/// A Cargo target named by the renderer: `cargo:<kind>:<package>:<name>`. CMake target names
/// cannot hold `:`, so one run target string serves both.
#[derive(Debug, Clone, PartialEq)]
pub struct TargetId {
    pub kind: Kind,
    pub package: String,
    pub name: String,
}
fn valid_name(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 200
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
impl TargetId {
    pub fn parse(id: &str) -> Option<Self> {
        let mut parts = id.strip_prefix("cargo:")?.split(':');
        let (kind, package, name) = (parts.next()?, parts.next()?, parts.next()?);
        if parts.next().is_some() || !valid_name(package) || !valid_name(name) {
            return None;
        }
        Some(Self {
            kind: Kind::parse(kind)?,
            package: package.into(),
            name: name.into(),
        })
    }
    pub fn id(&self) -> String {
        format!("cargo:{}:{}:{}", self.kind.name(), self.package, self.name)
    }
    /// Cargo's arguments that select this target.
    fn args(&self) -> Vec<String> {
        let mut args = vec!["-p".into(), self.package.clone()];
        match self.kind {
            Kind::Lib => args.push("--lib".into()),
            kind => {
                args.push(format!("--{}", kind.name()));
                args.push(self.name.clone());
            }
        }
        args
    }
}
pub fn is_target(id: &str) -> bool {
    id.starts_with("cargo:")
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub package: String,
    pub src_path: String,
}
#[derive(Debug, Clone, PartialEq)]
pub struct Package {
    pub name: String,
    pub version: String,
    pub dir: PathBuf,
}
/// What `cargo metadata --no-deps` tells about the workspace.
#[derive(Debug, Clone, PartialEq)]
pub struct Metadata {
    pub workspace_root: PathBuf,
    pub target_directory: PathBuf,
    pub packages: Vec<Package>,
    pub targets: Vec<Target>,
}
/// Reads the JSON of `cargo metadata --format-version 1 --no-deps`: workspace members only.
pub fn parse_metadata(text: &str) -> Result<Metadata, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("cargo metadata: {e}"))?;
    let path = |v: &Value| v.as_str().map(PathBuf::from);
    let workspace_root = path(&value["workspace_root"]).ok_or("cargo metadata: no workspace")?;
    let target_directory =
        path(&value["target_directory"]).ok_or("cargo metadata: no target directory")?;
    let members: Vec<&str> = value["workspace_members"]
        .as_array()
        .map(|m| m.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut packages = Vec::new();
    let mut targets = Vec::new();
    for package in value["packages"].as_array().into_iter().flatten() {
        let id = package["id"].as_str().unwrap_or_default();
        if !members.is_empty() && !members.contains(&id) {
            continue;
        }
        let (Some(name), Some(manifest)) =
            (package["name"].as_str(), path(&package["manifest_path"]))
        else {
            continue;
        };
        packages.push(Package {
            name: name.into(),
            version: package["version"].as_str().unwrap_or_default().into(),
            dir: manifest.parent().map(Path::to_owned).unwrap_or_default(),
        });
        for target in package["targets"].as_array().into_iter().flatten() {
            let kinds: Vec<String> = target["kind"]
                .as_array()
                .map(|k| {
                    k.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let (Some(kind), Some(target_name)) = (Kind::of(&kinds), target["name"].as_str())
            else {
                continue;
            };
            if !valid_name(name) || !valid_name(target_name) {
                continue;
            }
            let id = TargetId {
                kind,
                package: name.into(),
                name: target_name.into(),
            };
            targets.push(Target {
                id: id.id(),
                name: target_name.into(),
                kind,
                package: name.into(),
                src_path: target["src_path"].as_str().unwrap_or_default().into(),
            });
        }
    }
    Ok(Metadata {
        workspace_root,
        target_directory,
        packages,
        targets,
    })
}
fn manifest(root: &Path) -> Result<PathBuf, String> {
    let manifest = root.join("Cargo.toml");
    if !manifest.is_file() {
        return Err(format!("{} has no Cargo.toml", root.display()));
    }
    Ok(manifest)
}
/// Cargo's fixed query `cargo metadata --no-deps --offline`: names and folders, no build.
pub fn metadata(app: &tauri::AppHandle, root: &Path) -> Result<Metadata, String> {
    let manifest = manifest(root)?;
    let mut command = Command::new(require_cargo(app)?);
    command
        .args([
            "metadata",
            "--format-version",
            "1",
            "--no-deps",
            "--offline",
        ])
        .arg("--manifest-path")
        .arg(crate::git::plain(&manifest))
        .current_dir(crate::git::plain(root))
        .stdin(std::process::Stdio::null());
    kits::hide_window(&mut command);
    let out = command
        .output()
        .map_err(|e| format!("cargo metadata: {e}"))?;
    if !out.status.success() {
        let text = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "cargo metadata failed: {}",
            text.lines()
                .find(|l| l.contains("error"))
                .unwrap_or(text.trim())
        ));
    }
    parse_metadata(&String::from_utf8_lossy(&out.stdout))
}

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Build,
    Check,
    Clippy,
    Clean,
}
/// One Cargo step's arguments; Rust builds every command line from names it checked.
pub fn step_args(
    step: Step,
    manifest: &Path,
    project: &ProjectCargo,
    settings: &RustSettings,
    target: Option<&TargetId>,
) -> Vec<String> {
    let name = match step {
        Step::Build => "build",
        Step::Check => "check",
        Step::Clippy => "clippy",
        Step::Clean => "clean",
    };
    let mut args = vec![
        name.to_owned(),
        "--manifest-path".into(),
        manifest.display().to_string(),
    ];
    if project.release() {
        args.push("--release".into());
    }
    if step != Step::Clean {
        if let Some(target) = target {
            args.extend(target.args());
        }
        if settings.parallel_jobs > 0 {
            args.extend(["-j".into(), settings.parallel_jobs.to_string()]);
        }
    }
    if settings.offline {
        args.push("--offline".into());
    }
    args.extend(["--color".into(), "never".into()]);
    args
}

/// The program, arguments, folder and environment of a binary or example target, built
/// before (`cargo build` writes it to the target directory).
pub fn run_launch(
    app: &tauri::AppHandle,
    root: &str,
    target: &str,
) -> Result<crate::cmake::RunLaunch, String> {
    let root = crate::project::root(root)?;
    let id = TargetId::parse(target).ok_or_else(|| format!("Invalid Cargo target {target}"))?;
    if !id.kind.runnable() {
        return Err(format!("{} is not a binary or an example", id.name));
    }
    let meta = metadata(app, &root)?;
    let known = meta.targets.iter().any(|t| t.id == id.id());
    if !known {
        return Err(format!("{} is not a target of this workspace", id.name));
    }
    let project = crate::project::settings_for(app, &root)?.cargo;
    let program = program_path(&meta, &project, &id);
    let program = program
        .canonicalize()
        .map_err(|_| format!("{} has not been built yet ({})", id.name, program.display()))?;
    let targets = meta
        .target_directory
        .canonicalize()
        .unwrap_or(meta.target_directory.clone());
    if !program.starts_with(&targets) {
        return Err("The program is outside the target directory".into());
    }
    let launch = project.launch.get(target).cloned().unwrap_or_default();
    let cwd = if launch.cwd.trim().is_empty() {
        root.clone()
    } else {
        root.join(launch.cwd.trim())
    };
    if !cwd.is_dir() {
        return Err(format!(
            "The working folder {} does not exist",
            cwd.display()
        ));
    }
    // As `cargo run` sets them: the package's variables and its dynamic libraries' folder.
    let mut vars = Vec::new();
    if let Some(package) = meta.packages.iter().find(|p| p.name == id.package) {
        vars.push((
            "CARGO_MANIFEST_DIR".into(),
            crate::git::plain(&package.dir).display().to_string(),
        ));
        vars.push(("CARGO_PKG_NAME".into(), package.name.clone()));
        vars.push(("CARGO_PKG_VERSION".into(), package.version.clone()));
    }
    let deps = crate::git::plain(&targets.join(project.profile_dir()).join("deps"));
    let library_path = if cfg!(windows) {
        "PATH"
    } else if cfg!(target_os = "macos") {
        "DYLD_FALLBACK_LIBRARY_PATH"
    } else {
        "LD_LIBRARY_PATH"
    };
    let mut paths = vec![deps];
    paths.extend(
        env::var_os(library_path)
            .map(|p| env::split_paths(&p).collect::<Vec<_>>())
            .unwrap_or_default(),
    );
    if let Ok(joined) = env::join_paths(paths) {
        vars.push((library_path.into(), joined.to_string_lossy().into_owned()));
    }
    Ok(crate::cmake::RunLaunch {
        program: crate::git::plain(&program),
        args: launch.args,
        cwd: crate::git::plain(&cwd),
        env: vars,
        source: crate::git::plain(&meta.workspace_root),
        build: crate::git::plain(&targets),
    })
}
/// Where `cargo build` writes a binary or example of the project's profile.
pub fn program_path(meta: &Metadata, project: &ProjectCargo, id: &TargetId) -> PathBuf {
    let mut program = meta.target_directory.join(project.profile_dir());
    if id.kind == Kind::Example {
        program.push("examples");
    }
    program.push(exe(&id.name));
    program
}
/// A run target's launch, Cargo's or CMake's.
pub fn launch_for(
    app: &tauri::AppHandle,
    root: &str,
    target: &str,
) -> Result<crate::cmake::RunLaunch, String> {
    if is_target(target) {
        run_launch(app, root, target)
    } else {
        crate::cmake::run_launch(app, root, target)
    }
}

fn rustc_beside(app: &tauri::AppHandle) -> Option<PathBuf> {
    let cargo = cargo_program(app).ok()??.0;
    let rustc = cargo.parent()?.join(exe("rustc"));
    crate::lsp::executable(&rustc).then_some(rustc)
}
fn rustc_query(app: &tauri::AppHandle, root: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(rustc_beside(app)?);
    command.args(args).current_dir(crate::git::plain(root));
    kits::query(&mut command, QUERY).map(|out| String::from_utf8_lossy(&out).into_owned())
}
/// The project's Rust compiler as the debugger sees it, from the fixed query `rustc -vV`
/// (rustup's proxy follows the project's toolchain): MSVC targets carry PDB debug
/// information, which only LLDB reads.
pub fn debug_toolchain(app: &tauri::AppHandle, root: &Path) -> Option<crate::debug::Toolchain> {
    toolchain_of(&rustc_query(app, root, &["-vV"])?)
}
pub fn toolchain_of(text: &str) -> Option<crate::debug::Toolchain> {
    let field = |name: &str| {
        text.lines()
            .find_map(|l| l.strip_prefix(name).map(|v| v.trim().to_owned()))
    };
    let host = field("host:")?;
    Some(crate::debug::Toolchain {
        id: if host.contains("apple") {
            "Clang".into()
        } else {
            "GNU".into()
        },
        simulate: if host.ends_with("-msvc") {
            "MSVC".into()
        } else {
            String::new()
        },
        version: format!("rustc {}", field("release:").unwrap_or_default()),
        compiler: None,
    })
}
/// The toolchain's folder of debugger scripts (`lib/rustlib/etc`), for Rust's pretty-printers.
pub fn debugger_scripts(app: &tauri::AppHandle, root: &Path) -> Option<PathBuf> {
    let sysroot = rustc_query(app, root, &["--print", "sysroot"])?;
    let dir = PathBuf::from(sysroot.trim())
        .join("lib")
        .join("rustlib")
        .join("etc");
    dir.is_dir().then_some(dir)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CargoProjectInfo {
    /// The project folder has a `Cargo.toml`.
    cargo: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    finished: crate::cmake::jobs::Finished,
}
/// Reads only whether the folder is a Cargo project; runs nothing.
#[tauri::command]
pub async fn cargo_project(root: String) -> Result<CargoProjectInfo, String> {
    blocking(move || {
        let root = crate::project::root(&root)?;
        Ok(CargoProjectInfo {
            cargo: root.join("Cargo.toml").is_file(),
        })
    })
    .await
}
/// The workspace's targets, from `cargo metadata` (asked when a list or a run needs them).
#[tauri::command]
pub async fn cargo_targets(app: tauri::AppHandle, root: String) -> Result<Vec<Target>, String> {
    blocking(move || Ok(metadata(&app, &crate::project::root(&root)?)?.targets)).await
}
/// Runs one Cargo step to its end, streaming its output. `target` must be one of the
/// workspace's targets; `None` is the default members.
#[tauri::command]
pub async fn cargo_run(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    jobs: tauri::State<'_, crate::cmake::jobs::Jobs>,
    root: String,
    step: Step,
    target: Option<String>,
    events: tauri::ipc::Channel<crate::cmake::jobs::JobEvent>,
) -> Result<StepResult, String> {
    use crate::cmake::jobs::{self, JobEvent};
    let jobs = jobs.inner().clone();
    let label = window.label().to_owned();
    blocking(move || {
        let root = crate::project::root(&root)?;
        let key = format!("{label}|cargo|{}", root.display());
        if jobs.busy(&key) {
            return Err("A Cargo task is already running for this project".into());
        }
        let sink: Arc<dyn Fn(JobEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = events.send(event);
        });
        let say = |text: String| sink(JobEvent::Output { text: text + "\n" });
        let manifest = manifest(&root)?;
        let program = require_cargo(&app)?;
        let id = match &target {
            Some(id) => {
                let parsed =
                    TargetId::parse(id).ok_or_else(|| format!("Invalid Cargo target {id}"))?;
                if !metadata(&app, &root)?.targets.iter().any(|t| &t.id == id) {
                    return Err(format!("{} is not a target of this workspace", parsed.name));
                }
                Some(parsed)
            }
            None => None,
        };
        let project = crate::project::settings_for(&app, &root)?.cargo;
        let settings = settings(&app);
        let args = step_args(
            step,
            &crate::git::plain(&manifest),
            &project,
            &settings,
            id.as_ref(),
        );
        let name = format!("{step:?}").to_lowercase();
        say(format!("[{name}] {}", jobs::shown(&program, &args)));
        let started = std::time::Instant::now();
        let env = [("CARGO_TERM_COLOR".to_owned(), "never".to_owned())];
        let finished = jobs.run(
            &label,
            &key,
            &program,
            &args,
            &crate::git::plain(&root),
            &env,
            sink.clone(),
        )?;
        say(if finished.cancelled {
            format!("[{name}] Cancelled")
        } else {
            format!(
                "[{name}] Finished with exit code {} ({:.1} s)",
                finished.code.map_or("?".into(), |c| c.to_string()),
                started.elapsed().as_secs_f32()
            )
        });
        Ok(StepResult { finished })
    })
    .await
}
#[tauri::command]
pub fn cargo_cancel(
    window: tauri::WebviewWindow,
    jobs: tauri::State<crate::cmake::jobs::Jobs>,
    root: String,
) -> Result<(), String> {
    let root = crate::project::root(&root)?;
    jobs.cancel(
        window.label(),
        &format!("{}|cargo|{}", window.label(), root.display()),
    );
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInfo {
    settings: RustSettings,
    cargo: Option<String>,
    configured: bool,
}
fn settings_info(app: &tauri::AppHandle) -> Result<SettingsInfo, String> {
    let program = cargo_program(app)?;
    Ok(SettingsInfo {
        settings: stored(app)?.settings,
        configured: stored(app)?.cargo.is_some(),
        cargo: program.map(|(p, _)| p.display().to_string()),
    })
}
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn rust_settings(app: tauri::AppHandle) -> Result<SettingsInfo, String> {
    blocking(move || settings_info(&app)).await
}
#[tauri::command]
pub async fn rust_set_settings(
    app: tauri::AppHandle,
    settings: RustSettings,
) -> Result<SettingsInfo, String> {
    settings.validate()?;
    blocking(move || {
        update_stored(&app, |s| s.settings = settings)?;
        settings_info(&app)
    })
    .await
}
/// Lets the user pick cargo in a native dialog; `reset` goes back to detection.
#[tauri::command]
pub async fn rust_choose_cargo(
    app: tauri::AppHandle,
    reset: bool,
) -> Result<Option<SettingsInfo>, String> {
    let program = if reset {
        None
    } else {
        let Some(file) = rfd::AsyncFileDialog::new()
            .set_title("Choose the cargo program")
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
    blocking(move || {
        update_stored(&app, |s| s.cargo = program)?;
        settings_info(&app).map(Some)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_gets_rusts_settings_and_changes_are_refused() {
        let config = analyzer_config(&RustSettings::default());
        let sent = r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"initializationOptions":{"check":{"overrideCommand":["sh"]}}}}"#;
        let changed: Value =
            serde_json::from_str(&outgoing(sent, &config).unwrap().unwrap()).unwrap();
        assert_eq!(changed["params"]["initializationOptions"], config);
        assert!(
            outgoing(
                r#"{"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{}}"#,
                &config
            )
            .is_err()
        );
        // Other messages pass as they are, unparsed.
        assert_eq!(
            outgoing(
                r#"{"jsonrpc":"2.0","method":"textDocument/didOpen"}"#,
                &config
            )
            .unwrap(),
            None
        );
        // A file's text that mentions "initialize" is not an initialize request.
        let text = r#"{"jsonrpc":"2.0","method":"textDocument/didChange","params":{"text":"\"initialize\""}}"#;
        assert_eq!(outgoing(text, &config).unwrap(), None);
    }

    #[test]
    fn configuration_requests_are_answered_from_the_settings() {
        let config = analyzer_config(&RustSettings {
            check_command: CheckCommand::Clippy,
            ..Default::default()
        });
        let asked = r#"{"jsonrpc":"2.0","id":7,"method":"workspace/configuration","params":{"items":[{"section":"rust-analyzer"},{"section":"rust-analyzer.check.command"},{"section":"editor"}]}}"#;
        let answer: Value =
            serde_json::from_str(&configuration_answer(asked, &config).unwrap()).unwrap();
        assert_eq!(answer["id"], 7);
        assert_eq!(answer["result"][0], config);
        assert_eq!(answer["result"][1], "clippy");
        assert_eq!(answer["result"][2], Value::Null);
        assert!(configuration_answer(r#"{"method":"window/logMessage"}"#, &config).is_none());
    }

    #[test]
    fn build_scripts_and_proc_macros_follow_one_switch() {
        let off = analyzer_config(&RustSettings {
            build_scripts: false,
            check_on_save: false,
            ..Default::default()
        });
        assert_eq!(off["cargo"]["buildScripts"]["enable"], false);
        assert_eq!(off["procMacro"]["enable"], false);
        assert_eq!(off["checkOnSave"], false);
        // No setting the renderer could reach names a program.
        assert!(!off.to_string().contains("overrideCommand"));
    }

    #[test]
    fn target_ids_name_only_known_kinds_and_plain_names() {
        let id = TargetId::parse("cargo:bin:demo-app:demo_cli").unwrap();
        assert_eq!(id.kind, Kind::Bin);
        assert_eq!(id.args(), ["-p", "demo-app", "--bin", "demo_cli"]);
        assert_eq!(id.id(), "cargo:bin:demo-app:demo_cli");
        assert_eq!(
            TargetId::parse("cargo:lib:demo:demo").unwrap().args(),
            ["-p", "demo", "--lib"]
        );
        for bad in [
            "demo",
            "cargo:bin:demo",
            "cargo:shell:demo:x",
            "cargo:bin:demo:x:y",
            "cargo:bin:de mo:x",
            "cargo:bin:demo:--config=x",
            "cargo:bin::x",
        ] {
            assert!(TargetId::parse(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn steps_build_their_command_line_from_checked_names() {
        let manifest = Path::new("/w/Cargo.toml");
        let release = ProjectCargo {
            profile: "release".into(),
            ..Default::default()
        };
        let settings = RustSettings {
            offline: true,
            parallel_jobs: 4,
            ..Default::default()
        };
        let target = TargetId::parse("cargo:example:demo:hello").unwrap();
        assert_eq!(
            step_args(Step::Build, manifest, &release, &settings, Some(&target)),
            [
                "build",
                "--manifest-path",
                &manifest.display().to_string(),
                "--release",
                "-p",
                "demo",
                "--example",
                "hello",
                "-j",
                "4",
                "--offline",
                "--color",
                "never"
            ]
        );
        let plain = step_args(
            Step::Clippy,
            manifest,
            &ProjectCargo::default(),
            &RustSettings::default(),
            None,
        );
        assert_eq!(plain[0], "clippy");
        assert!(
            !plain.contains(&"--release".to_owned()) && !plain.contains(&"--offline".to_owned())
        );
        // Clean takes the profile, not a target.
        let clean = step_args(Step::Clean, manifest, &release, &settings, Some(&target));
        assert!(clean.contains(&"--release".to_owned()) && !clean.contains(&"-p".to_owned()));
        assert!(
            ProjectCargo {
                profile: "fast".into(),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
        assert!(
            ProjectCargo {
                run_target: Some("sh".into()),
                ..Default::default()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn metadata_lists_the_members_targets() {
        let text = r#"{
            "workspace_root": "/w",
            "target_directory": "/w/target",
            "workspace_members": ["path+file:///w#demo@0.1.0"],
            "packages": [{
                "id": "path+file:///w#demo@0.1.0",
                "name": "demo",
                "version": "0.1.0",
                "manifest_path": "/w/Cargo.toml",
                "targets": [
                    {"name": "demo", "kind": ["lib"], "src_path": "/w/src/lib.rs"},
                    {"name": "demo", "kind": ["bin"], "src_path": "/w/src/main.rs"},
                    {"name": "hello", "kind": ["example"], "src_path": "/w/examples/hello.rs"},
                    {"name": "build-script-build", "kind": ["custom-build"], "src_path": "/w/build.rs"},
                    {"name": "it", "kind": ["test"], "src_path": "/w/tests/it.rs"}
                ]
            }, {
                "id": "registry+serde", "name": "serde", "version": "1.0.0",
                "manifest_path": "/r/serde/Cargo.toml", "targets": []
            }]
        }"#;
        let meta = parse_metadata(text).unwrap();
        assert_eq!(meta.target_directory, PathBuf::from("/w/target"));
        assert_eq!(meta.packages.len(), 1);
        assert_eq!(meta.packages[0].dir, PathBuf::from("/w"));
        let ids: Vec<&str> = meta.targets.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "cargo:lib:demo:demo",
                "cargo:bin:demo:demo",
                "cargo:example:demo:hello",
                "cargo:test:demo:it"
            ]
        );
        assert!(parse_metadata("{}").is_err());
    }

    #[test]
    fn rustc_hosts_tell_the_debugger_abi() {
        let msvc =
            toolchain_of("rustc 1.92.0\nhost: x86_64-pc-windows-msvc\nrelease: 1.92.0\n").unwrap();
        assert_eq!(msvc.simulate, "MSVC");
        assert_eq!(msvc.version, "rustc 1.92.0");
        assert_eq!(
            crate::debug::suitable(&msvc).unwrap(),
            [crate::debug::Adapter::Lldb]
        );
        let gnu = toolchain_of("host: x86_64-unknown-linux-gnu\nrelease: 1.92.0").unwrap();
        assert_eq!(
            crate::debug::suitable(&gnu).unwrap()[0],
            crate::debug::Adapter::Gdb
        );
        let mac = toolchain_of("host: aarch64-apple-darwin\n").unwrap();
        assert_eq!(
            crate::debug::suitable(&mac).unwrap()[0],
            crate::debug::Adapter::Lldb
        );
        assert!(toolchain_of("nothing").is_none());
    }

    /// With Cargo installed: its metadata read, a build from `step_args`, and the program
    /// where Run looks for it.
    #[test]
    fn real_cargo_builds_the_program_where_run_finds_it() {
        let cargo = exe("cargo");
        if Command::new(&cargo).arg("--version").output().is_err() {
            eprintln!("cargo is not installed; skipped");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"demo-app\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("examples")).unwrap();
        fs::write(
            root.join("src/main.rs"),
            "fn main() { println!(\"hi\"); }\n",
        )
        .unwrap();
        fs::write(root.join("examples/hello.rs"), "fn main() {}\n").unwrap();
        let manifest = crate::git::plain(&root.join("Cargo.toml"));
        let out = Command::new(&cargo)
            .args([
                "metadata",
                "--format-version",
                "1",
                "--no-deps",
                "--offline",
            ])
            .arg("--manifest-path")
            .arg(&manifest)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let meta = parse_metadata(&String::from_utf8_lossy(&out.stdout)).unwrap();
        let ids: Vec<&str> = meta.targets.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "cargo:bin:demo-app:demo-app",
                "cargo:example:demo-app:hello"
            ]
        );
        let project = ProjectCargo::default();
        let settings = RustSettings {
            offline: true,
            ..Default::default()
        };
        for target in &meta.targets {
            let id = TargetId::parse(&target.id).unwrap();
            let args = step_args(Step::Build, &manifest, &project, &settings, Some(&id));
            let status = Command::new(&cargo)
                .args(&args)
                .current_dir(&root)
                .env("CARGO_TARGET_DIR", &meta.target_directory)
                .status()
                .unwrap();
            assert!(status.success());
            let program = program_path(&meta, &project, &id);
            assert!(program.is_file(), "{}", program.display());
        }
    }
}
