//! Rust projects (see `docs/decisions/033-rust.md`), after VS Code's rust-analyzer extension:
//! finding rustup's tools, the settings of Workspace Settings → IDE → Rust and the
//! configuration rust-analyzer gets. Rust builds that configuration; the renderer never sends
//! rust-analyzer settings, which can name commands (`overrideCommand`) for it to run.
use crate::cmake::kits;
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
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
}
