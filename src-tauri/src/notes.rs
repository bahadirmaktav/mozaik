//! Notes: independent long Markdown pages in one versioned JSON document in the app data
//! directory. Like Tasks, Rust owns every read and write: each change runs under an
//! in-process gate and a cross-process lock, re-reads the file, validates, and is reported
//! as done only after an atomic save. A damaged or newer file is never replaced.
use crate::directory::{blocking, display};
use crate::files::atomic_write;
use crate::panels::PanelOwner;
use crate::tasks::now;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Manager, State, WebviewWindow};

pub const SCHEMA_VERSION: u32 = 1;
/// The first note of a fresh store. A fixed ID keeps the seed idempotent: until the file
/// exists every read yields the same note, and once it exists nothing is seeded again.
const QUICK_NOTES: &str = "quick-notes";
const MAX_TITLE: usize = 120;
const MAX_CONTENT: usize = 5_000_000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content_markdown: String,
    pub order_key: u64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub selected_note_id: Option<String>,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub schema_version: u32,
    /// Increases with every saved change; lets views ignore older snapshots.
    pub revision: u64,
    pub notes: Vec<Note>,
    #[serde(default)]
    pub preferences: Preferences,
}
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    title: Option<String>,
    content_markdown: Option<String>,
}

impl Document {
    fn seeded() -> Self {
        let now = now();
        Self {
            schema_version: SCHEMA_VERSION,
            revision: 0,
            notes: vec![Note {
                id: QUICK_NOTES.into(),
                title: "QuickNotes".into(),
                content_markdown: String::new(),
                order_key: 0,
                created_at: now.clone(),
                updated_at: now,
            }],
            preferences: Preferences {
                selected_note_id: Some(QUICK_NOTES.into()),
            },
        }
    }
    /// Restores the invariants after loading; data that cannot be interpreted is rejected.
    fn repair(mut self) -> Result<Self, String> {
        let mut ids = HashSet::new();
        if !self.notes.iter().all(|n| ids.insert(n.id.clone())) {
            return Err("duplicate note".into());
        }
        let order = self.ordered();
        self.renumber(&order);
        if self
            .preferences
            .selected_note_id
            .as_ref()
            .is_none_or(|selected| !ids.contains(selected))
        {
            self.preferences.selected_note_id = order.first().cloned();
        }
        Ok(self)
    }
    fn note(&mut self, id: &str) -> Result<&mut Note, String> {
        self.notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| "That note no longer exists".into())
    }
    /// Note IDs in display order.
    fn ordered(&self) -> Vec<String> {
        let mut notes: Vec<_> = self.notes.iter().collect();
        notes.sort_by(|a, b| a.order_key.cmp(&b.order_key).then(a.id.cmp(&b.id)));
        notes.into_iter().map(|n| n.id.clone()).collect()
    }
    fn renumber(&mut self, ids: &[String]) {
        for (index, id) in ids.iter().enumerate() {
            if let Some(note) = self.notes.iter_mut().find(|n| &n.id == id) {
                note.order_key = index as u64;
            }
        }
    }

    pub fn create(&mut self, title: &str) -> Result<String, String> {
        let title = check_title(title)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now();
        self.notes.push(Note {
            id: id.clone(),
            title,
            content_markdown: String::new(),
            order_key: self
                .notes
                .iter()
                .map(|n| n.order_key + 1)
                .max()
                .unwrap_or(0),
            created_at: now.clone(),
            updated_at: now,
        });
        self.preferences.selected_note_id = Some(id.clone());
        Ok(id)
    }
    pub fn update(&mut self, id: &str, patch: NotePatch) -> Result<(), String> {
        let title = patch.title.as_deref().map(check_title).transpose()?;
        if let Some(text) = &patch.content_markdown
            && text.chars().count() > MAX_CONTENT
        {
            return Err(format!("A note can have at most {MAX_CONTENT} characters"));
        }
        let note = self.note(id)?;
        if let Some(title) = title {
            note.title = title;
        }
        if let Some(text) = patch.content_markdown {
            note.content_markdown = text;
        }
        note.updated_at = now();
        Ok(())
    }
    /// Places a note directly before `before`, or after `after`, or at the end. The anchors
    /// come from the list the user dragged in.
    pub fn move_note(
        &mut self,
        id: &str,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<(), String> {
        self.note(id)?;
        let mut order = self.ordered();
        order.retain(|n| n != id);
        let anchor = |anchor: &str| {
            order
                .iter()
                .position(|n| n == anchor)
                .ok_or_else(|| "Notes changed meanwhile; try again".to_string())
        };
        let index = match (before, after) {
            (Some(before), _) if before != id => anchor(before)?,
            (_, Some(after)) if after != id => anchor(after)? + 1,
            _ => order.len(),
        };
        order.insert(index, id.into());
        self.renumber(&order);
        Ok(())
    }
    /// Removes a note; the next one (or the previous, at the end) becomes selected.
    pub fn delete(&mut self, id: &str) -> Result<(), String> {
        self.note(id)?;
        let order = self.ordered();
        let index = order.iter().position(|n| n == id).unwrap_or(0);
        self.notes.retain(|n| n.id != id);
        if self.preferences.selected_note_id.as_deref() == Some(id) {
            let rest: Vec<_> = order.into_iter().filter(|n| n != id).collect();
            self.preferences.selected_note_id =
                rest.get(index.min(rest.len().saturating_sub(1))).cloned();
        }
        Ok(())
    }
    pub fn select(&mut self, id: &str) -> Result<(), String> {
        self.note(id)?;
        self.preferences.selected_note_id = Some(id.into());
        Ok(())
    }
}
fn check_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("A note needs a title".into());
    }
    if title.chars().count() > MAX_TITLE {
        return Err(format!("Titles can have at most {MAX_TITLE} characters"));
    }
    if title.chars().any(char::is_control) {
        return Err("Titles cannot contain control characters".into());
    }
    Ok(title.into())
}

