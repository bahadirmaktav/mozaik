use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

/// App-wide choices from Workspace Settings, shared by every window.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Preferences {
    /// Shortcut ID to keys, only where the user changed the default (`""` unbinds).
    pub keybindings: BTreeMap<String, String>,
    /// Opacity of the window's contents, from 0.3 to 1.
    pub opacity: f64,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            keybindings: BTreeMap::new(),
            opacity: 1.0,
        }
    }
}
impl Preferences {
    fn validate(&self) -> Result<(), String> {
        if !(0.3..=1.0).contains(&self.opacity) {
            return Err("Opacity must be between 30% and 100%".into());
        }
        if self.keybindings.len() > 200 {
            return Err("Too many shortcuts".into());
        }
        for (id, keys) in &self.keybindings {
            let valid_id = !id.is_empty()
                && id.len() <= 40
                && id
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.');
            if !valid_id || keys.chars().count() > 40 || keys.chars().any(char::is_control) {
                return Err(format!("Invalid shortcut {id}"));
            }
        }
        Ok(())
    }
}

static LOCK: Mutex<()> = Mutex::new(());
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("preferences.json"))
}
fn load(path: &std::path::Path) -> Result<Preferences, String> {
    let Ok(bytes) = fs::read(path) else {
        return Ok(Preferences::default());
    };
    serde_json::from_slice::<Preferences>(&bytes)
        .ok()
        .filter(|p| p.validate().is_ok())
        .ok_or_else(|| {
            format!(
                "The settings file is damaged; defaults are used until settings change: {}",
                path.display()
            )
        })
}

#[tauri::command]
pub fn get_preferences(app: tauri::AppHandle) -> Result<Preferences, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    load(&path(&app)?)
}
/// Saves the choices and tells every window, so all of them follow at once.
#[tauri::command]
pub fn set_preferences(
    app: tauri::AppHandle,
    preferences: Preferences,
) -> Result<Preferences, String> {
    preferences.validate()?;
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let path = path(&app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(&preferences).map_err(|e| e.to_string())?,
    )?;
    app.emit("preferences-changed", &preferences)
        .map_err(|e| e.to_string())?;
    Ok(preferences)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_sensible_preferences_are_kept() {
        let mut preferences = Preferences::default();
        assert!(preferences.validate().is_ok());
        preferences.opacity = 0.1;
        assert!(preferences.validate().is_err());
        preferences.opacity = 0.8;
        preferences
            .keybindings
            .insert("code.line".into(), "Ctrl+Shift+L".into());
        assert!(preferences.validate().is_ok());
        preferences
            .keybindings
            .insert("../x".into(), "Ctrl+K".into());
        assert!(preferences.validate().is_err());

        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("preferences.json");
        assert_eq!(load(&file).unwrap(), Preferences::default());
        fs::write(&file, br#"{"opacity": 0.5}"#).unwrap();
        assert_eq!(load(&file).unwrap().opacity, 0.5);
        fs::write(&file, b"{broken").unwrap();
        assert!(load(&file).is_err());
    }
}
