//! Plugins with one panel per application (Tasks, Notes): which window shows each panel.
use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Default)]
pub struct PanelOwner(Mutex<HashMap<&'static str, String>>);
impl PanelOwner {
    /// Claims `plugin`'s panel for this window. When another window already shows it, that
    /// window is raised and asked to focus its panel, and `false` is returned.
    pub fn claim(&self, window: &WebviewWindow, plugin: &'static str) -> Result<bool, String> {
        let mut owners = self.0.lock().map_err(|e| e.to_string())?;
        if let Some(label) = owners.get(plugin)
            && label != window.label()
            && let Some(other) = window.app_handle().get_webview_window(label)
        {
            let _ = other.unminimize();
            let _ = other.set_focus();
            let _ = other.emit_to(label.as_str(), "focus-plugin", plugin);
            return Ok(false);
        }
        owners.insert(plugin, window.label().into());
        Ok(true)
    }
    pub fn release(&self, label: &str, plugin: &str) {
        if let Ok(mut owners) = self.0.lock()
            && owners.get(plugin).is_some_and(|l| l == label)
        {
            owners.remove(plugin);
        }
    }
    pub fn release_window(&self, label: &str) {
        if let Ok(mut owners) = self.0.lock() {
            owners.retain(|_, l| l != label);
        }
    }
}
