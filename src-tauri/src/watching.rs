use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use tauri::{Emitter, State, WebviewWindow};

/// Non-recursive directory watches shared by editor documents (their parent folder) and
/// File Manager views (the displayed folder), reference-counted per window and owner ID.
pub struct Watches {
    watcher: Mutex<RecommendedWatcher>,
    paths: Mutex<HashMap<(String, String), PathBuf>>,
}
impl Watches {
    pub fn new(app: tauri::AppHandle) -> Result<Self, String> {
        let watcher =
            notify::recommended_watcher(move |event: Result<notify::Event, notify::Error>| {
                match event {
                    // Paths let views ignore unrelated folders; an empty list (for example a
                    // rescan after an overflow) means "anything may have changed".
                    Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
                        let paths: Vec<String> = if event.need_rescan() {
                            Vec::new()
                        } else {
                            event
                                .paths
                                .iter()
                                .map(|p| p.to_string_lossy().into_owned())
                                .collect()
                        };
                        let _ = app.emit("disk-change", paths);
                    }
                    Err(error) => {
                        let _ = app.emit("watch-error", error.to_string());
                    }
                    _ => (),
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            watcher: Mutex::new(watcher),
            paths: Mutex::new(HashMap::new()),
        })
    }
    pub fn remove_window(&self, label: &str) {
        let Ok(mut paths) = self.paths.lock() else {
            return;
        };
        let old: Vec<_> = paths.values().cloned().collect();
        paths.retain(|(window, _), _| window != label);
        if let Ok(mut watcher) = self.watcher.lock() {
            for dir in old {
                if !paths.values().any(|p| p == &dir) {
                    let _ = watcher.unwatch(&dir);
                }
            }
        }
    }
    fn set(&self, window: &str, id: String, new: Option<PathBuf>) -> Result<(), String> {
        uuid::Uuid::parse_str(&id).map_err(|_| "Invalid watch owner ID")?;
        let mut paths = self.paths.lock().map_err(|e| e.to_string())?;
        let mut watcher = self.watcher.lock().map_err(|e| e.to_string())?;
        let key = (window.to_string(), id);
        if paths.get(&key) == new.as_ref() {
            return Ok(());
        }
        if let Some(dir) = &new
            && !paths.values().any(|p| p == dir)
        {
            watcher
                .watch(dir, RecursiveMode::NonRecursive)
                .map_err(|e| e.to_string())?;
        }
        let old = paths.remove(&key);
        if let Some(dir) = new {
            paths.insert(key, dir);
        }
        if let Some(dir) = old
            && !paths.values().any(|p| p == &dir)
        {
            watcher.unwatch(&dir).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
#[tauri::command]
pub fn watch_document(
    window: WebviewWindow,
    state: State<Watches>,
    id: String,
    path: Option<String>,
) -> Result<(), String> {
    let new = path
        .map(|p| {
            PathBuf::from(p)
                .parent()
                .map(|p| p.to_path_buf())
                .ok_or("File has no parent")
        })
        .transpose()?;
    state.set(window.label(), id, new)
}
/// Watches the folder a File Manager view displays; `None` releases it.
#[tauri::command]
pub fn watch_directory(
    window: WebviewWindow,
    state: State<Watches>,
    id: String,
    path: Option<String>,
) -> Result<(), String> {
    let new = path.map(|p| crate::directory::resolve(&p)).transpose()?;
    state.set(window.label(), id, new)
}
