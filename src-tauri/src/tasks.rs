//! Personal tasks in one versioned JSON document in the app data directory. Rust owns every
//! read and write: each mutation runs under an in-process gate and a cross-process lock,
//! re-reads the file, validates, and is reported as done only after an atomic save.
use crate::directory::{blocking, display};
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, State, WebviewWindow};

pub const SCHEMA_VERSION: u32 = 1;
const INBOX: &str = "inbox";
const ALL: &str = "all";
const MAX_LIST_NAME: usize = 80;
const MAX_TITLE: usize = 500;
const MAX_DESCRIPTION: usize = 100_000;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Todo,
    InProgress,
    Done,
}
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Low,
    Medium,
    High,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct List {
    pub id: String,
    pub name: String,
    pub system: bool,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub description_markdown: String,
    pub status: Status,
    pub priority: Priority,
    /// Position among all tasks with the same status, across lists, so a merged All Lists
    /// view and each single list share one order.
    pub order_key: u64,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub selected_list_id: String,
}
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub schema_version: u32,
    /// Increases with every saved change; lets views ignore older snapshots.
    #[serde(default)]
    pub revision: u64,
    pub lists: Vec<List>,
    pub tasks: Vec<Task>,
    pub preferences: Preferences,
}
#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    title: Option<String>,
    description_markdown: Option<String>,
    status: Option<Status>,
    priority: Option<Priority>,
    list_id: Option<String>,
}

