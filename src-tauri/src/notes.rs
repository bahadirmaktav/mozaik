//! Notes: the Markdown files of a vault folder chosen in Workspace Settings, as in Obsidian.
//! A note is a `.md` file whose name is its title; a group is a subfolder. The renderer
//! names notes and groups by their path relative to the vault (`/`-separated) and every
//! command resolves that path inside the vault again. Notes are saved like text documents
//! (revision check, cooperating-writer lock, atomic replace), creating and renaming never
//! replace an existing file, and removal only moves to the Trash.
use crate::directory::{blocking, rename_no_replace, starts_with, valid_name};
use crate::files::{self, FileData, SaveRequest};
use crate::operations::trash_one;
use crate::panels::PanelOwner;
use serde::Serialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{State, WebviewWindow};

const MAX_TITLE: usize = 120;
const MAX_CONTENT: usize = 5_000_000;
/// Bounds for scanning a vault; a larger one is listed in part, and says so.
const MAX_DEPTH: usize = 16;
const MAX_ITEMS: usize = 20_000;
const NO_VAULT: &str = "Choose a notes folder first";

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteEntry {
    /// Relative to the vault, `/`-separated, with the `.md` extension.
    pub path: String,
    /// The file name without `.md`.
    pub title: String,
    /// Milliseconds since the Unix epoch.
    pub modified: u64,
}
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    /// The vault folder; `None` until one is chosen.
    pub root: Option<String>,
    /// Every group (subfolder), relative and `/`-separated, sorted.
    pub groups: Vec<String>,
    pub notes: Vec<NoteEntry>,
    /// The vault was larger than the scan bounds; not everything is listed.
    pub truncated: bool,
}

fn is_note(name: &str) -> bool {
    name.len() > 3 && name[name.len() - 3..].eq_ignore_ascii_case(".md")
}
/// Hidden entries (`.obsidian`, `.git`, `.trash`) are not notes or groups.
fn hidden(name: &str) -> bool {
    name.starts_with('.')
}
fn sort_key(path: &str) -> (String, String) {
    (path.to_lowercase(), path.to_owned())
}

/// The vault's groups and notes, without content. Links are not followed.
pub fn scan(root: &Path) -> Result<Vault, String> {
    let mut vault = Vault {
        root: Some(root.to_string_lossy().into_owned()),
        groups: Vec::new(),
        notes: Vec::new(),
        truncated: false,
    };
    let mut pending = vec![(root.to_path_buf(), String::new(), 0usize)];
    while let Some((directory, prefix, depth)) = pending.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(e) if prefix.is_empty() => {
                return Err(format!("The notes folder could not be read: {e}"));
            }
            // An unreadable group is shown empty rather than failing the whole vault.
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if hidden(&name) {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if vault.groups.len() + vault.notes.len() >= MAX_ITEMS {
                vault.truncated = true;
                break;
            }
            let path = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if kind.is_dir() {
                if depth + 1 >= MAX_DEPTH {
                    vault.truncated = true;
                    continue;
                }
                vault.groups.push(path.clone());
                pending.push((entry.path(), path, depth + 1));
            } else if kind.is_file() && is_note(&name) {
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as u64);
                vault.notes.push(NoteEntry {
                    title: name[..name.len() - 3].to_owned(),
                    path,
                    modified,
                });
            }
        }
    }
    vault.groups.sort_by_cached_key(|g| sort_key(g));
    vault.notes.sort_by_cached_key(|n| sort_key(&n.path));
    Ok(vault)
}

