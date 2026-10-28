use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use tauri::{Emitter, State, WebviewWindow};

pub struct Watches {
    watcher: Mutex<RecommendedWatcher>,
    paths: Mutex<HashMap<(String, String), PathBuf>>,
}
impl Watches {
    pub fn new(app: tauri::AppHandle) -> Result<Self, String> {
        let watcher =
            notify::recommended_watcher(move |event: Result<notify::Event, notify::Error>| {
                match event {
                    Ok(event) if !matches!(event.kind, notify::EventKind::Access(_)) => {
                        let _ = app.emit("disk-change", ());
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
}
#[tauri::command]
pub fn watch_document(
    window: WebviewWindow,
    state: State<Watches>,
    id: String,
    path: Option<String>,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "Invalid document ID")?;
    let mut paths = state.paths.lock().map_err(|e| e.to_string())?;
    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    let key = (window.label().to_string(), id);
    let new = path
        .map(|p| {
            PathBuf::from(p)
                .parent()
                .map(|p| p.to_path_buf())
                .ok_or("File has no parent")
        })
        .transpose()?;
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
