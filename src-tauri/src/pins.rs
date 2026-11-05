//! Application-wide pinned files and folders. Stored only in the local app config directory;
//! paths are never logged. Pins are added and ordered by the user only.
use crate::directory::{blocking, display, identity, resolve};
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Pin {
    pub id: String,
    pub path: String,
    /// What the target was when pinned; kept so a missing pin still shows a sensible icon.
    pub kind: String,
    /// The name the user gave it; without one it shows the target's own name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}
#[derive(Serialize, Debug)]
pub struct PinView {
    #[serde(flatten)]
    pin: Pin,
    name: String,
    missing: bool,
}
#[derive(Clone)]
pub struct Pins {
    file: PathBuf,
    gate: Arc<Mutex<()>>,
}
impl Pins {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            file: directory.join("pins.json"),
            gate: Arc::new(Mutex::new(())),
        }
    }
    fn load(&self) -> Result<Vec<Pin>, String> {
        match fs::read(&self.file) {
            Ok(data) => serde_json::from_slice(&data).map_err(|_| {
                // Never replace a damaged file: the user's pins may still be recoverable from it.
                format!(
                    "The pinned items file is damaged and was left unchanged: {}",
                    display(&self.file)
                )
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(e.to_string()),
        }
    }
    /// Read-modify-write under an in-process gate and a cross-process file lock.
    fn update(
        &self,
        change: impl FnOnce(&mut Vec<Pin>) -> Result<(), String>,
    ) -> Result<Vec<Pin>, String> {
        let _guard = self.gate.lock().map_err(|e| e.to_string())?;
        let directory = self.file.parent().ok_or("Invalid settings directory")?;
        fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("pins.lock"))
            .map_err(|e| e.to_string())?;
        fs2::FileExt::lock_exclusive(&lock).map_err(|e| e.to_string())?;
        let mut pins = self.load()?;
        change(&mut pins)?;
        atomic_write(
            &self.file,
            &serde_json::to_vec_pretty(&pins).map_err(|e| e.to_string())?,
        )?;
        Ok(pins)
    }
    pub fn list(&self) -> Result<Vec<Pin>, String> {
        let _guard = self.gate.lock().map_err(|e| e.to_string())?;
        self.load()
    }
    pub fn add(&self, path: &Path) -> Result<Vec<Pin>, String> {
        let metadata =
            fs::metadata(path).map_err(|_| format!("{} does not exist", display(path)))?;
        let key = identity(path);
        self.update(|pins| {
            // Same lexical identity only: links are not resolved, so distinct user-chosen paths stay distinct.
            if !pins.iter().any(|p| identity(Path::new(&p.path)) == key) {
                pins.push(Pin {
                    id: uuid::Uuid::new_v4().to_string(),
                    path: display(path),
                    kind: if metadata.is_dir() {
                        "directory"
                    } else {
                        "file"
                    }
                    .into(),
                    label: None,
                });
            }
            Ok(())
        })
    }
    pub fn remove(&self, id: &str) -> Result<Vec<Pin>, String> {
        self.update(|pins| {
            pins.retain(|p| p.id != id);
            Ok(())
        })
    }
    /// Names a pin; an empty name goes back to the target's own. The file is not touched.
    pub fn rename(&self, id: &str, name: &str) -> Result<Vec<Pin>, String> {
        let name = name.trim();
        if name.chars().count() > 120 || name.chars().any(char::is_control) {
            return Err("A pin's name is at most 120 characters, on one line".into());
        }
        self.update(|pins| {
            let pin = pins
                .iter_mut()
                .find(|p| p.id == id)
                .ok_or("Pinned items changed meanwhile; try again")?;
            pin.label = (!name.is_empty()).then(|| name.to_owned());
            Ok(())
        })
    }
    pub fn reorder(&self, ids: &[String]) -> Result<Vec<Pin>, String> {
        self.update(|pins| {
            let mut ordered = Vec::with_capacity(pins.len());
            for id in ids {
                if let Some(index) = pins.iter().position(|p| &p.id == id) {
                    ordered.push(pins.remove(index));
                }
            }
            if !pins.is_empty() || ordered.len() != ids.len() {
                return Err("Pinned items changed meanwhile; try again".into());
            }
            *pins = ordered;
            Ok(())
        })
    }
}
fn views(pins: Vec<Pin>) -> Vec<PinView> {
    pins.into_iter()
        .map(|pin| {
            let path = Path::new(&pin.path);
            PinView {
                name: pin.label.clone().unwrap_or_else(|| {
                    path.file_name()
                        .map(|n| n.to_string_lossy().into_owned())
                        .unwrap_or_else(|| pin.path.clone())
                }),
                missing: fs::metadata(path).is_err(),
                pin,
            }
        })
        .collect()
}
pub fn storage(app: &tauri::AppHandle) -> Result<Pins, String> {
    Ok(Pins::new(
        app.path().app_config_dir().map_err(|e| e.to_string())?,
    ))
}
fn changed(app: &tauri::AppHandle, pins: Vec<Pin>) -> Vec<PinView> {
    let _ = app.emit("pins-changed", ());
    views(pins)
}
#[tauri::command]
pub async fn pins_list(state: State<'_, Pins>) -> Result<Vec<PinView>, String> {
    let pins = state.inner().clone();
    blocking(move || pins.list().map(views)).await
}
#[tauri::command]
pub async fn pins_add(
    app: tauri::AppHandle,
    state: State<'_, Pins>,
    path: String,
) -> Result<Vec<PinView>, String> {
    let pins = state.inner().clone();
    blocking(move || Ok(changed(&app, pins.add(&resolve(&path)?)?))).await
}
#[tauri::command]
pub async fn pins_remove(
    app: tauri::AppHandle,
    state: State<'_, Pins>,
    id: String,
) -> Result<Vec<PinView>, String> {
    let pins = state.inner().clone();
    blocking(move || Ok(changed(&app, pins.remove(&id)?))).await
}
#[tauri::command]
pub async fn pins_reorder(
    app: tauri::AppHandle,
    state: State<'_, Pins>,
    ids: Vec<String>,
) -> Result<Vec<PinView>, String> {
    let pins = state.inner().clone();
    blocking(move || Ok(changed(&app, pins.reorder(&ids)?))).await
}