/// A vault-relative path, checked component by component; `""` is the vault itself.
pub fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    if relative.is_empty() {
        return Ok(path);
    }
    for part in relative.split('/') {
        if hidden(part) || valid_name(part).is_err() {
            return Err(format!("Not a note or group of this vault: {relative}"));
        }
        path.push(part);
    }
    Ok(path)
}
fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}
fn check_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("A note needs a title".into());
    }
    if title.chars().count() > MAX_TITLE {
        return Err(format!("Titles can have at most {MAX_TITLE} characters"));
    }
    if hidden(title) {
        return Err("Titles cannot start with a dot".into());
    }
    valid_name(&format!("{title}.md"))?;
    Ok(title.into())
}
fn check_group_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A group needs a name".into());
    }
    if hidden(name) {
        return Err("Group names cannot start with a dot".into());
    }
    valid_name(name)?;
    Ok(name.into())
}
fn group_dir(root: &Path, group: &str) -> Result<PathBuf, String> {
    let directory = resolve(root, group)?;
    if !directory.is_dir() {
        return Err(format!("The group {group} no longer exists"));
    }
    Ok(directory)
}
fn note_file(root: &Path, path: &str) -> Result<PathBuf, String> {
    if !is_note(path) {
        return Err(format!("Not a note of this vault: {path}"));
    }
    let file = resolve(root, path)?;
    // A link could lead out of the vault; the canonical file must stay inside it.
    let canonical = file
        .canonicalize()
        .map_err(|_| format!("The note {path} no longer exists"))?;
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    if !starts_with(&canonical, &base) {
        return Err(format!("Not a note of this vault: {path}"));
    }
    Ok(file)
}
fn exists_error<'a>(kind: &'a str, name: &'a str) -> impl Fn(io::Error) -> String + 'a {
    move |e| {
        if e.kind() == io::ErrorKind::AlreadyExists {
            format!("A {kind} named “{name}” already exists there")
        } else {
            e.to_string()
        }
    }
}

pub fn read(root: &Path, path: &str) -> Result<FileData, String> {
    files::read(&note_file(root, path)?)
}
pub fn write(
    root: &Path,
    path: &str,
    text: String,
    revision: String,
    bom: bool,
    ending: String,
) -> Result<FileData, String> {
    if text.chars().count() > MAX_CONTENT {
        return Err(format!("A note can have at most {MAX_CONTENT} characters"));
    }
    let file = note_file(root, path)?;
    let request = SaveRequest {
        path: None,
        text,
        revision: Some(revision.clone()),
        bom,
        ending,
        name: String::new(),
        excluded_paths: Vec::new(),
    };
    files::save(&file, &request, Some(&revision))
}
/// A new, empty note; an existing file of that name is never replaced.
pub fn create(root: &Path, group: &str, title: &str) -> Result<String, String> {
    let title = check_title(title)?;
    let file = group_dir(root, group)?.join(format!("{title}.md"));
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&file)
        .map_err(exists_error("note", &title))?;
    Ok(relative(root, &file))
}
pub fn create_group(root: &Path, parent: &str, name: &str) -> Result<String, String> {
    let name = check_group_name(name)?;
    let directory = group_dir(root, parent)?.join(&name);
    fs::create_dir(&directory).map_err(exists_error("group", &name))?;
    Ok(relative(root, &directory))
}
/// Renames a note (its title) or a group; never replaces an existing one.
pub fn rename(root: &Path, path: &str, name: &str) -> Result<String, String> {
    let (source, target_name, kind) = if is_note(path) {
        let title = check_title(name)?;
        (note_file(root, path)?, format!("{title}.md"), "note")
    } else {
        let name = check_group_name(name)?;
        (group_dir(root, path)?, name, "group")
    };
    if path.is_empty() {
        return Err("The notes folder itself cannot be renamed here".into());
    }
    let target = source.with_file_name(&target_name);
    if source.file_name() == target.file_name() {
        return Ok(path.into());
    }
    let only_case = source
        .file_name()
        .zip(target.file_name())
        .is_some_and(|(a, b)| {
            a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
        });
    if only_case {
        // Case-insensitive file systems see the target as the source itself.
        fs::rename(&source, &target).map_err(|e| e.to_string())?;
    } else {
        rename_no_replace(&source, &target).map_err(exists_error(kind, &target_name))?;
    }
    Ok(relative(root, &target))
}
/// Moves a note or a group into another group (`""` is the vault itself).
pub fn move_to(root: &Path, path: &str, group: &str) -> Result<String, String> {
    if path.is_empty() {
        return Err("The notes folder itself cannot be moved".into());
    }
    let source = if is_note(path) {
        note_file(root, path)?
    } else {
        group_dir(root, path)?
    };
    let target_dir = group_dir(root, group)?;
    if !is_note(path) && (group == path || group.starts_with(&format!("{path}/"))) {
        return Err("A group cannot move into itself".into());
    }
    let name = source.file_name().ok_or("Invalid path")?;
    let target = target_dir.join(name);
    if target == source {
        return Ok(path.into());
    }
    let label = name.to_string_lossy().into_owned();
    rename_no_replace(&source, &target).map_err(exists_error(
        if is_note(path) { "note" } else { "group" },
        &label,
    ))?;
    Ok(relative(root, &target))
}
/// Moves a note or a group with its notes to the Trash; never deletes permanently.
pub fn trash(root: &Path, path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("The notes folder itself cannot be moved to the Trash here".into());
    }
    let target = if is_note(path) {
        note_file(root, path)?
    } else {
        group_dir(root, path)?
    };
    trash_one(&target)
}