fn inbox() -> List {
    List {
        id: INBOX.into(),
        name: "Inbox".into(),
        system: true,
    }
}
impl Document {
    fn new() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            revision: 0,
            lists: vec![inbox()],
            tasks: Vec::new(),
            preferences: Preferences {
                selected_list_id: ALL.into(),
            },
        }
    }
    /// Restores the invariants after loading. Data that cannot be interpreted is rejected;
    /// a task whose list is missing is shown in the Inbox rather than dropped.
    fn repair(mut self) -> Result<Self, String> {
        let mut ids = HashSet::new();
        if !self.lists.iter().all(|l| ids.insert(l.id.clone())) {
            return Err("duplicate list".into());
        }
        let mut task_ids = HashSet::new();
        if !self.tasks.iter().all(|t| task_ids.insert(t.id.clone())) {
            return Err("duplicate task".into());
        }
        self.lists.retain(|l| l.id != INBOX);
        self.lists.iter_mut().for_each(|l| l.system = false);
        self.lists.insert(0, inbox());
        let lists: HashSet<_> = self.lists.iter().map(|l| l.id.clone()).collect();
        for task in &mut self.tasks {
            if !lists.contains(&task.list_id) {
                task.list_id = INBOX.into();
            }
        }
        if self.preferences.selected_list_id != ALL
            && !lists.contains(&self.preferences.selected_list_id)
        {
            self.preferences.selected_list_id = ALL.into();
        }
        Ok(self)
    }
    fn list(&self, id: &str) -> Result<&List, String> {
        self.lists
            .iter()
            .find(|l| l.id == id)
            .ok_or_else(|| "That list no longer exists".into())
    }
    fn task(&mut self, id: &str) -> Result<&mut Task, String> {
        self.tasks
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or_else(|| "That task no longer exists".into())
    }
    fn next_key(&self, status: Status) -> u64 {
        self.tasks
            .iter()
            .filter(|t| t.status == status)
            .map(|t| t.order_key + 1)
            .max()
            .unwrap_or(0)
    }
    /// Task IDs with `status` in display order.
    fn ordered(&self, status: Status) -> Vec<String> {
        let mut tasks: Vec<_> = self.tasks.iter().filter(|t| t.status == status).collect();
        tasks.sort_by(|a, b| a.order_key.cmp(&b.order_key).then(a.id.cmp(&b.id)));
        tasks.into_iter().map(|t| t.id.clone()).collect()
    }
    fn renumber(&mut self, ids: &[String]) {
        for (index, id) in ids.iter().enumerate() {
            if let Some(task) = self.tasks.iter_mut().find(|t| &t.id == id) {
                task.order_key = index as u64;
            }
        }
    }
    fn check_name(&self, name: &str, except: Option<&str>) -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("A list needs a name".into());
        }
        if name.chars().count() > MAX_LIST_NAME {
            return Err(format!(
                "List names can have at most {MAX_LIST_NAME} characters"
            ));
        }
        if name.chars().any(char::is_control) {
            return Err("List names cannot contain control characters".into());
        }
        let key = name.to_lowercase();
        if key == "inbox" || key == "all lists" {
            return Err(format!("“{name}” is reserved"));
        }
        if self
            .lists
            .iter()
            .any(|l| Some(l.id.as_str()) != except && l.name.to_lowercase() == key)
        {
            return Err(format!("A list named “{name}” already exists"));
        }
        Ok(name.into())
    }

    pub fn create_list(&mut self, name: &str) -> Result<(), String> {
        let name = self.check_name(name, None)?;
        self.lists.push(List {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            system: false,
        });
        Ok(())
    }
    pub fn rename_list(&mut self, id: &str, name: &str) -> Result<(), String> {
        if self.list(id)?.system {
            return Err("The Inbox cannot be renamed".into());
        }
        let name = self.check_name(name, Some(id))?;
        self.lists.iter_mut().find(|l| l.id == id).unwrap().name = name;
        Ok(())
    }
    /// Moves the list's tasks to the Inbox and removes it in one saved change.
    pub fn delete_list(&mut self, id: &str) -> Result<(), String> {
        if self.list(id)?.system {
            return Err("The Inbox cannot be deleted".into());
        }
        let now = now();
        for task in self.tasks.iter_mut().filter(|t| t.list_id == id) {
            task.list_id = INBOX.into();
            task.updated_at = now.clone();
        }
        self.lists.retain(|l| l.id != id);
        if self.preferences.selected_list_id == id {
            self.preferences.selected_list_id = INBOX.into();
        }
        Ok(())
    }
    pub fn create_task(
        &mut self,
        list_id: &str,
        status: Status,
        title: &str,
    ) -> Result<String, String> {
        self.list(list_id)?;
        let title = check_title(title)?;
        let id = uuid::Uuid::new_v4().to_string();
        let now = now();
        self.tasks.push(Task {
            id: id.clone(),
            list_id: list_id.into(),
            title,
            description_markdown: String::new(),
            status,
            priority: Priority::Medium,
            order_key: self.next_key(status),
            created_at: now.clone(),
            updated_at: now,
        });
        Ok(id)
    }
    pub fn update_task(&mut self, id: &str, patch: TaskPatch) -> Result<(), String> {
        if let Some(list) = &patch.list_id {
            self.list(list)?;
        }
        let title = patch.title.as_deref().map(check_title).transpose()?;
        if let Some(text) = &patch.description_markdown
            && text.chars().count() > MAX_DESCRIPTION
        {
            return Err(format!(
                "Descriptions can have at most {MAX_DESCRIPTION} characters"
            ));
        }
        let key = patch.status.map(|s| self.next_key(s));
        let task = self.task(id)?;
        if let Some(title) = title {
            task.title = title;
        }
        if let Some(text) = patch.description_markdown {
            task.description_markdown = text;
        }
        if let Some(priority) = patch.priority {
            task.priority = priority;
        }
        if let Some(list) = patch.list_id {
            task.list_id = list;
        }
        // A status chosen in the details goes to the end of that section.
        if let (Some(status), Some(key)) = (patch.status, key)
            && status != task.status
        {
            task.status = status;
            task.order_key = key;
        }
        task.updated_at = now();
        Ok(())
    }
    /// Places a task directly before `before`, or after `after`, or at the end of `status`.
    /// The anchors come from the view the user dragged in; only status and order change.
    pub fn move_task(
        &mut self,
        id: &str,
        status: Status,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<(), String> {
        let previous = self.task(id)?.status;
        let mut order = self.ordered(status);
        order.retain(|t| t != id);
        let anchor = |anchor: &str| {
            order
                .iter()
                .position(|t| t == anchor)
                .ok_or_else(|| "Tasks changed meanwhile; try again".to_string())
        };
        let index = match (before, after) {
            (Some(before), _) if before != id => anchor(before)?,
            (_, Some(after)) if after != id => anchor(after)? + 1,
            _ => order.len(),
        };
        order.insert(index, id.into());
        let task = self.task(id)?;
        task.status = status;
        task.updated_at = now();
        self.renumber(&order);
        if previous != status {
            let rest = self.ordered(previous);
            self.renumber(&rest);
        }
        Ok(())
    }
    pub fn delete_task(&mut self, id: &str) -> Result<(), String> {
        self.task(id)?;
        self.tasks.retain(|t| t.id != id);
        Ok(())
    }
    pub fn select_list(&mut self, id: &str) -> Result<(), String> {
        if id != ALL {
            self.list(id)?;
        }
        self.preferences.selected_list_id = id.into();
        Ok(())
    }
}
fn check_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("A task needs a title".into());
    }
    if title.chars().count() > MAX_TITLE {
        return Err(format!("Titles can have at most {MAX_TITLE} characters"));
    }
    Ok(title.into())
}
/// UTC timestamp in RFC 3339 form, without a date-time dependency.
fn now() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rest) = ((seconds / 86_400) as i64, seconds % 86_400);
    // Civil-from-days (Howard Hinnant).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

