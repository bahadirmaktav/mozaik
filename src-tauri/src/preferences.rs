use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

/// Font family names from Workspace Settings; `None` keeps the default.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Fonts {
    /// The interface font; modules without their own font follow it.
    pub ui: Option<String>,
    /// The interface font replaces every module's own font.
    pub all: bool,
    pub text_editor: Option<String>,
    pub ide: Option<String>,
    pub terminal: Option<String>,
    pub file_manager: Option<String>,
    pub tasks: Option<String>,
    pub notes: Option<String>,
}
impl Fonts {
    fn names(&self) -> [&Option<String>; 7] {
        [
            &self.ui,
            &self.text_editor,
            &self.ide,
            &self.terminal,
            &self.file_manager,
            &self.tasks,
            &self.notes,
        ]
    }
}

/// App-wide choices from Workspace Settings, shared by every window.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Preferences {
    /// Shortcut ID to keys, only where the user changed the default (`""` unbinds).
    pub keybindings: BTreeMap<String, String>,
    /// Opacity of the window's contents, from 0.3 to 1.
    pub opacity: f64,
    /// The comment tags the IDE's TODO view lists and the code editor highlights.
    #[serde(rename = "todoTags")]
    pub todo_tags: Vec<String>,
    /// Text Editor lines wrap at the panel width, keeping their number and indentation.
    #[serde(rename = "wordWrap")]
    pub word_wrap: bool,
    /// The folder new terminals start in; `None` is the home folder. IDE terminals start
    /// in their project folder.
    #[serde(rename = "terminalFolder")]
    pub terminal_folder: Option<String>,
    /// The folder a new File Manager panel shows; `None` is the home folder.
    #[serde(rename = "fileManagerFolder")]
    pub file_manager_folder: Option<String>,
    /// The notes folder: notes are its Markdown files, groups its subfolders; `None` until
    /// the user chooses one.
    #[serde(rename = "notesFolder")]
    pub notes_folder: Option<String>,
    pub fonts: Fonts,
    /// A PowerShell script that new PowerShell terminals run after the user's profile,
    /// usually to set the prompt; `None` keeps the shell's own prompt.
    #[serde(rename = "powershellPrompt")]
    pub powershell_prompt: Option<String>,
    /// The color theme's ID; the renderer knows the themes and falls back to the default.
    pub theme: String,
    /// The text size of the IDE's code editors, in pixels.
    #[serde(rename = "ideFontSize")]
    pub ide_font_size: u32,
}
pub const DEFAULT_THEME: &str = "mozaik-dark";
pub const IDE_FONT_SIZES: std::ops::RangeInclusive<u32> = 8..=32;
pub const DEFAULT_TODO_TAGS: [&str; 7] = ["TODO", "FIXME", "BUG", "HACK", "XXX", "NOTE", "INFO"];
impl Default for Preferences {
    fn default() -> Self {
        Self {
            keybindings: BTreeMap::new(),
            opacity: 1.0,
            todo_tags: DEFAULT_TODO_TAGS.iter().map(|t| t.to_string()).collect(),
            word_wrap: true,
            terminal_folder: None,
            file_manager_folder: None,
            notes_folder: None,
            fonts: Fonts::default(),
            powershell_prompt: None,
            theme: DEFAULT_THEME.into(),
            ide_font_size: 13,
        }
    }
}
impl Preferences {
    fn validate(&self) -> Result<(), String> {
        if !(0.3..=1.0).contains(&self.opacity) {
            return Err("Opacity must be between 30% and 100%".into());
        }
        if self.theme.is_empty()
            || self.theme.len() > 40
            || !self
                .theme
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            return Err(format!("Invalid theme {:?}", self.theme));
        }
        if !IDE_FONT_SIZES.contains(&self.ide_font_size) {
            return Err(format!(
                "The IDE font size must be between {} and {} pixels",
                IDE_FONT_SIZES.start(),
                IDE_FONT_SIZES.end()
            ));
        }
        if self.todo_tags.len() > 50 {
            return Err("Too many TODO tags".into());
        }
        for tag in &self.todo_tags {
            if tag.is_empty()
                || tag.chars().count() > 30
                || tag.chars().any(|c| c.is_whitespace() || c.is_control())
            {
                return Err(format!(
                    "Invalid TODO tag {tag:?}: one word of up to 30 characters"
                ));
            }
        }
        for folder in [
            &self.terminal_folder,
            &self.file_manager_folder,
            &self.notes_folder,
        ]
        .into_iter()
        .flatten()
        {
            if folder.chars().count() > 1024
                || folder.chars().any(char::is_control)
                || !Path::new(folder).is_absolute()
            {
                return Err(format!(
                    "The folder {folder:?} must be a full path, like C:\\Projects or /home/me"
                ));
            }
        }
        if let Some(file) = &self.powershell_prompt
            && (file.chars().count() > 1024
                || file.chars().any(char::is_control)
                || !Path::new(file).is_absolute()
                || !is_script(Path::new(file)))
        {
            return Err(format!(
                "The PowerShell prompt {file:?} must be the full path of a .ps1 file"
            ));
        }
        // One family name each: it is written into CSS, so nothing may end the value.
        for name in self.fonts.names().into_iter().flatten() {
            if name.trim().is_empty()
                || name.chars().count() > 100
                || name
                    .chars()
                    .any(|c| c.is_control() || "\"'\\;:{}()<>,".contains(c))
            {
                return Err(format!("Invalid font {name:?}: one font family name"));
            }
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

/// Which start folder: new terminals or new File Manager panels.
pub enum Start {
    Terminal,
    FileManager,
}
/// The chosen start folder while it is an existing folder; `None` means the home folder
/// (also when the folder is gone or the settings cannot be read).
pub fn start_folder(app: &tauri::AppHandle, which: Start) -> Option<PathBuf> {
    let preferences = {
        let _guard = LOCK.lock().ok()?;
        load(&path(app).ok()?).ok()?
    };
    let folder = match which {
        Start::Terminal => preferences.terminal_folder,
        Start::FileManager => preferences.file_manager_folder,
    }?;
    Some(PathBuf::from(folder)).filter(|p| p.is_absolute() && p.is_dir())
}
/// The notes folder: `None` until one is chosen, an error when the chosen folder is gone.
pub fn notes_folder(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let preferences = {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        load(&path(app)?)?
    };
    let Some(folder) = preferences.notes_folder else {
        return Ok(None);
    };
    let folder = PathBuf::from(folder);
    if !folder.is_dir() {
        return Err(format!(
            "The notes folder is missing or not a folder: {}. Choose another in Workspace Settings.",
            folder.display()
        ));
    }
    Ok(Some(folder))
}
fn is_script(path: &Path) -> bool {
    path.extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("ps1"))
}
/// The largest prompt script: it is passed on the command line, which Windows limits to
/// 32,767 characters (8 KiB of UTF-8 is at most 16 KiB of UTF-16, 22 Ki in Base64).
pub const PROMPT_LIMIT: u64 = 8 * 1024;
/// The text of the chosen PowerShell prompt script, read again for every new terminal;
/// `None` when none is chosen, an error when it cannot be used (the shell still starts).
pub fn powershell_prompt(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let preferences = {
        let _guard = LOCK.lock().map_err(|e| e.to_string())?;
        load(&path(app)?)?
    };
    preferences
        .powershell_prompt
        .map(|file| read_prompt(Path::new(&file)))
        .transpose()
}
fn read_prompt(file: &Path) -> Result<String, String> {
    let shown = file.display();
    let size = fs::metadata(file)
        .ok()
        .filter(|m| m.is_file())
        .ok_or_else(|| format!("The PowerShell prompt {shown} is missing"))?
        .len();
    if size > PROMPT_LIMIT {
        return Err(format!(
            "The PowerShell prompt {shown} is larger than {} KiB",
            PROMPT_LIMIT / 1024
        ));
    }
    let bytes = fs::read(file).map_err(|e| format!("Could not read {shown}: {e}"))?;
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    String::from_utf8(bytes.to_vec())
        .map_err(|_| format!("The PowerShell prompt {shown} is not UTF-8 text"))
}
/// A .ps1 file picked in the native dialog for the PowerShell prompt setting.
#[tauri::command]
pub async fn choose_prompt_file() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("Choose PowerShell prompt")
        .add_filter("PowerShell script", &["ps1"])
        .pick_file()
        .await
        .map(|file| file.path().to_string_lossy().into_owned())
}
/// A folder picked in the native dialog for a start folder setting; the draft keeps it
/// until the settings are saved.
#[tauri::command]
pub async fn choose_start_folder() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("Choose start folder")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
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
        // Files from before TODO tags get the default ones.
        assert_eq!(
            load(&file).unwrap().todo_tags.len(),
            DEFAULT_TODO_TAGS.len()
        );
        assert!(load(&file).unwrap().word_wrap);
        preferences.keybindings.clear();
        preferences.todo_tags = vec!["TODO".into(), "[ ]".into()];
        assert!(preferences.validate().is_err());
        preferences.todo_tags = vec!["TODO".into(), "REVIEW:".into()];
        assert!(preferences.validate().is_ok());
        assert_eq!(load(&file).unwrap().terminal_folder, None);
        preferences.terminal_folder = Some("relative/folder".into());
        assert!(preferences.validate().is_err());
        preferences.terminal_folder = Some(dir.path().to_string_lossy().into_owned());
        preferences.file_manager_folder = Some(dir.path().to_string_lossy().into_owned());
        assert!(preferences.validate().is_ok());
        assert_eq!(load(&file).unwrap().fonts, Fonts::default());
        preferences.fonts.terminal = Some("JetBrainsMono Nerd Font".into());
        assert!(preferences.validate().is_ok());
        preferences.fonts.ui = Some("x\"; color: red".into());
        assert!(preferences.validate().is_err());
        assert_eq!(load(&file).unwrap().powershell_prompt, None);
        let script = dir.path().join("prompt.ps1");
        preferences.fonts.ui = None;
        preferences.powershell_prompt = Some("prompt.ps1".into());
        assert!(preferences.validate().is_err());
        preferences.powershell_prompt =
            Some(dir.path().join("prompt.txt").to_string_lossy().into());
        assert!(preferences.validate().is_err());
        preferences.powershell_prompt = Some(script.to_string_lossy().into_owned());
        assert!(preferences.validate().is_ok());
        assert!(read_prompt(&script).is_err());
        fs::write(&script, "\u{feff}function prompt { '> ' }").unwrap();
        assert_eq!(read_prompt(&script).unwrap(), "function prompt { '> ' }");
        fs::write(&script, b"\xff\xfe").unwrap();
        assert!(read_prompt(&script).is_err());
        fs::write(&script, vec![b'#'; PROMPT_LIMIT as usize + 1]).unwrap();
        assert!(read_prompt(&script).is_err());
        // Files from before themes keep the dark theme and the default IDE text size.
        assert_eq!(load(&file).unwrap().theme, DEFAULT_THEME);
        assert_eq!(load(&file).unwrap().ide_font_size, 13);
        preferences.theme = "paper".into();
        preferences.ide_font_size = 20;
        assert!(preferences.validate().is_ok());
        preferences.theme = "x; color: red".into();
        assert!(preferences.validate().is_err());
        preferences.theme = "paper".into();
        preferences.ide_font_size = 64;
        assert!(preferences.validate().is_err());
        fs::write(&file, b"{broken").unwrap();
        assert!(load(&file).is_err());
    }
}
