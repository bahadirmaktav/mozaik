//! Drawing files: Excalidraw drawings and Mermaid diagrams. Validated reads, guarded saves,
//! image exports and, per kind, the list of files that were open, which the next session
//! reopens when that module is first opened.
use crate::directory::{blocking, display};
use crate::files::{self, FileData, SaveRequest, atomic_write};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager, State, WebviewWindow};

const EXPORTS: [&str; 3] = ["png", "svg", "excalidrawlib"];
const IMAGES: [&str; 10] = [
    "png", "jpg", "jpeg", "jfif", "gif", "webp", "svg", "bmp", "ico", "avif",
];
const MAX_OPEN: usize = 256;
const MAX_EXPORT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Excalidraw,
    Mermaid,
}
impl Kind {
    /// Accepted extensions; the first is used for new files.
    fn extensions(self) -> &'static [&'static str] {
        match self {
            Kind::Excalidraw => &["excalidraw"],
            Kind::Mermaid => &["mmd", "mermaid"],
        }
    }
    fn extension(self) -> &'static str {
        self.extensions()[0]
    }
    fn matches(self, path: &Path) -> bool {
        self.extensions().iter().any(|e| has_extension(path, e))
    }
    fn filter(self) -> &'static str {
        match self {
            Kind::Excalidraw => "Excalidraw drawing",
            Kind::Mermaid => "Mermaid diagram",
        }
    }
    fn noun(self) -> &'static str {
        match self {
            Kind::Excalidraw => "drawing",
            Kind::Mermaid => "diagram",
        }
    }
    /// Mermaid sources are plain text; syntax errors are shown, never a reason to refuse.
    fn validate(self, text: &str) -> Result<(), String> {
        match self {
            Kind::Excalidraw => validate(text),
            Kind::Mermaid => Ok(()),
        }
    }
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(extension))
}
/// A dialog may return a name without the filter's extension; never let that skip the
/// dialog's own replace confirmation.
fn with_extension(path: PathBuf, extension: &str) -> Result<PathBuf, String> {
    if has_extension(&path, extension) {
        return Ok(path);
    }
    let mut name = path.file_name().ok_or("File has no name")?.to_os_string();
    name.push(format!(".{extension}"));
    let path = path.with_file_name(name);
    if path.exists() {
        return Err(format!(
            "{} already exists. Choose another name.",
            display(&path)
        ));
    }
    Ok(path)
}
fn validate(text: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("This drawing is damaged and was not opened: {e}"))?;
    if value.get("type").and_then(|t| t.as_str()) != Some("excalidraw")
        || !value.get("elements").is_some_and(|e| e.is_array())
    {
        return Err("This is not an Excalidraw drawing; it was not opened.".into());
    }
    Ok(())
}
pub fn read(path: &Path, kind: Kind) -> Result<FileData, String> {
    if !kind.matches(path) {
        return Err(format!(
            "Only .{} files open as {}s",
            kind.extensions().join(" and ."),
            kind.noun()
        ));
    }
    let file = files::read(path)?;
    kind.validate(&file.text)?;
    Ok(file)
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    schema_version: u32,
    open: Vec<String>,
}
#[derive(Default)]
struct Registry {
    /// Drawings of the previous session that no window has reopened yet.
    pending: Vec<String>,
    /// File-bound drawings per window label, in tab order.
    windows: HashMap<String, Vec<String>>,
}
impl Registry {
    fn owner(&self, path: &str) -> Option<&str> {
        self.windows
            .iter()
            .find(|(_, paths)| paths.iter().any(|p| p == path))
            .map(|(label, _)| label.as_str())
    }
    fn all(&self) -> Vec<String> {
        let mut all: Vec<String> = Vec::new();
        for path in self.pending.iter().chain(self.windows.values().flatten()) {
            if !all.contains(path) {
                all.push(path.clone());
            }
        }
        all
    }
}
/// The open files of one kind and their session list on disk.
struct OpenFiles {
    kind: Kind,
    file: PathBuf,
    registry: Mutex<Registry>,
}
impl OpenFiles {
    fn new(kind: Kind, file: PathBuf) -> Self {
        // Only a list of paths: a damaged or newer file starts an empty list.
        let session = fs::read(&file)
            .ok()
            .and_then(|data| serde_json::from_slice::<Session>(&data).ok())
            .filter(|s| s.schema_version == 1)
            .unwrap_or_default();
        let mut pending: Vec<String> = Vec::new();
        for path in session.open {
            if valid_path(&path, kind) && !pending.contains(&path) {
                pending.push(path);
            }
        }
        pending.truncate(MAX_OPEN);
        Self {
            kind,
            file,
            registry: Mutex::new(Registry {
                pending,
                windows: HashMap::new(),
            }),
        }
    }
    fn persist(&self, registry: &Registry) -> Result<(), String> {
        let session = Session {
            schema_version: 1,
            open: registry.all(),
        };
        if let Some(parent) = self.file.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        atomic_write(
            &self.file,
            &serde_json::to_vec_pretty(&session).map_err(|e| e.to_string())?,
        )
    }
    fn change<T>(&self, work: impl FnOnce(&mut Registry) -> T) -> Result<T, String> {
        let mut registry = self.registry.lock().map_err(|e| e.to_string())?;
        let result = work(&mut registry);
        self.persist(&registry)
            .map_err(|e| format!("The list of open {}s was not saved: {e}", self.kind.noun()))?;
        Ok(result)
    }
}
pub struct Drawings {
    excalidraw: OpenFiles,
    mermaid: OpenFiles,
}
impl Drawings {
    fn new(directory: &Path) -> Self {
        Self {
            excalidraw: OpenFiles::new(Kind::Excalidraw, directory.join("drawings.json")),
            mermaid: OpenFiles::new(Kind::Mermaid, directory.join("diagrams.json")),
        }
    }
    fn of(&self, kind: Kind) -> &OpenFiles {
        match kind {
            Kind::Excalidraw => &self.excalidraw,
            Kind::Mermaid => &self.mermaid,
        }
    }
}
fn valid_path(path: &str, kind: Kind) -> bool {
    path.len() <= 4096 && Path::new(path).is_absolute() && kind.matches(Path::new(path))
}
pub fn storage(app: &tauri::AppHandle) -> Result<Drawings, String> {
    Ok(Drawings::new(
        &app.path().app_data_dir().map_err(|e| e.to_string())?,
    ))
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OpenOutcome {
    Opened {
        file: FileData,
    },
    /// Already open in another window, which was focused instead.
    Elsewhere,
}
#[tauri::command]
pub async fn drawings_open(
    window: WebviewWindow,
    drawings: State<'_, Drawings>,
    kind: Kind,
    path: Option<String>,
) -> Result<Option<OpenOutcome>, String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => match rfd::AsyncFileDialog::new()
            .set_title(format!("Open {}", kind.noun()))
            .add_filter(kind.filter(), kind.extensions())
            .pick_file()
            .await
        {
            Some(file) => file.path().to_path_buf(),
            None => return Ok(None),
        },
    };
    let file = blocking(move || read(&path, kind)).await?;
    let label = window.label().to_owned();
    let elsewhere = drawings.of(kind).change(|registry| {
        if let Some(owner) = registry.owner(&file.path)
            && owner != label
        {
            return Some(owner.to_owned());
        }
        let paths = registry.windows.entry(label.clone()).or_default();
        if !paths.contains(&file.path) {
            paths.push(file.path.clone());
        }
        None
    })?;
    if let Some(owner) = elsewhere
        && let Some(other) = window.app_handle().get_webview_window(&owner)
    {
        let _ = other.unminimize();
        let _ = other.set_focus();
        let _ = other.emit_to(&owner, "focus-drawing", &file.path);
        return Ok(Some(OpenOutcome::Elsewhere));
    }
    Ok(Some(OpenOutcome::Opened { file }))
}
/// Replaces this window's list of file-bound drawings or diagrams.
#[tauri::command]
pub fn drawings_set_open(
    window: WebviewWindow,
    drawings: State<'_, Drawings>,
    kind: Kind,
    paths: Vec<String>,
) -> Result<(), String> {
    if paths.len() > MAX_OPEN || !paths.iter().all(|p| valid_path(p, kind)) {
        return Err(format!("Invalid list of open {}s", kind.noun()));
    }
    let label = window.label().to_owned();
    drawings.of(kind).change(|registry| {
        registry.windows.insert(label, paths);
    })
}
/// The previous session's files of a kind, handed out once per process.
#[tauri::command]
pub fn drawings_take_pending(
    drawings: State<'_, Drawings>,
    kind: Kind,
) -> Result<Vec<String>, String> {
    let mut registry = drawings
        .of(kind)
        .registry
        .lock()
        .map_err(|e| e.to_string())?;
    // Kept on disk until the reopened files are registered by their window.
    Ok(std::mem::take(&mut registry.pending))
}
/// A window closing while others stay open forgets its files; the last window keeps
/// them for the next session.
#[tauri::command]
pub fn drawings_close_window(
    window: WebviewWindow,
    drawings: State<'_, Drawings>,
) -> Result<(), String> {
    let others = window
        .app_handle()
        .webview_windows()
        .keys()
        .any(|label| label != window.label());
    if !others {
        return Ok(());
    }
    let label = window.label().to_owned();
    for open in [&drawings.excalidraw, &drawings.mermaid] {
        open.change(|registry| {
            registry.windows.remove(&label);
        })?;
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingSave {
    kind: Kind,
    /// `None` asks for a destination (Save As).
    path: Option<String>,
    /// The file's current path, released when Save As moves it.
    current: Option<String>,
    text: String,
    revision: Option<String>,
    bom: bool,
    ending: String,
    name: String,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved { file: FileData },
    Cancelled,
    Conflict { message: String },
}
#[tauri::command]
pub async fn drawings_save(
    window: WebviewWindow,
    drawings: State<'_, Drawings>,
    request: DrawingSave,
) -> Result<SaveOutcome, String> {
    let kind = request.kind;
    let open = drawings.of(kind);
    kind.validate(&request.text)
        .map_err(|_| "The drawing could not be serialized".to_string())?;
    let label = window.label().to_owned();
    let (path, expected) = match &request.path {
        Some(path) => {
            // Without a dialog, only a file this window opened or saved may be written.
            let owned = open.registry.lock().map_err(|e| e.to_string())?.owner(path)
                == Some(label.as_str());
            if !owned || !valid_path(path, kind) {
                return Err(format!("This {} is not open in this window", kind.noun()));
            }
            (PathBuf::from(path), request.revision.clone())
        }
        None => {
            let name = if kind.matches(Path::new(&request.name)) {
                request.name.clone()
            } else {
                format!("{}.{}", request.name, kind.extension())
            };
            let Some(selected) = rfd::AsyncFileDialog::new()
                .set_title(format!("Save {}", kind.noun()))
                .set_file_name(&name)
                .add_filter(kind.filter(), kind.extensions())
                .save_file()
                .await
            else {
                return Ok(SaveOutcome::Cancelled);
            };
            let selected = selected.path().to_path_buf();
            let path = files::chosen(&if kind.matches(&selected) {
                selected
            } else {
                with_extension(selected, kind.extension())?
            })?;
            let target = display(&path);
            let taken = open
                .registry
                .lock()
                .map_err(|e| e.to_string())?
                .owner(&target)
                .is_some();
            if taken && request.current.as_deref() != Some(target.as_str()) {
                return Err(format!(
                    "That {} is already open in another tab or window. Choose a different name or close it first.",
                    kind.noun()
                ));
            }
            // The dialog confirmed replacement; bind that decision to this disk version.
            let expected = if path.exists() {
                Some(files::digest(&files::bytes(&path)?))
            } else {
                None
            };
            (path, expected)
        }
    };
    let save = SaveRequest {
        path: None,
        text: request.text,
        revision: None,
        bom: request.bom,
        ending: request.ending,
        name: request.name,
        excluded_paths: vec![],
    };
    let file = match blocking(move || files::save(&path, &save, expected.as_deref())).await {
        Ok(file) => file,
        Err(message) if message == files::CHANGED_ON_DISK => {
            return Ok(SaveOutcome::Conflict { message });
        }
        Err(message) => return Err(message),
    };
    let saved = file.path.clone();
    open.change(|registry| {
        let paths = registry.windows.entry(label).or_default();
        match request
            .current
            .and_then(|c| paths.iter().position(|p| *p == c))
        {
            Some(index) => paths[index] = saved,
            None if !paths.contains(&saved) => paths.push(saved),
            None => (),
        }
        paths.dedup();
    })?;
    Ok(SaveOutcome::Saved { file })
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = value
                .get(index + 1..index + 3)
                .and_then(|h| u8::from_str_radix(h, 16).ok())
                .ok_or("Invalid export name")?;
            output.push(hex);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).map_err(|_| "Invalid export name".into())
}
/// Writes an exported image or library chosen in a save dialog. The body is the raw file;
/// the name and extension arrive as headers. Never writes a `.excalidraw` drawing.
#[tauri::command]
pub async fn drawings_export(request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let header = |name: &str| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| format!("Missing {name}"))
    };
    let extension = header("x-mozaik-extension")?.to_owned();
    if !EXPORTS.contains(&extension.as_str()) {
        return Err("Unsupported export format".into());
    }
    let name = percent_decode(header("x-mozaik-name")?)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Export data is missing".into());
    };
    if bytes.len() > MAX_EXPORT_BYTES {
        return Err("Export exceeds the 64 MiB safety limit".into());
    }
    let bytes = bytes.clone();
    let Some(selected) = rfd::AsyncFileDialog::new()
        .set_title("Export")
        .set_file_name(&name)
        .add_filter(extension.to_uppercase(), &[extension.as_str()])
        .save_file()
        .await
    else {
        return Ok(None);
    };
    let path = files::chosen(&with_extension(selected.path().to_path_buf(), &extension)?)?;
    blocking(move || {
        atomic_write(&path, &bytes)?;
        Ok(Some(display(&path)))
    })
    .await
}
/// An image dropped from the OS onto a drawing.
#[tauri::command]
pub async fn drawings_read_image(path: String) -> Result<tauri::ipc::Response, String> {
    blocking(move || {
        let path = Path::new(&path);
        if !IMAGES.iter().any(|e| has_extension(path, e)) {
            return Err("Only image files can be dropped into a drawing".into());
        }
        Ok(tauri::ipc::Response::new(files::bytes(path)?))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMPTY: &str =
        r#"{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}"#;

    #[test]
    fn reads_only_valid_excalidraw_files() {
        let dir = tempfile::tempdir().unwrap();
        let good = dir.path().join("plan.excalidraw");
        fs::write(&good, EMPTY).unwrap();
        assert!(read(&good, Kind::Excalidraw).is_ok());
        let text = dir.path().join("plan.json");
        fs::write(&text, EMPTY).unwrap();
        assert!(read(&text, Kind::Excalidraw).is_err());
        let damaged = dir.path().join("damaged.excalidraw");
        fs::write(&damaged, "{\"type\":\"excalidraw\",").unwrap();
        assert!(
            read(&damaged, Kind::Excalidraw)
                .unwrap_err()
                .contains("damaged")
        );
        let other = dir.path().join("other.excalidraw");
        fs::write(&other, r#"{"type":"excalidrawlib","libraryItems":[]}"#).unwrap();
        assert!(read(&other, Kind::Excalidraw).is_err());
        assert_eq!(
            fs::read_to_string(&damaged).unwrap(),
            "{\"type\":\"excalidraw\","
        );
    }
    #[test]
    fn appends_the_extension_without_bypassing_replace_confirmation() {
        let dir = tempfile::tempdir().unwrap();
        let bare = dir.path().join("plan");
        assert_eq!(
            with_extension(bare.clone(), "excalidraw").unwrap(),
            dir.path().join("plan.excalidraw")
        );
        fs::write(dir.path().join("plan.excalidraw"), EMPTY).unwrap();
        assert!(with_extension(bare, "excalidraw").is_err());
        let named = dir.path().join("Plan.EXCALIDRAW");
        assert_eq!(with_extension(named.clone(), "excalidraw").unwrap(), named);
    }
    #[test]
    fn session_keeps_pending_until_registered_and_ignores_damage() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("drawings.json");
        let path = display(&dir.path().join("a.excalidraw"));
        let drawings = OpenFiles::new(Kind::Excalidraw, file.clone());
        drawings
            .change(|r| {
                r.windows.insert("main".into(), vec![path.clone()]);
            })
            .unwrap();
        let next = OpenFiles::new(Kind::Excalidraw, file.clone());
        let pending = std::mem::take(&mut next.registry.lock().unwrap().pending);
        assert_eq!(pending, vec![path.clone()]);
        // Taking the list does not rewrite the file; a crash before reopening keeps it.
        assert_eq!(
            OpenFiles::new(Kind::Excalidraw, file.clone())
                .registry
                .lock()
                .unwrap()
                .pending,
            vec![path]
        );
        fs::write(&file, "not json").unwrap();
        assert!(
            OpenFiles::new(Kind::Excalidraw, file)
                .registry
                .lock()
                .unwrap()
                .pending
                .is_empty()
        );
    }
    #[test]
    fn rejects_relative_or_foreign_paths_and_bad_names() {
        assert!(!valid_path("relative.excalidraw", Kind::Excalidraw));
        assert!(!valid_path(
            &display(&std::env::temp_dir().join("a.txt")),
            Kind::Excalidraw
        ));
        assert!(valid_path(
            &display(&std::env::temp_dir().join("a.excalidraw")),
            Kind::Excalidraw
        ));
        assert!(!valid_path(
            &display(&std::env::temp_dir().join("a.excalidraw")),
            Kind::Mermaid
        ));
        assert_eq!(percent_decode("Pl%C3%A2n%20A").unwrap(), "Plân A");
        assert!(percent_decode("%zz").is_err());
    }
    #[test]
    fn mermaid_diagrams_are_text_files_with_their_own_session_list() {
        let dir = tempfile::tempdir().unwrap();
        let diagram = dir.path().join("flow.mmd");
        // A syntax error is the editor's concern; the file still opens as text.
        fs::write(&diagram, "flowchart LR\r\n  A --> \r\n").unwrap();
        let file = read(&diagram, Kind::Mermaid).unwrap();
        assert_eq!(file.ending, "crlf");
        assert!(read(&diagram, Kind::Excalidraw).is_err());
        let long = dir.path().join("flow.mermaid");
        fs::write(&long, "graph TD\n").unwrap();
        assert!(read(&long, Kind::Mermaid).is_ok());
        let binary = dir.path().join("bad.mmd");
        fs::write(&binary, [0u8, 159, 146, 150]).unwrap();
        assert!(read(&binary, Kind::Mermaid).is_err());

        let drawings = Drawings::new(dir.path());
        let path = display(&diagram);
        drawings
            .mermaid
            .change(|r| {
                r.windows.insert("main".into(), vec![path.clone()]);
            })
            .unwrap();
        let next = Drawings::new(dir.path());
        assert_eq!(next.mermaid.registry.lock().unwrap().pending, vec![path]);
        assert!(next.excalidraw.registry.lock().unwrap().pending.is_empty());
    }
}
