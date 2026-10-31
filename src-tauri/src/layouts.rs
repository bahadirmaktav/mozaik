//! Layout templates: named arrangements of modules the user saved from a workspace and can
//! open again from the command palette. Only the layout is kept (which modules, how they
//! are split and floated), never documents, folders or sessions. They live in
//! `layouts.json` in the app config directory, shared by every window; a damaged file is
//! reported and never overwritten.
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

const MAX_TEMPLATES: usize = 50;
const MAX_PANELS: usize = 64;
const MAX_TABS: usize = 20;
const MAX_DEPTH: usize = 32;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Axis {
    X,
    Y,
}
/// A panel's modules (plugin IDs, in tab order) or a split of two parts.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Node {
    Panel {
        tabs: Vec<String>,
    },
    Split {
        axis: Axis,
        ratio: f64,
        /// Editor groups of one Text Editor.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        group: bool,
        first: Box<Node>,
        second: Box<Node>,
    },
}
/// A floating panel; its rectangle is relative to the workspace area (0 to 1).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Floating {
    pub tabs: Vec<String>,
    pub rect: [f64; 4],
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Template {
    pub name: String,
    pub root: Option<Node>,
    #[serde(default)]
    pub floating: Vec<Floating>,
}
#[derive(Serialize, Deserialize, Default, Debug, PartialEq)]
struct File {
    version: u32,
    templates: Vec<Template>,
}

fn valid_tabs(tabs: &[String], panels: &mut usize) -> Result<(), String> {
    *panels += 1;
    if *panels > MAX_PANELS || tabs.is_empty() || tabs.len() > MAX_TABS {
        return Err("This layout has too many panels or tabs".into());
    }
    for plugin in tabs {
        if plugin.is_empty()
            || plugin.len() > 40
            || !plugin
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err(format!("Unknown module {plugin:?}"));
        }
    }
    Ok(())
}
fn valid_node(node: &Node, depth: usize, panels: &mut usize) -> Result<(), String> {
    if depth > MAX_DEPTH {
        return Err("This layout is nested too deeply".into());
    }
    match node {
        Node::Panel { tabs } => valid_tabs(tabs, panels),
        Node::Split {
            ratio,
            first,
            second,
            ..
        } => {
            if !(ratio.is_finite() && *ratio > 0.0 && *ratio < 1.0) {
                return Err("Invalid split in this layout".into());
            }
            valid_node(first, depth + 1, panels)?;
            valid_node(second, depth + 1, panels)
        }
    }
}
impl Template {
    fn validate(&self) -> Result<(), String> {
        let name = self.name.trim();
        if name.is_empty() || name.chars().count() > 60 || name.chars().any(char::is_control) {
            return Err("A template name has 1 to 60 characters".into());
        }
        if self.root.is_none() && self.floating.is_empty() {
            return Err("The workspace is empty: there is no layout to save".into());
        }
        let mut panels = 0;
        if let Some(root) = &self.root {
            valid_node(root, 0, &mut panels)?;
        }
        for floating in &self.floating {
            valid_tabs(&floating.tabs, &mut panels)?;
            if !floating
                .rect
                .iter()
                .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
            {
                return Err("Invalid floating panel in this layout".into());
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
        .join("layouts.json"))
}
fn load(path: &std::path::Path) -> Result<File, String> {
    let Ok(bytes) = fs::read(path) else {
        return Ok(File::default());
    };
    serde_json::from_slice::<File>(&bytes)
        .ok()
        .filter(|f| f.templates.len() <= MAX_TEMPLATES)
        .filter(|f| f.templates.iter().all(|t| t.validate().is_ok()))
        .ok_or_else(|| {
            format!(
                "The layout templates file is damaged and was left as it is: {}",
                path.display()
            )
        })
}
fn store(app: &tauri::AppHandle, path: &std::path::Path, file: &File) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        path,
        &serde_json::to_vec_pretty(file).map_err(|e| e.to_string())?,
    )?;
    app.emit("layouts-changed", ()).map_err(|e| e.to_string())
}
/// Adds `template`, or with `replace` puts it in place of the one with its name.
fn add(file: &mut File, template: Template, replace: bool) -> Result<(), String> {
    template.validate()?;
    let template = Template {
        name: template.name.trim().to_string(),
        ..template
    };
    let same = |t: &Template| t.name.to_lowercase() == template.name.to_lowercase();
    match file.templates.iter().position(same) {
        Some(index) if replace => file.templates[index] = template,
        Some(_) => return Err(format!("A template named “{}” exists", template.name)),
        None if file.templates.len() >= MAX_TEMPLATES => {
            return Err(format!("There are already {MAX_TEMPLATES} templates"));
        }
        None => file.templates.push(template),
    }
    file.templates.sort_by_cached_key(|t| t.name.to_lowercase());
    file.version = 1;
    Ok(())
}