#[tauri::command]
pub async fn pins_rename(
    app: tauri::AppHandle,
    state: State<'_, Pins>,
    id: String,
    name: String,
) -> Result<Vec<PinView>, String> {
    let pins = state.inner().clone();
    blocking(move || Ok(changed(&app, pins.rename(&id, &name)?))).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pin_keeps_its_name_until_it_is_cleared() {
        let config = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let file = data.path().join("a.txt");
        fs::write(&file, b"").unwrap();
        let pins = Pins::new(config.path().to_path_buf());
        let id = pins.add(&file).unwrap()[0].id.clone();
        pins.rename(&id, "  Plans ").unwrap();
        let reopened = Pins::new(config.path().to_path_buf());
        assert_eq!(views(reopened.list().unwrap())[0].name, "Plans");
        assert!(reopened.rename(&id, "two\nlines").is_err());
        assert!(reopened.rename("nope", "x").is_err());
        reopened.rename(&id, "").unwrap();
        assert_eq!(views(reopened.list().unwrap())[0].name, "a.txt");
        // Files written before names existed still load.
        fs::write(
            config.path().join("pins.json"),
            r#"[{"id":"1","path":"/x","kind":"file"}]"#,
        )
        .unwrap();
        assert_eq!(reopened.list().unwrap()[0].label, None);
    }

    #[test]
    fn pins_persist_in_order_without_duplicates_and_survive_missing_targets() {
        let config = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let (a, b) = (data.path().join("a.txt"), data.path().join("folder"));
        fs::write(&a, b"").unwrap();
        fs::create_dir(&b).unwrap();
        let pins = Pins::new(config.path().to_path_buf());
        pins.add(&a).unwrap();
        pins.add(&b).unwrap();
        let list = pins.add(&b.join(".").join("..").join("folder")).unwrap();
        assert_eq!(list.len(), 2, "same normalized path is not pinned twice");
        let ids: Vec<_> = list.iter().rev().map(|p| p.id.clone()).collect();
        pins.reorder(&ids).unwrap();
        assert!(
            pins.reorder(&ids[..1]).is_err(),
            "partial order is rejected"
        );
        fs::remove_file(&a).unwrap();
        let reopened = Pins::new(config.path().to_path_buf());
        let shown = views(reopened.list().unwrap());
        assert_eq!(shown[0].pin.kind, "directory");
        assert!(shown[1].missing, "a missing target keeps its pin");
        reopened.remove(&shown[1].pin.id).unwrap();
        assert_eq!(reopened.list().unwrap().len(), 1);
    }
    #[test]
    fn damaged_pin_file_is_reported_and_kept() {
        let config = tempfile::tempdir().unwrap();
        fs::write(config.path().join("pins.json"), b"{broken").unwrap();
        let pins = Pins::new(config.path().to_path_buf());
        assert!(pins.list().is_err());
        assert!(pins.add(config.path()).is_err());
        assert_eq!(
            fs::read(config.path().join("pins.json")).unwrap(),
            b"{broken"
        );
    }
}
