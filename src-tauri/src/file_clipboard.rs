//! The files cut or copied in a File Manager or an IDE Explorer, shared by every window. Kept
//! in a small app data file, so windows of another Mozaik process (`mozaik -ide <path>`) paste
//! them too: they read it when they get focus. Only the paths are kept; a paste still goes
//! through `operations.rs`, which validates everything and asks before replacing.
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Mutex, PoisonError,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Emitter, Manager};

const MAX_PATHS: usize = 100_000;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Copy,
    Move,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Contents {
    pub mode: Mode,
    pub paths: Vec<String>,
}
/// Whether this process put the file there, so it can take it away when it exits: what was cut
/// before a restart should not look cut after it.
#[derive(Default)]
pub struct FileClipboard(AtomicBool);
static LOCK: Mutex<()> = Mutex::new(());

fn location(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("file-clipboard.json"))
}
fn read(path: &Path) -> Option<Contents> {
    let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}
fn write(path: &Path, contents: Option<&Contents>) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(PoisonError::into_inner);
    let Some(contents) = contents else {
        return match fs::remove_file(path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        };
    };
    fs::create_dir_all(path.parent().ok_or("Invalid data folder")?).map_err(|e| e.to_string())?;
    atomic_write(
        path,
        &serde_json::to_vec(contents).map_err(|e| e.to_string())?,
    )
}
#[tauri::command]
pub fn file_clipboard_get(app: tauri::AppHandle) -> Result<Option<Contents>, String> {
    Ok(read(&location(&app)?))
}
/// Replaces the contents (`None` empties them) and tells every window of this process.
#[tauri::command]
pub fn file_clipboard_set(
    app: tauri::AppHandle,
    state: tauri::State<FileClipboard>,
    contents: Option<Contents>,
) -> Result<(), String> {
    if contents.as_ref().is_some_and(|c| c.paths.len() > MAX_PATHS) {
        return Err("Too many items to keep on the clipboard".into());
    }
    write(&location(&app)?, contents.as_ref())?;
    state.0.store(contents.is_some(), Ordering::Relaxed);
    let _ = app.emit("file-clipboard-changed", contents);
    Ok(())
}
/// At exit: the contents this process left go with it.
pub fn clear_own(app: &tauri::AppHandle) {
    if app.state::<FileClipboard>().0.load(Ordering::Relaxed)
        && let Ok(path) = location(app)
    {
        let _ = write(&path, None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contents_survive_between_readers_and_go_when_emptied() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("deep/file-clipboard.json");
        assert_eq!(read(&path), None);
        let contents = Contents {
            mode: Mode::Move,
            paths: vec!["C:\\a.txt".into(), "/b".into()],
        };
        write(&path, Some(&contents)).unwrap();
        assert_eq!(read(&path), Some(contents));
        write(&path, None).unwrap();
        assert_eq!(read(&path), None);
        write(&path, None).unwrap();
    }
    #[test]
    fn a_damaged_file_reads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file-clipboard.json");
        fs::write(&path, "{broken").unwrap();
        assert_eq!(read(&path), None);
    }
}
