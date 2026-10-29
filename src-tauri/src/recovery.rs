use crate::files::atomic_write;
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Manager, State, WebviewWindow};

#[derive(Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub name: String,
    pub text: String,
    pub bom: bool,
    pub ending: String,
    /// `None` for text documents, `"drawing"` for Excalidraw scenes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}
#[derive(Serialize)]
pub struct Recovery {
    key: String,
    #[serde(flatten)]
    snapshot: Snapshot,
}
#[derive(Clone)]
pub struct Storage {
    pub root: PathBuf,
    pub session: PathBuf,
    pub _lock: Arc<fs::File>,
    pub gate: Arc<Mutex<()>>,
}
impl Storage {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let session = root.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&session).map_err(|e| e.to_string())?;
        let lock = fs::OpenOptions::new()
            .create_new(true)
            .read(true)
            .write(true)
            .open(session.join("active.lock"))
            .map_err(|e| e.to_string())?;
        lock.lock_exclusive().map_err(|e| e.to_string())?;
        Ok(Self {
            root,
            session,
            _lock: Arc::new(lock),
            gate: Arc::new(Mutex::new(())),
        })
    }
    fn snapshot_path(&self, window: &str, id: &str) -> Result<PathBuf, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid document ID")?;
        if !window
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err("Invalid window label".into());
        }
        Ok(self.session.join(format!("{window}_{id}.json")))
    }
}
#[tauri::command]
pub async fn write_snapshot(
    window: WebviewWindow,
    storage: State<'_, Storage>,
    id: String,
    snapshot: Snapshot,
) -> Result<(), String> {
    let storage = storage.inner().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = storage.gate.lock().map_err(|e| e.to_string())?;
        if snapshot.text.len() > 64 * 1024 * 1024 {
            return Err("Recovery document exceeds safety limit".into());
        }
        if !matches!(snapshot.kind.as_deref(), None | Some("drawing")) {
            return Err("Unsupported recovery kind".into());
        }
        let path = storage.snapshot_path(&label, &id)?;
        atomic_write(
            &path,
            &serde_json::to_vec(&snapshot).map_err(|e| e.to_string())?,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn remove_snapshot(
    window: WebviewWindow,
    storage: State<Storage>,
    id: String,
) -> Result<(), String> {
    let _guard = storage.gate.lock().map_err(|e| e.to_string())?;
    remove(&storage.snapshot_path(window.label(), &id)?)
}
fn remove(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub fn clear_snapshots(window: WebviewWindow, storage: State<Storage>) -> Result<(), String> {
    let _guard = storage.gate.lock().map_err(|e| e.to_string())?;
    let prefix = format!("{}_", window.label());
    for entry in fs::read_dir(&storage.session).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            remove(&entry.path())?;
        }
    }
    Ok(())
}
fn inactive(session: &Path) -> Option<fs::File> {
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(session.join("active.lock"))
        .ok()?;
    file.try_lock_exclusive().ok()?;
    Some(file)
}
#[tauri::command]
pub async fn list_recovery(storage: State<'_, Storage>) -> Result<Vec<Recovery>, String> {
    let storage = storage.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = storage.gate.lock().map_err(|e| e.to_string())?;
        let mut result = Vec::new();
        for entry in fs::read_dir(&storage.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.path().is_dir() || entry.path() == storage.session {
                continue;
            }
            let Some(_lock) = inactive(&entry.path()) else {
                continue;
            };
            for file in fs::read_dir(entry.path()).map_err(|e| e.to_string())? {
                let file = file.map_err(|e| e.to_string())?;
                if file.path().extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                let data = fs::read(file.path()).map_err(|e| e.to_string())?;
                let snapshot = serde_json::from_slice(&data)
                    .map_err(|e| format!("Recovery snapshot is damaged (kept on disk): {e}"))?;
                result.push(Recovery {
                    key: format!(
                        "{}/{}",
                        entry.file_name().to_string_lossy(),
                        file.file_name().to_string_lossy()
                    ),
                    snapshot,
                });
            }
        }
        Ok(result)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn discard_recovery(storage: State<Storage>, key: String) -> Result<(), String> {
    let _guard = storage.gate.lock().map_err(|e| e.to_string())?;
    let components: Vec<_> = key.split('/').collect();
    if components.len() != 2
        || uuid::Uuid::parse_str(components[0]).is_err()
        || !components[1]
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        || !components[1].ends_with(".json")
        || components[1].contains("..")
    {
        return Err("Invalid recovery key".into());
    }
    let session = storage.root.join(components[0]);
    if session == storage.session {
        return Err("Cannot discard an active session".into());
    }
    let _lock = inactive(&session).ok_or("Recovery session is currently active")?;
    remove(&session.join(components[1]))
}
#[tauri::command]
pub fn get_modifier(app: tauri::AppHandle) -> Result<String, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("modifier.json");
    if !path.exists() {
        return Ok("Alt".into());
    }
    let value: String = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if !["Alt", "Control", "Shift"].contains(&value.as_str()) {
        return Err("Invalid stored modifier".into());
    }
    Ok(value)
}
#[tauri::command]
pub fn set_modifier(app: tauri::AppHandle, modifier: String) -> Result<(), String> {
    if !["Alt", "Control", "Shift"].contains(&modifier.as_str()) {
        return Err("Unsupported workspace modifier".into());
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    atomic_write(
        &dir.join("modifier.json"),
        &serde_json::to_vec(&modifier).map_err(|e| e.to_string())?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn live_sessions_are_not_recoverable_and_invalid_ids_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::new(dir.path().to_path_buf()).unwrap();
        assert!(inactive(&storage.session).is_none());
        assert!(storage.snapshot_path("main", "../escape").is_err());
        let path = storage.session.clone();
        drop(storage);
        assert!(inactive(&path).is_some());
    }
}