#[derive(Clone)]
pub struct Notes {
    file: PathBuf,
    gate: Arc<Mutex<()>>,
}
impl Notes {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            file: directory.join("notes.json"),
            gate: Arc::new(Mutex::new(())),
        }
    }
    /// A missing file is the first run and yields the seed; anything unreadable is reported
    /// and never replaced.
    fn load(&self) -> Result<Document, String> {
        let data = match fs::read(&self.file) {
            Ok(data) => data,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Document::seeded()),
            Err(e) => return Err(format!("Notes could not be read: {e}")),
        };
        let damaged = |reason: String| {
            format!(
                "The notes file is damaged ({reason}) and was left unchanged: {}",
                display(&self.file)
            )
        };
        let value: serde_json::Value =
            serde_json::from_slice(&data).map_err(|e| damaged(e.to_string()))?;
        match value.get("schemaVersion").and_then(|v| v.as_u64()) {
            Some(1) => {}
            Some(version) if version > u64::from(SCHEMA_VERSION) => {
                return Err(format!(
                    "The notes file was saved by a newer Tessera (schema {version}) and was left unchanged: {}",
                    display(&self.file)
                ));
            }
            _ => return Err(damaged("unknown schema version".into())),
        }
        serde_json::from_value::<Document>(value)
            .map_err(|e| damaged(e.to_string()))?
            .repair()
            .map_err(damaged)
    }
    pub fn snapshot(&self) -> Result<Document, String> {
        let _guard = self.gate.lock().map_err(|e| e.to_string())?;
        self.load()
    }
    /// Read-modify-write; the change is only returned after the file was replaced atomically.
    pub fn update<T>(
        &self,
        change: impl FnOnce(&mut Document) -> Result<T, String>,
    ) -> Result<(Document, T), String> {
        let _guard = self.gate.lock().map_err(|e| e.to_string())?;
        let directory = self.file.parent().ok_or("Invalid data directory")?;
        fs::create_dir_all(directory).map_err(|e| format!("Notes were not saved: {e}"))?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("notes.lock"))
            .map_err(|e| format!("Notes were not saved: {e}"))?;
        fs2::FileExt::lock_exclusive(&lock).map_err(|e| e.to_string())?;
        let mut document = self.load()?;
        let result = change(&mut document)?;
        document.revision += 1;
        if fs::metadata(&self.file).is_ok_and(|m| m.permissions().readonly()) {
            return Err(format!(
                "Notes were not saved: the notes file is read-only: {}",
                display(&self.file)
            ));
        }
        let bytes = serde_json::to_vec_pretty(&document).map_err(|e| e.to_string())?;
        atomic_write(&self.file, &bytes).map_err(|e| format!("Notes were not saved: {e}"))?;
        Ok((document, result))
    }
}
pub fn storage(app: &tauri::AppHandle) -> Result<Notes, String> {
    Ok(Notes::new(
        app.path().app_data_dir().map_err(|e| e.to_string())?,
    ))
}