#[tauri::command]
pub fn layouts_list(app: tauri::AppHandle) -> Result<Vec<Template>, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    Ok(load(&path(&app)?)?.templates)
}
#[tauri::command]
pub fn layouts_save(
    app: tauri::AppHandle,
    template: Template,
    replace: bool,
) -> Result<Vec<Template>, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let path = path(&app)?;
    let mut file = load(&path)?;
    add(&mut file, template, replace)?;
    store(&app, &path, &file)?;
    Ok(file.templates)
}
#[tauri::command]
pub fn layouts_delete(app: tauri::AppHandle, name: String) -> Result<Vec<Template>, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let path = path(&app)?;
    let mut file = load(&path)?;
    file.templates.retain(|t| t.name != name);
    store(&app, &path, &file)?;
    Ok(file.templates)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn panel(plugin: &str) -> Box<Node> {
        Box::new(Node::Panel {
            tabs: vec![plugin.into()],
        })
    }
    fn template(name: &str) -> Template {
        Template {
            name: name.into(),
            root: Some(Node::Split {
                axis: Axis::X,
                ratio: 0.3,
                group: false,
                first: panel("file-manager"),
                second: panel("text-editor"),
            }),
            floating: vec![],
        }
    }

    #[test]
    fn templates_are_named_validated_and_never_replaced_silently() {
        let mut file = File::default();
        add(&mut file, template("Writing"), false).unwrap();
        add(&mut file, template("coding"), false).unwrap();
        assert_eq!(
            file.templates
                .iter()
                .map(|t| &t.name[..])
                .collect::<Vec<_>>(),
            ["coding", "Writing"]
        );
        assert!(
            add(&mut file, template("writing"), false)
                .unwrap_err()
                .contains("exists")
        );
        let mut wider = template(" Writing ");
        if let Some(Node::Split { ratio, .. }) = &mut wider.root {
            *ratio = 0.5;
        }
        add(&mut file, wider.clone(), true).unwrap();
        assert_eq!(file.templates.len(), 2);
        assert_eq!(file.templates[1].name, "Writing");

        assert!(add(&mut file, template(""), false).is_err());
        let mut bad = template("Bad");
        bad.root = Some(Node::Panel {
            tabs: vec!["../x".into()],
        });
        assert!(add(&mut file, bad, false).is_err());
        let mut bad = template("Bad");
        if let Some(Node::Split { ratio, .. }) = &mut bad.root {
            *ratio = 1.0;
        }
        assert!(add(&mut file, bad, false).is_err());
        let empty = Template {
            name: "Empty".into(),
            root: None,
            floating: vec![],
        };
        assert!(add(&mut file, empty, false).is_err());
    }

    #[test]
    fn a_damaged_file_is_reported_and_groups_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("layouts.json");
        assert!(load(&path).unwrap().templates.is_empty());
        let mut grouped = template("Groups");
        if let Some(Node::Split { group, .. }) = &mut grouped.root {
            *group = true;
        }
        let file = File {
            version: 1,
            templates: vec![grouped.clone()],
        };
        fs::write(&path, serde_json::to_vec(&file).unwrap()).unwrap();
        assert_eq!(load(&path).unwrap().templates, vec![grouped]);
        fs::write(&path, b"{broken").unwrap();
        assert!(load(&path).unwrap_err().contains("damaged"));
    }
}
