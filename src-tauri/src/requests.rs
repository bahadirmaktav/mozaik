//! `mozaik --text <file>` run in a Mozaik terminal: the new process leaves a request in the
//! running Mozaik's request folder and ends, and the window whose terminal ran it opens the
//! file (decision 030). Mozaik has no single-instance mechanism and no socket: each process
//! watches a folder of its own under the app's local data, named by its process ID, and
//! every terminal it starts gets that folder and the session's ID in its environment.
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tauri::{Emitter, Manager};

/// The request folder of the Mozaik that started the terminal.
pub const FOLDER_ENV: &str = "MOZAIK_REQUESTS";
/// The terminal session that runs the shell; only that process knows it.
pub const TERMINAL_ENV: &str = "MOZAIK_TERMINAL";
// A path is far shorter; anything larger is not a request.
const MAX_REQUEST_BYTES: u64 = 64 * 1024;

static FOLDER: OnceLock<PathBuf> = OnceLock::new();

/// This process's request folder, once `start` made it.
pub fn folder() -> Option<&'static Path> {
    FOLDER.get().map(PathBuf::as_path)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TextRequest {
    /// The terminal session the command ran in.
    pub terminal: String,
    /// Absolute, resolved against the shell's current folder.
    pub path: String,
}

/// The path after `names` (`-t`, `--text`, …), relative to `cwd`.
pub fn argument(args: &[String], names: &[&str], cwd: &Path) -> Option<PathBuf> {
    let at = args.iter().position(|a| names.contains(&a.as_str()))?;
    let path = Path::new(args.get(at + 1)?);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    })
}

/// Hands `path` to the Mozaik whose terminal runs this process; false outside one, or when
/// that Mozaik has ended (the caller then opens a window of its own).
pub fn send(path: &Path) -> bool {
    let (Some(folder), Some(terminal)) = (
        std::env::var_os(FOLDER_ENV),
        std::env::var(TERMINAL_ENV).ok(),
    ) else {
        return false;
    };
    send_to(Path::new(&folder), &terminal, path).is_ok()
}
fn send_to(folder: &Path, terminal: &str, path: &Path) -> Result<(), String> {
    if !folder.is_dir() || uuid::Uuid::parse_str(terminal).is_err() {
        return Err("No Mozaik terminal".into());
    }
    let request = TextRequest {
        terminal: terminal.to_owned(),
        path: path.to_string_lossy().into_owned(),
    };
    let name = uuid::Uuid::new_v4().to_string();
    let partial = folder.join(format!("{name}.part"));
    fs::write(
        &partial,
        serde_json::to_vec(&request).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Complete requests only: the watcher reads `.json` files, which appear whole.
    fs::rename(&partial, folder.join(format!("{name}.json"))).map_err(|e| {
        let _ = fs::remove_file(&partial);
        e.to_string()
    })
}

/// Takes the complete requests in `folder`, removing each file it read.
fn take(folder: &Path) -> Vec<TextRequest> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let mut requests = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let small = entry
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() <= MAX_REQUEST_BYTES);
        let read = small.then(|| fs::read(&path).ok()).flatten();
        let _ = fs::remove_file(&path);
        if let Some(request) = read
            .and_then(|bytes| serde_json::from_slice::<TextRequest>(&bytes).ok())
            .filter(|r| {
                uuid::Uuid::parse_str(&r.terminal).is_ok() && Path::new(&r.path).is_absolute()
            })
        {
            requests.push(request);
        }
    }
    requests
}

/// Holds the watch on this process's request folder.
pub struct Requests {
    _watcher: Option<notify::RecommendedWatcher>,
}

/// Makes the request folder and watches it; each request goes to the window that owns its
/// terminal session as `text-request`. Without a folder, terminals simply get no variables.
pub fn start(app: &tauri::AppHandle) -> Requests {
    let watcher = (|| -> Result<_, String> {
        let base = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("requests");
        let folder = base.join(std::process::id().to_string());
        // A folder left by an earlier process with this ID holds nothing for this one.
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let handle = app.clone();
        let watched = folder.clone();
        let mut watcher = notify::recommended_watcher(move |_event| {
            for request in take(&watched) {
                let sessions = handle.state::<crate::terminal::TerminalSessions>();
                if let Some(window) = sessions.window_of(&request.terminal) {
                    let _ = handle.emit_to(window.as_str(), "text-request", &request);
                }
            }
        })
        .map_err(|e| e.to_string())?;
        watcher
            .watch(&folder, RecursiveMode::NonRecursive)
            .map_err(|e| e.to_string())?;
        let _ = FOLDER.set(folder);
        Ok(watcher)
    })();
    if let Err(error) = &watcher {
        eprintln!("mozaik: requests from terminals are unavailable: {error}");
    }
    Requests {
        _watcher: watcher.ok(),
    }
}
/// At exit: the folder goes, so later commands in old shells open windows of their own.
pub fn stop() {
    if let Some(folder) = folder() {
        let _ = fs::remove_dir_all(folder);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arguments_name_a_path_relative_to_the_current_folder() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        let cwd = Path::new("/work");
        let text = ["-t", "--text"];
        assert_eq!(
            argument(&args(&["-t", "a.txt"]), &text, cwd),
            Some(cwd.join("a.txt"))
        );
        assert_eq!(
            argument(&args(&["--text", "b/c.md"]), &text, cwd),
            Some(cwd.join("b/c.md"))
        );
        assert_eq!(argument(&args(&["-t"]), &text, cwd), None);
        assert_eq!(argument(&args(&["a.txt"]), &text, cwd), None);
        let absolute = std::env::temp_dir();
        assert_eq!(
            argument(&args(&["-t", &absolute.to_string_lossy()]), &text, cwd),
            Some(absolute)
        );
    }

    #[test]
    fn a_request_reaches_the_folder_once_and_whole() {
        let dir = tempfile::tempdir().unwrap();
        let terminal = uuid::Uuid::new_v4().to_string();
        let file = std::env::temp_dir().join("notes.txt");
        send_to(dir.path(), &terminal, &file).unwrap();
        // Not a session ID, or no folder: nothing is written.
        assert!(send_to(dir.path(), "not-a-session", &file).is_err());
        assert!(send_to(&dir.path().join("gone"), &terminal, &file).is_err());
        fs::write(dir.path().join("x.part"), "{").unwrap();
        fs::write(dir.path().join("bad.json"), "{").unwrap();
        let taken = take(dir.path());
        assert_eq!(
            taken,
            [TextRequest {
                terminal,
                path: file.to_string_lossy().into_owned()
            }]
        );
        assert!(take(dir.path()).is_empty());
        // A partial write stays for its writer; read requests are gone.
        assert!(dir.path().join("x.part").exists());
        assert!(!dir.path().join("bad.json").exists());
    }
}