async fn change<T: Send + 'static>(
    app: tauri::AppHandle,
    notes: &State<'_, Notes>,
    work: impl FnOnce(&mut Document) -> Result<T, String> + Send + 'static,
) -> Result<Document, String> {
    let notes = notes.inner().clone();
    blocking(move || {
        let (document, _) = notes.update(work)?;
        let _ = app.emit("notes-changed", &document);
        Ok(document)
    })
    .await
}
#[tauri::command]
pub async fn notes_snapshot(notes: State<'_, Notes>) -> Result<Document, String> {
    let notes = notes.inner().clone();
    blocking(move || notes.snapshot()).await
}
#[tauri::command]
pub async fn notes_create(
    app: tauri::AppHandle,
    notes: State<'_, Notes>,
    title: String,
) -> Result<Document, String> {
    change(app, &notes, move |d| d.create(&title).map(|_| ())).await
}
#[tauri::command]
pub async fn notes_update(
    app: tauri::AppHandle,
    notes: State<'_, Notes>,
    id: String,
    patch: NotePatch,
) -> Result<Document, String> {
    change(app, &notes, move |d| d.update(&id, patch)).await
}
#[tauri::command]
pub async fn notes_move(
    app: tauri::AppHandle,
    notes: State<'_, Notes>,
    id: String,
    before: Option<String>,
    after: Option<String>,
) -> Result<Document, String> {
    change(app, &notes, move |d| {
        d.move_note(&id, before.as_deref(), after.as_deref())
    })
    .await
}
#[tauri::command]
pub async fn notes_delete(
    app: tauri::AppHandle,
    notes: State<'_, Notes>,
    id: String,
) -> Result<Document, String> {
    change(app, &notes, move |d| d.delete(&id)).await
}
#[tauri::command]
pub async fn notes_select(
    app: tauri::AppHandle,
    notes: State<'_, Notes>,
    id: String,
) -> Result<Document, String> {
    change(app, &notes, move |d| d.select(&id)).await
}
/// Claims the Notes panel for this window; see [`PanelOwner::claim`].
#[tauri::command]
pub fn notes_claim_panel(
    window: WebviewWindow,
    owner: State<'_, PanelOwner>,
) -> Result<bool, String> {
    owner.claim(&window, "notes")
}
#[tauri::command]
pub fn notes_release_panel(window: WebviewWindow, owner: State<'_, PanelOwner>) {
    owner.release(window.label(), "notes");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Notes) {
        let directory = tempfile::tempdir().unwrap();
        let notes = Notes::new(directory.path().to_path_buf());
        (directory, notes)
    }
    fn titles(document: &Document) -> Vec<String> {
        document
            .ordered()
            .iter()
            .map(|id| {
                document
                    .notes
                    .iter()
                    .find(|n| &n.id == id)
                    .unwrap()
                    .title
                    .clone()
            })
            .collect()
    }

    #[test]
    fn quick_notes_is_seeded_once() {
        let (dir, notes) = store();
        let first = notes.snapshot().unwrap();
        assert_eq!(titles(&first), ["QuickNotes"]);
        assert_eq!(first.notes[0].content_markdown, "");
        // Reading again without a file yields the same note, so edits reach it.
        assert_eq!(notes.snapshot().unwrap().notes[0].id, QUICK_NOTES);
        notes
            .update(|d| {
                d.update(
                    QUICK_NOTES,
                    NotePatch {
                        content_markdown: Some("# hi".into()),
                        ..Default::default()
                    },
                )
            })
            .unwrap();
        notes.update(|d| d.create("GitNotes").map(|_| ())).unwrap();
        let reopened = Notes::new(dir.path().to_path_buf());
        let document = reopened.snapshot().unwrap();
        assert_eq!(titles(&document), ["QuickNotes", "GitNotes"]);
        assert_eq!(document.notes[0].content_markdown, "# hi");
        // Deleting QuickNotes never brings a new copy back.
        reopened.update(|d| d.delete(QUICK_NOTES)).unwrap();
        assert_eq!(titles(&reopened.snapshot().unwrap()), ["GitNotes"]);
        reopened
            .update(|d| {
                let id = d.ordered()[0].clone();
                d.delete(&id)
            })
            .unwrap();
        assert!(reopened.snapshot().unwrap().notes.is_empty());
    }
    #[test]
    fn titles_are_validated_and_order_is_kept() {
        let (_dir, notes) = store();
        for title in ["", "   ", &"x".repeat(121), "a\u{7}b"] {
            assert!(notes.update(|d| d.create(title)).is_err(), "{title:?}");
        }
        for title in ["GitNotes", "LinuxNotes"] {
            notes.update(|d| d.create(title).map(|_| ())).unwrap();
        }
        let document = notes.snapshot().unwrap();
        let linux = document.ordered()[2].clone();
        let (document, _) = notes
            .update(|d| d.move_note(&linux, Some(QUICK_NOTES), None))
            .unwrap();
        assert_eq!(titles(&document), ["LinuxNotes", "QuickNotes", "GitNotes"]);
        let (document, _) = notes.update(|d| d.move_note(&linux, None, None)).unwrap();
        assert_eq!(titles(&document), ["QuickNotes", "GitNotes", "LinuxNotes"]);
        assert!(
            notes
                .update(|d| d.move_note(&linux, Some("missing"), None))
                .is_err()
        );
        assert_eq!(document.preferences.selected_note_id, Some(linux.clone()));
        let (document, _) = notes.update(|d| d.delete(&linux)).unwrap();
        assert_eq!(
            document.preferences.selected_note_id.as_deref(),
            Some(document.ordered()[1].as_str())
        );
    }
    #[test]
    fn damaged_or_newer_files_are_never_replaced() {
        let (dir, notes) = store();
        let file = dir.path().join("notes.json");
        fs::write(&file, "{ not json").unwrap();
        assert!(notes.snapshot().unwrap_err().contains("damaged"));
        assert!(notes.update(|d| d.create("x")).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "{ not json");
        let newer = r#"{"schemaVersion":2,"revision":1,"notes":[]}"#;
        fs::write(&file, newer).unwrap();
        assert!(notes.snapshot().unwrap_err().contains("newer"));
        assert!(notes.update(|d| d.create("x")).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), newer);
    }
}