#[derive(Clone)]
pub struct Tasks {
    file: PathBuf,
    gate: Arc<Mutex<()>>,
}
impl Tasks {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            file: directory.join("tasks.json"),
            gate: Arc::new(Mutex::new(())),
        }
    }
    /// A missing file is a fresh start; anything unreadable is reported and never replaced.
    fn load(&self) -> Result<Document, String> {
        let data = match fs::read(&self.file) {
            Ok(data) => data,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Document::new()),
            Err(e) => return Err(format!("Tasks could not be read: {e}")),
        };
        let damaged = |reason: String| {
            format!(
                "The tasks file is damaged ({reason}) and was left unchanged: {}",
                display(&self.file)
            )
        };
        let value: serde_json::Value =
            serde_json::from_slice(&data).map_err(|e| damaged(e.to_string()))?;
        match value.get("schemaVersion").and_then(|v| v.as_u64()) {
            Some(1) => {}
            Some(version) if version > u64::from(SCHEMA_VERSION) => {
                return Err(format!(
                    "The tasks file was saved by a newer Tessera (schema {version}) and was left unchanged: {}",
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
        fs::create_dir_all(directory).map_err(|e| format!("Tasks were not saved: {e}"))?;
        let lock = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join("tasks.lock"))
            .map_err(|e| format!("Tasks were not saved: {e}"))?;
        fs2::FileExt::lock_exclusive(&lock).map_err(|e| e.to_string())?;
        let mut document = self.load()?;
        let result = change(&mut document)?;
        document.revision += 1;
        if fs::metadata(&self.file).is_ok_and(|m| m.permissions().readonly()) {
            return Err(format!(
                "Tasks were not saved: the tasks file is read-only: {}",
                display(&self.file)
            ));
        }
        let bytes = serde_json::to_vec_pretty(&document).map_err(|e| e.to_string())?;
        atomic_write(&self.file, &bytes).map_err(|e| format!("Tasks were not saved: {e}"))?;
        Ok((document, result))
    }
}
pub fn storage(app: &tauri::AppHandle) -> Result<Tasks, String> {
    Ok(Tasks::new(
        app.path().app_data_dir().map_err(|e| e.to_string())?,
    ))
}

/// The window that shows the one Tasks panel of this process.
#[derive(Default)]
pub struct PanelOwner(Mutex<Option<String>>);
impl PanelOwner {
    pub fn release_window(&self, label: &str) {
        if let Ok(mut owner) = self.0.lock()
            && owner.as_deref() == Some(label)
        {
            *owner = None;
        }
    }
}

async fn change<T: Send + 'static>(
    app: tauri::AppHandle,
    tasks: &State<'_, Tasks>,
    work: impl FnOnce(&mut Document) -> Result<T, String> + Send + 'static,
) -> Result<Document, String> {
    let tasks = tasks.inner().clone();
    blocking(move || {
        let (document, _) = tasks.update(work)?;
        let _ = app.emit("tasks-changed", &document);
        Ok(document)
    })
    .await
}
#[tauri::command]
pub async fn tasks_snapshot(tasks: State<'_, Tasks>) -> Result<Document, String> {
    let tasks = tasks.inner().clone();
    blocking(move || tasks.snapshot()).await
}
#[tauri::command]
pub async fn tasks_create_list(
    app: tauri::AppHandle,
    tasks: State<'_, Tasks>,
    name: String,
) -> Result<Document, String> {
    change(app, &tasks, move |d| d.create_list(&name)).await
}
#[tauri::command]
pub async fn tasks_rename_list(
    app: tauri::AppHandle,
    tasks: State<'_, Tasks>,
    id: String,
    name: String,
) -> Result<Document, String> {
    change(app, &tasks, move |d| d.rename_list(&id, &name)).await
}
#[tauri::command]
pub async fn tasks_delete_list(
    app: tauri::AppHandle,
    tasks: State<'_, Tasks>,
    id: String,
) -> Result<Document, String> {
    change(app, &tasks, move |d| d.delete_list(&id)).await
}
#[tauri::command]
pub async fn tasks_create_task(
    app: tauri::AppHandle,
    tasks: State<'_, Tasks>,
    list_id: String,
    status: Status,
    title: String,
) -> Result<Document, String> {
    change(app, &tasks, move |d| {
        d.create_task(&list_id, status, &title).map(|_| ())
    })
    .await
}
#[tauri::command]
pub async fn tasks_update_task(
    app: tauri::AppHandle,
    tasks: State<'_, Tasks>,
    id: String,
    patch: TaskPatch,
) -> Result<Document, String> {
    change(app, &tasks, move |d| d.update_task(&id, patch)).await
}
#[tauri::command]
pub async fn tasks_move_task(
    app: tauri::AppHandle,
    tasks: State<'_, Tasks>,
    id: String,
    status: Status,
    before: Option<String>,
    after: Option<String>,
) -> Result<Document, String> {
    change(app, &tasks, move |d| {
        d.move_task(&id, status, before.as_deref(), after.as_deref())
    })
    .await
}
#[tauri::command]
pub async fn tasks_delete_task(
    app: tauri::AppHandle,
    tasks: State<'_, Tasks>,
    id: String,
) -> Result<Document, String> {
    change(app, &tasks, move |d| d.delete_task(&id)).await
}
#[tauri::command]
pub async fn tasks_select_list(
    app: tauri::AppHandle,
    tasks: State<'_, Tasks>,
    id: String,
) -> Result<Document, String> {
    change(app, &tasks, move |d| d.select_list(&id)).await
}
/// Claims the Tasks panel for this window. When another window already shows it, that
/// window is raised and asked to focus its panel, and `false` is returned.
#[tauri::command]
pub fn tasks_claim_panel(
    window: WebviewWindow,
    owner: State<'_, PanelOwner>,
) -> Result<bool, String> {
    let mut current = owner.0.lock().map_err(|e| e.to_string())?;
    if let Some(label) = current.as_deref()
        && label != window.label()
        && let Some(other) = window.app_handle().get_webview_window(label)
    {
        let _ = other.unminimize();
        let _ = other.set_focus();
        let _ = other.emit_to(label, "focus-plugin", "tasks");
        return Ok(false);
    }
    *current = Some(window.label().into());
    Ok(true)
}
#[tauri::command]
pub fn tasks_release_panel(window: WebviewWindow, owner: State<'_, PanelOwner>) {
    owner.release_window(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Tasks) {
        let directory = tempfile::tempdir().unwrap();
        let tasks = Tasks::new(directory.path().to_path_buf());
        (directory, tasks)
    }
    fn titles(document: &Document, status: Status) -> Vec<String> {
        document
            .ordered(status)
            .iter()
            .map(|id| {
                document
                    .tasks
                    .iter()
                    .find(|t| &t.id == id)
                    .unwrap()
                    .title
                    .clone()
            })
            .collect()
    }
    fn id(document: &Document, title: &str) -> String {
        document
            .tasks
            .iter()
            .find(|t| t.title == title)
            .unwrap()
            .id
            .clone()
    }

    #[test]
    fn fresh_store_has_an_undeletable_inbox_and_validates_names() {
        let (_dir, tasks) = store();
        let document = tasks.snapshot().unwrap();
        assert_eq!(document.lists, vec![inbox()]);
        assert_eq!(document.preferences.selected_list_id, "all");
        assert!(tasks.update(|d| d.delete_list(INBOX)).is_err());
        assert!(tasks.update(|d| d.rename_list(INBOX, "Other")).is_err());
        let (document, _) = tasks.update(|d| d.create_list("  Work ")).unwrap();
        assert_eq!(document.lists[1].name, "Work");
        for name in [
            "",
            "   ",
            "work",
            "WORK",
            "inbox",
            "All Lists",
            &"x".repeat(81),
        ] {
            assert!(tasks.update(|d| d.create_list(name)).is_err(), "{name:?}");
        }
        let work = document.lists[1].id.clone();
        assert!(
            tasks.update(|d| d.rename_list(&work, "WORK")).is_ok(),
            "own name in another case"
        );
    }

    #[test]
    fn tasks_append_with_medium_priority_and_need_a_list_and_title() {
        let (_dir, tasks) = store();
        for title in ["one", "two", "three"] {
            tasks
                .update(|d| d.create_task(INBOX, Status::Todo, title))
                .unwrap();
        }
        let (document, _) = tasks
            .update(|d| d.create_task(INBOX, Status::Done, "  done  "))
            .unwrap();
        assert_eq!(titles(&document, Status::Todo), ["one", "two", "three"]);
        assert!(
            document
                .tasks
                .iter()
                .all(|t| t.priority == Priority::Medium)
        );
        assert_eq!(titles(&document, Status::Done), ["done"]);
        assert!(
            tasks
                .update(|d| d.create_task(INBOX, Status::Todo, "  "))
                .is_err()
        );
        assert!(
            tasks
                .update(|d| d.create_task("missing", Status::Todo, "x"))
                .is_err()
        );
        let one = id(&document, "one");
        assert!(
            tasks
                .update(|d| d.update_task(
                    &one,
                    TaskPatch {
                        title: Some(" ".into()),
                        ..Default::default()
                    }
                ))
                .is_err()
        );
        let (document, _) = tasks
            .update(|d| {
                d.update_task(
                    &one,
                    TaskPatch {
                        status: Some(Status::Done),
                        priority: Some(Priority::High),
                        description_markdown: Some("**x**".into()),
                        ..Default::default()
                    },
                )
            })
            .unwrap();
        assert_eq!(
            titles(&document, Status::Done),
            ["done", "one"],
            "status change appends"
        );
        assert!(document.created_at_ok());
    }

    #[test]
    fn moving_changes_status_and_order_but_never_the_list() {
        let (_dir, tasks) = store();
        let (document, _) = tasks.update(|d| d.create_list("Work")).unwrap();
        let work = document.lists[1].id.clone();
        for (list, title) in [
            (INBOX, "a"),
            (work.as_str(), "b"),
            (INBOX, "c"),
            (work.as_str(), "d"),
        ] {
            let list = list.to_string();
            tasks
                .update(move |d| d.create_task(&list, Status::Todo, title))
                .unwrap();
        }
        let document = tasks.snapshot().unwrap();
        let (a, b, d) = (id(&document, "a"), id(&document, "b"), id(&document, "d"));
        // In the Work view only b and d are visible: drop d before b.
        let (document, _) = tasks
            .update(|doc| doc.move_task(&d, Status::Todo, Some(&b), None))
            .unwrap();
        assert_eq!(titles(&document, Status::Todo), ["a", "d", "b", "c"]);
        let (document, _) = tasks
            .update(|doc| doc.move_task(&a, Status::InProgress, None, None))
            .unwrap();
        assert_eq!(titles(&document, Status::InProgress), ["a"]);
        assert_eq!(titles(&document, Status::Todo), ["d", "b", "c"]);
        let (document, _) = tasks
            .update(|doc| doc.move_task(&b, Status::InProgress, None, Some(&a)))
            .unwrap();
        assert_eq!(titles(&document, Status::InProgress), ["a", "b"]);
        let moved = document.tasks.iter().find(|t| t.id == b).unwrap();
        assert_eq!(moved.list_id, work, "list membership is unchanged");
        assert!(
            tasks
                .update(|doc| doc.move_task(&a, Status::Done, Some("gone"), None))
                .is_err(),
            "a stale anchor changes nothing"
        );
        assert_eq!(tasks.snapshot().unwrap(), document);
    }

    #[test]
    fn deleting_a_list_moves_its_tasks_to_the_inbox() {
        let (_dir, tasks) = store();
        let (document, _) = tasks.update(|d| d.create_list("Work")).unwrap();
        let work = document.lists[1].id.clone();
        let w = work.clone();
        tasks
            .update(move |d| d.create_task(&w, Status::Todo, "t"))
            .unwrap();
        let w = work.clone();
        tasks.update(move |d| d.select_list(&w)).unwrap();
        let w = work.clone();
        let (document, _) = tasks.update(move |d| d.delete_list(&w)).unwrap();
        assert_eq!(document.lists, vec![inbox()]);
        assert_eq!(document.tasks[0].list_id, INBOX);
        assert_eq!(document.preferences.selected_list_id, INBOX);
        let t = document.tasks[0].id.clone();
        let (document, _) = tasks.update(move |d| d.delete_task(&t)).unwrap();
        assert!(document.tasks.is_empty());
    }

    #[test]
    fn documents_round_trip_and_bad_files_are_never_overwritten() {
        let (dir, tasks) = store();
        tasks
            .update(|d| d.create_task(INBOX, Status::Todo, "kept"))
            .unwrap();
        let saved = tasks.snapshot().unwrap();
        assert_eq!(
            Tasks::new(dir.path().to_path_buf()).snapshot().unwrap(),
            saved
        );
        // A temporary file left by an interrupted save is ignored.
        fs::write(dir.path().join(".tmpABC123"), b"{\"partial").unwrap();
        assert_eq!(tasks.snapshot().unwrap(), saved);

        let file = dir.path().join("tasks.json");
        for bad in [
            b"{\"schemaVersion\":1,\"lists\":[".as_slice(),
            b"{\"lists\":[]}",
            b"{\"schemaVersion\":1,\"revision\":1,\"lists\":[],\"tasks\":[{\"id\":\"x\"}],\"preferences\":{\"selectedListId\":\"all\"}}",
            b"{\"schemaVersion\":2,\"lists\":[]}",
        ] {
            fs::write(&file, bad).unwrap();
            let error = tasks.snapshot().unwrap_err();
            assert!(error.contains("left unchanged"), "{error}");
            assert!(tasks.update(|d| d.create_list("New")).is_err());
            assert_eq!(fs::read(&file).unwrap(), bad);
        }
        assert!(tasks.snapshot().unwrap_err().contains("newer Tessera"));
    }

    #[test]
    fn missing_references_are_repaired_on_load() {
        let (dir, tasks) = store();
        fs::write(
            dir.path().join("tasks.json"),
            br#"{"schemaVersion":1,"revision":4,"lists":[{"id":"l","name":"Work","system":true}],
            "tasks":[{"id":"t","listId":"gone","title":"x","descriptionMarkdown":"","status":"in_progress",
            "priority":"high","orderKey":3,"createdAt":"","updatedAt":""}],
            "preferences":{"selectedListId":"gone"}}"#,
        )
        .unwrap();
        let document = tasks.snapshot().unwrap();
        assert_eq!(document.lists[0], inbox(), "missing Inbox is recreated");
        assert!(!document.lists[1].system);
        assert_eq!(document.tasks[0].list_id, INBOX);
        assert_eq!(document.preferences.selected_list_id, ALL);
        let (document, _) = tasks.update(|_| Ok(())).unwrap();
        assert_eq!(document.revision, 5);
    }

    #[test]
    fn failed_writes_are_reported_and_keep_the_previous_file() {
        let (dir, tasks) = store();
        tasks
            .update(|d| d.create_task(INBOX, Status::Todo, "kept"))
            .unwrap();
        let file = dir.path().join("tasks.json");
        let before = fs::read(&file).unwrap();
        let mut permissions = fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&file, permissions.clone()).unwrap();
        let error = tasks
            .update(|d| d.create_task(INBOX, Status::Todo, "lost"))
            .unwrap_err();
        assert!(error.starts_with("Tasks were not saved"), "{error}");
        assert_eq!(fs::read(&file).unwrap(), before);
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        fs::set_permissions(&file, permissions).unwrap();
    }

    #[test]
    fn timestamps_are_rfc3339_utc() {
        let stamp = now();
        assert_eq!(stamp.len(), 20, "{stamp}");
        assert!(stamp.ends_with('Z') && stamp.as_bytes()[10] == b'T');
        assert!(stamp.as_str() > "2024-01-01");
    }

    impl Document {
        fn created_at_ok(&self) -> bool {
            self.tasks
                .iter()
                .all(|t| t.created_at.len() == 20 && t.updated_at >= t.created_at)
        }
    }
}