fn vault(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::preferences::notes_folder(app)?.ok_or_else(|| NO_VAULT.into())
}
/// Runs `work` on the vault off the main thread.
async fn with_vault<T: Send + 'static>(
    app: tauri::AppHandle,
    work: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    blocking(move || work(&vault(&app)?)).await
}

#[tauri::command]
pub async fn notes_snapshot(app: tauri::AppHandle) -> Result<Vault, String> {
    blocking(move || match crate::preferences::notes_folder(&app)? {
        Some(root) => scan(&root),
        None => Ok(Vault {
            root: None,
            groups: Vec::new(),
            notes: Vec::new(),
            truncated: false,
        }),
    })
    .await
}
#[tauri::command]
pub async fn notes_read(app: tauri::AppHandle, path: String) -> Result<FileData, String> {
    with_vault(app, move |root| read(root, &path)).await
}
#[tauri::command]
pub async fn notes_write(
    app: tauri::AppHandle,
    path: String,
    text: String,
    revision: String,
    bom: bool,
    ending: String,
) -> Result<FileData, String> {
    with_vault(app, move |root| {
        write(root, &path, text, revision, bom, ending)
    })
    .await
}
#[tauri::command]
pub async fn notes_create(
    app: tauri::AppHandle,
    group: String,
    title: String,
) -> Result<String, String> {
    with_vault(app, move |root| create(root, &group, &title)).await
}
#[tauri::command]
pub async fn notes_create_group(
    app: tauri::AppHandle,
    parent: String,
    name: String,
) -> Result<String, String> {
    with_vault(app, move |root| create_group(root, &parent, &name)).await
}
#[tauri::command]
pub async fn notes_rename(
    app: tauri::AppHandle,
    path: String,
    name: String,
) -> Result<String, String> {
    with_vault(app, move |root| rename(root, &path, &name)).await
}
#[tauri::command]
pub async fn notes_move(
    app: tauri::AppHandle,
    path: String,
    group: String,
) -> Result<String, String> {
    with_vault(app, move |root| move_to(root, &path, &group)).await
}
#[tauri::command]
pub async fn notes_trash(app: tauri::AppHandle, path: String) -> Result<(), String> {
    with_vault(app, move |root| trash(root, &path)).await
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

    fn vault() -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().canonicalize().unwrap();
        (directory, root)
    }
    fn paths(root: &Path) -> (Vec<String>, Vec<String>) {
        let vault = scan(root).unwrap();
        (
            vault.groups,
            vault.notes.into_iter().map(|n| n.path).collect(),
        )
    }

    #[test]
    fn scan_lists_markdown_notes_and_groups_without_hidden_entries() {
        let (_dir, root) = vault();
        fs::create_dir_all(root.join("Work/Meetings")).unwrap();
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        fs::write(root.join("b.md"), "").unwrap();
        fs::write(root.join("A.MD"), "").unwrap();
        fs::write(root.join("image.png"), "").unwrap();
        fs::write(root.join(".hidden.md"), "").unwrap();
        fs::write(root.join(".obsidian/app.md"), "").unwrap();
        fs::write(root.join("Work/Meetings/Monday.md"), "x").unwrap();
        let vault = scan(&root).unwrap();
        assert_eq!(vault.groups, ["Work", "Work/Meetings"]);
        assert_eq!(
            vault.notes.iter().map(|n| &n.path[..]).collect::<Vec<_>>(),
            ["A.MD", "b.md", "Work/Meetings/Monday.md"]
        );
        assert_eq!(vault.notes[0].title, "A");
        assert!(!vault.truncated);
    }

    #[test]
    fn paths_stay_inside_the_vault() {
        let (_dir, root) = vault();
        for bad in [
            "../x.md",
            "a/../../x.md",
            ".obsidian/x.md",
            "a//b.md",
            "/x.md",
        ] {
            assert!(resolve(&root, bad).is_err(), "{bad}");
        }
        assert_eq!(
            resolve(&root, "a/b.md").unwrap(),
            root.join("a").join("b.md")
        );
        assert!(read(&root, "missing.md").is_err());
        assert!(read(&root, "notes.txt").is_err());
    }

    #[test]
    fn notes_are_created_saved_with_a_revision_check_and_never_replaced() {
        let (_dir, root) = vault();
        let path = create(&root, "", " Ideas ").unwrap();
        assert_eq!(path, "Ideas.md");
        assert!(
            create(&root, "", "Ideas")
                .unwrap_err()
                .contains("already exists")
        );
        assert!(create(&root, "", "").is_err());
        assert!(create(&root, "", "a/b").is_err());
        assert!(create(&root, "Missing", "x").is_err());

        let file = read(&root, &path).unwrap();
        assert_eq!(file.text, "");
        let saved = write(
            &root,
            &path,
            "# Ideas\n".into(),
            file.revision.clone(),
            false,
            "lf".into(),
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("Ideas.md")).unwrap(),
            "# Ideas\n"
        );
        // A stale revision (another program wrote meanwhile) is refused.
        assert!(
            write(
                &root,
                &path,
                "lost".into(),
                file.revision,
                false,
                "lf".into()
            )
            .is_err()
        );
        assert_eq!(read(&root, &path).unwrap().revision, saved.revision);
    }

    #[test]
    fn groups_are_folders_that_notes_and_groups_move_between() {
        let (_dir, root) = vault();
        assert_eq!(create_group(&root, "", "Work").unwrap(), "Work");
        assert_eq!(create_group(&root, "Work", "Old").unwrap(), "Work/Old");
        assert!(create_group(&root, "", "Work").is_err());
        assert!(create_group(&root, "", ".git").is_err());
        let note = create(&root, "", "Plan").unwrap();
        let moved = move_to(&root, &note, "Work").unwrap();
        assert_eq!(moved, "Work/Plan.md");
        create(&root, "", "Plan").unwrap();
        // The same name in the target is never replaced.
        assert!(move_to(&root, "Plan.md", "Work").is_err());
        assert!(move_to(&root, "Work", "Work/Old").is_err());
        assert_eq!(move_to(&root, "Work/Old", "").unwrap(), "Old");
        assert_eq!(
            paths(&root),
            (
                vec!["Old".to_string(), "Work".to_string()],
                vec!["Plan.md".to_string(), "Work/Plan.md".to_string()]
            )
        );
    }

    #[test]
    fn renaming_keeps_existing_names_and_allows_case_changes() {
        let (_dir, root) = vault();
        create(&root, "", "one").unwrap();
        create(&root, "", "two").unwrap();
        assert!(rename(&root, "one.md", "two").is_err());
        assert_eq!(rename(&root, "one.md", "One").unwrap(), "One.md");
        assert_eq!(rename(&root, "One.md", "Three").unwrap(), "Three.md");
        create_group(&root, "", "a").unwrap();
        assert_eq!(rename(&root, "a", "b").unwrap(), "b");
        assert!(rename(&root, "", "x").is_err());
        assert_eq!(
            paths(&root).1,
            vec!["Three.md".to_string(), "two.md".to_string()]
        );
    }
}
