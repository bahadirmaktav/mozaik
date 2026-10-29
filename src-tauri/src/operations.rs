//! Copy, move, Trash and permanent delete. Every placement goes through a staging item in
//! the destination folder and a no-replace rename, so an existing item is never overwritten
//! implicitly and a failure never removes the source.
use crate::directory::{
    blocking, display, entry, protected, rename_no_replace, resolve, same_path, starts_with,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::{State, ipc::Channel};

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Copy,
    Move,
}
#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Resolution {
    Replace,
    KeepBoth,
    Skip,
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub source: String,
    pub target: String,
    pub name: String,
    pub source_directory: bool,
    pub target_directory: bool,
    /// Pasting an item into its own folder: only Keep Both or Skip make sense.
    pub same: bool,
}
#[derive(Serialize, Debug)]
pub struct Plan {
    pub conflicts: Vec<Conflict>,
}
#[derive(Serialize, Debug, Clone)]
pub struct Failure {
    pub name: String,
    pub error: String,
}
#[derive(Serialize, Debug, Default)]
pub struct Report {
    /// Final paths of the items that were placed.
    pub completed: Vec<String>,
    pub skipped: usize,
    pub failed: Vec<Failure>,
    pub cancelled: bool,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub files: u64,
    pub current: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferRequest {
    pub id: String,
    pub sources: Vec<String>,
    pub destination: String,
    pub mode: Mode,
    /// Decisions for conflicts, keyed by source path. A conflict without a decision is
    /// reported as a failure; nothing is replaced without an explicit `Replace`.
    #[serde(default)]
    pub resolutions: HashMap<String, Resolution>,
}

#[derive(Default)]
pub struct Operations {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}
#[tauri::command]
pub fn cancel_operation(state: State<Operations>, id: String) {
    if let Some(flag) = state.cancels.lock().ok().and_then(|c| c.get(&id).cloned()) {
        flag.store(true, Ordering::Relaxed);
    }
}

struct Item {
    source: PathBuf,
    name: std::ffi::OsString,
    directory: bool,
}
fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| display(path))
}
fn destination_folder(destination: &str) -> Result<PathBuf, String> {
    let destination = resolve(destination)?;
    match fs::metadata(&destination) {
        Ok(m) if m.is_dir() => Ok(destination),
        Ok(_) => Err(format!("{} is not a folder", display(&destination))),
        Err(_) => Err(format!("{} does not exist", display(&destination))),
    }
}
/// Rejects sources that cannot be placed in `destination` at all.
fn items(sources: &[String], destination: &Path, mode: Mode) -> Result<Vec<Item>, String> {
    let mut result: Vec<Item> = Vec::new();
    let real_destination = destination.canonicalize().ok();
    for source in sources {
        let path = resolve(source)?;
        if result.iter().any(|i| same_path(&i.source, &path)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|_| format!("{} no longer exists", display(&path)))?;
        let name = path
            .file_name()
            .ok_or_else(|| format!("{} cannot be copied or moved", display(&path)))?
            .to_owned();
        if mode == Mode::Move
            && let Some(reason) = protected(&path)
        {
            return Err(format!("{reason}; it cannot be moved"));
        }
        // A real folder cannot go into itself, also when the destination is reached through a link.
        if metadata.is_dir() {
            let inside = starts_with(destination, &path)
                || matches!(
                    (&real_destination, path.canonicalize()),
                    (Some(dest), Ok(src)) if dest.starts_with(&src)
                );
            if inside {
                return Err(format!(
                    "“{}” cannot be placed inside itself",
                    name.to_string_lossy()
                ));
            }
        }
        result.push(Item {
            source: path,
            name,
            directory: metadata.is_dir(),
        });
    }
    Ok(result)
}
fn writable(directory: &Path) -> Result<(), String> {
    tempfile::Builder::new()
        .prefix(".tessera-")
        .tempfile_in(directory)
        .map(drop)
        .map_err(|e| match e.kind() {
            io::ErrorKind::PermissionDenied => format!(
                "You do not have permission to add items to {}",
                display(directory)
            ),
            _ => format!("Cannot write to {}: {e}", display(directory)),
        })
}

/// Validates a copy/move and lists the conflicts the user must decide on.
#[tauri::command]
pub async fn plan_transfer(
    sources: Vec<String>,
    destination: String,
    mode: Mode,
) -> Result<Plan, String> {
    blocking(move || plan(&sources, &destination, mode)).await
}
pub fn plan(sources: &[String], destination: &str, mode: Mode) -> Result<Plan, String> {
    let destination = destination_folder(destination)?;
    let items = items(sources, &destination, mode)?;
    writable(&destination)?;
    let mut conflicts = Vec::new();
    for item in items {
        let target = destination.join(&item.name);
        if mode == Mode::Move && same_path(&target, &item.source) {
            continue; // Already there; the transfer skips it.
        }
        if let Ok(existing) = fs::symlink_metadata(&target) {
            conflicts.push(Conflict {
                source: display(&item.source),
                target: display(&target),
                name: item.name.to_string_lossy().into_owned(),
                source_directory: item.directory,
                target_directory: existing.is_dir(),
                same: same_path(&target, &item.source),
            });
        }
    }
    Ok(Plan { conflicts })
}

/// "name (2).ext", "name (3).ext", … — the first name not present in `directory`.
pub fn keep_both_name(directory: &Path, name: &str, is_directory: bool) -> Result<PathBuf, String> {
    let (stem, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 && !is_directory => name.split_at(dot),
        _ => (name, ""),
    };
    // "notes (2).txt" continues as "notes (3).txt", not "notes (2) (2).txt".
    let stem = stem
        .strip_suffix(')')
        .and_then(|s| s.rsplit_once(" ("))
        .filter(|(_, n)| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        .map_or(stem, |(base, _)| base);
    (2..10_000)
        .map(|n| directory.join(format!("{stem} ({n}){extension}")))
        .find(|candidate| fs::symlink_metadata(candidate).is_err())
        .ok_or_else(|| format!("No free name was found for “{name}”"))
}

struct Copier<'a> {
    cancel: &'a AtomicBool,
    progress: &'a dyn Fn(Progress),
    files: u64,
    last: Instant,
}
const CANCELLED: &str = "Cancelled";
impl Copier<'_> {
    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::Relaxed) {
            Err(CANCELLED.into())
        } else {
            Ok(())
        }
    }
    fn tick(&mut self, path: &Path) {
        self.files += 1;
        if self.last.elapsed() > Duration::from_millis(100) {
            self.last = Instant::now();
            (self.progress)(Progress {
                files: self.files,
                current: name_of(path),
            });
        }
    }
    /// Copies without following links: links are recreated, special files are refused.
    fn copy(&mut self, source: &Path, target: &Path) -> Result<(), String> {
        self.check()?;
        let metadata = fs::symlink_metadata(source).map_err(|e| failure(source, e))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            copy_link(source, target).map_err(|e| failure(source, e))?;
            self.tick(source);
        } else if file_type.is_dir() {
            fs::create_dir(target).map_err(|e| failure(target, e))?;
            for child in fs::read_dir(source).map_err(|e| failure(source, e))? {
                let child = child.map_err(|e| failure(source, e))?;
                self.copy(&child.path(), &target.join(child.file_name()))?;
            }
            let _ = fs::set_permissions(target, metadata.permissions());
        } else if file_type.is_file() {
            fs::copy(source, target).map_err(|e| failure(source, e))?;
            // Windows CopyFileEx keeps timestamps; elsewhere restore the modification time.
            if let Ok(modified) = metadata.modified() {
                let _ = fs::File::options()
                    .write(true)
                    .open(target)
                    .and_then(|f| f.set_modified(modified));
            }
            self.tick(source);
        } else {
            return Err(format!(
                "“{}” is not a regular file and cannot be copied",
                name_of(source)
            ));
        }
        Ok(())
    }
}
fn failure(path: &Path, error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::PermissionDenied => format!("Permission denied: {}", display(path)),
        io::ErrorKind::NotFound => format!("{} no longer exists", display(path)),
        _ => format!("{}: {error}", display(path)),
    }
}
#[cfg(unix)]
fn copy_link(source: &Path, target: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(fs::read_link(source)?, target)
}
#[cfg(windows)]
fn copy_link(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::fs::{FileTypeExt, symlink_dir, symlink_file};
    let link = fs::read_link(source)?;
    let created = if fs::symlink_metadata(source)?.file_type().is_symlink_dir() {
        symlink_dir(link, target)
    } else {
        symlink_file(link, target)
    };
    created.map_err(|e| {
        io::Error::new(
            e.kind(),
            format!("links can only be copied with Windows Developer Mode or elevation ({e})"),
        )
    })
}

/// Removes an item permanently without following links.
pub fn remove(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() {
        // `remove_dir_all` does not traverse symlinks or junctions inside the tree.
        fs::remove_dir_all(path)
    } else if metadata.is_symlink() && cfg!(windows) && is_directory_link(&metadata) {
        fs::remove_dir(path)
    } else {
        fs::remove_file(path)
    }
}
#[cfg(windows)]
fn is_directory_link(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::FileTypeExt;
    metadata.file_type().is_symlink_dir()
}
#[cfg(not(windows))]
fn is_directory_link(_: &fs::Metadata) -> bool {
    false
}

fn staging_path(directory: &Path) -> PathBuf {
    directory.join(format!(".tessera-{}.partial", uuid::Uuid::new_v4()))
}
/// Where a staged item lives, and whether the source itself was renamed there.
struct Staged {
    path: PathBuf,
    renamed_source: bool,
}
fn unstage(staged: &Staged, source: &Path) -> Option<String> {
    let restored = if staged.renamed_source {
        fs::rename(&staged.path, source)
    } else {
        remove(&staged.path)
    };
    restored.err().map(|e| {
        format!(
            "The partial item was left at {}: {e}",
            display(&staged.path)
        )
    })
}

pub struct Transfer<'a> {
    pub mode: Mode,
    pub destination: PathBuf,
    pub resolutions: &'a HashMap<String, Resolution>,
    pub cancel: &'a AtomicBool,
    pub progress: &'a dyn Fn(Progress),
    /// Moves a replaced item out of the way. Production sends it to the Trash.
    pub discard: &'a dyn Fn(&Path) -> Result<(), String>,
}
impl Transfer<'_> {
    pub fn run(&self, sources: &[String]) -> Result<Report, String> {
        let items = items(sources, &self.destination, self.mode)?;
        let mut report = Report::default();
        let mut copier = Copier {
            cancel: self.cancel,
            progress: self.progress,
            files: 0,
            last: Instant::now(),
        };
        for item in items {
            if self.cancel.load(Ordering::Relaxed) {
                report.cancelled = true;
                break;
            }
            match self.one(&item, &mut copier) {
                Ok(Some(path)) => report.completed.push(display(&path)),
                Ok(None) => report.skipped += 1,
                Err(error) if error == CANCELLED => {
                    report.cancelled = true;
                    break;
                }
                Err(error) => report.failed.push(Failure {
                    name: item.name.to_string_lossy().into_owned(),
                    error,
                }),
            }
        }
        Ok(report)
    }
    fn one(&self, item: &Item, copier: &mut Copier) -> Result<Option<PathBuf>, String> {
        let name = item.name.to_string_lossy();
        let mut target = self.destination.join(&item.name);
        let same = same_path(&target, &item.source);
        if self.mode == Mode::Move && same {
            return Ok(None);
        }
        let mut replace = false;
        if fs::symlink_metadata(&target).is_ok() {
            match self.resolutions.get(&display(&item.source)) {
                None => {
                    return Err(format!(
                        "An item named “{name}” is already in the destination; nothing was replaced"
                    ));
                }
                Some(Resolution::Skip) => return Ok(None),
                Some(Resolution::KeepBoth) => {
                    target = keep_both_name(&self.destination, &name, item.directory)?
                }
                Some(Resolution::Replace) if same => {
                    return Err(format!("“{name}” cannot replace itself"));
                }
                Some(Resolution::Replace) => replace = true,
            }
        }
        let staged = self.stage(item, copier)?;
        if replace
            && fs::symlink_metadata(&target).is_ok()
            && let Err(error) = (self.discard)(&target)
        {
            let note = unstage(&staged, &item.source).unwrap_or_default();
            return Err(format!(
                "The existing “{name}” could not be moved to the Trash, so nothing was replaced: {error} {note}"
            ));
        }
        // Keep Both may race with another writer taking the same name: choose again.
        let mut attempts = 0;
        loop {
            match rename_no_replace(&staged.path, &target) {
                Ok(()) => break,
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists && attempts < 5 && !replace => {
                    attempts += 1;
                    target = keep_both_name(&self.destination, &name, item.directory)?;
                }
                Err(e) => {
                    let note = unstage(&staged, &item.source).unwrap_or_default();
                    let replaced = if replace {
                        " The replaced item is in the Trash."
                    } else {
                        ""
                    };
                    return Err(format!("Could not place “{name}”: {e}.{replaced} {note}"));
                }
            }
        }
        if self.mode == Mode::Move && !staged.renamed_source {
            // Cross-volume move: the copy is complete and in place; only now remove the source.
            remove(&item.source).map_err(|e| {
                format!(
                    "Copied to {}, but the original could not be removed: {e}",
                    display(&target)
                )
            })?;
        }
        Ok(Some(target))
    }
    fn stage(&self, item: &Item, copier: &mut Copier) -> Result<Staged, String> {
        let path = staging_path(&self.destination);
        if self.mode == Mode::Move {
            match rename_no_replace(&item.source, &path) {
                Ok(()) => {
                    copier.tick(&item.source);
                    return Ok(Staged {
                        path,
                        renamed_source: true,
                    });
                }
                Err(e) if e.kind() == io::ErrorKind::CrossesDevices => (),
                Err(e) => return Err(failure(&item.source, e)),
            }
        }
        let staged = Staged {
            path,
            renamed_source: false,
        };
        if let Err(error) = copier.copy(&item.source, &staged.path) {
            if fs::symlink_metadata(&staged.path).is_ok() {
                let _ = remove(&staged.path);
            }
            return Err(error);
        }
        Ok(staged)
    }
}

#[tauri::command]
pub async fn transfer_entries(
    state: State<'_, Operations>,
    request: TransferRequest,
    progress: Channel<Progress>,
) -> Result<Report, String> {
    uuid::Uuid::parse_str(&request.id).map_err(|_| "Invalid operation ID")?;
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .cancels
        .lock()
        .map_err(|e| e.to_string())?
        .insert(request.id.clone(), cancel.clone());
    let id = request.id.clone();
    let result = blocking(move || {
        let transfer = Transfer {
            mode: request.mode,
            destination: destination_folder(&request.destination)?,
            resolutions: &request.resolutions,
            cancel: &cancel,
            progress: &|p| {
                let _ = progress.send(p);
            },
            discard: &trash_one,
        };
        transfer.run(&request.sources)
    })
    .await;
    if let Ok(mut cancels) = state.cancels.lock() {
        cancels.remove(&id);
    }
    result
}

#[cfg(windows)]
fn recycle_bin_available(path: &Path) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::{SHQUERYRBINFO, SHQueryRecycleBinW};
    let root: PathBuf = path
        .components()
        .take_while(|c| {
            matches!(
                c,
                std::path::Component::Prefix(_) | std::path::Component::RootDir
            )
        })
        .collect();
    let mut info = SHQUERYRBINFO {
        cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
        i64Size: 0,
        i64NumItems: 0,
    };
    // Network shares and some removable drives have no Recycle Bin; Windows would delete
    // permanently there, which Tessera must never do as a fallback.
    let root_wide: Vec<u16> = display(&root).encode_utf16().chain([0]).collect();
    let result = unsafe { SHQueryRecycleBinW(root_wide.as_ptr(), &mut info) };
    if result < 0 {
        return Err(format!(
            "The Recycle Bin is not available for {}; nothing was deleted",
            display(&root)
        ));
    }
    Ok(())
}
#[cfg(not(windows))]
fn recycle_bin_available(_: &Path) -> Result<(), String> {
    Ok(())
}
fn trash_one(path: &Path) -> Result<(), String> {
    recycle_bin_available(path)?;
    trash::delete(path).map_err(|e| format!("Moving to the Trash failed: {e}"))
}

/// Sends items to the Trash/Recycle Bin. Never falls back to permanent deletion.
#[tauri::command]
pub async fn trash_entries(paths: Vec<String>) -> Result<Vec<Failure>, String> {
    blocking(move || Ok(delete_each(&paths, trash_one))).await
}
/// Irreversible removal; the renderer must have asked for explicit confirmation.
#[tauri::command]
pub async fn delete_permanently(
    paths: Vec<String>,
    confirmed: bool,
) -> Result<Vec<Failure>, String> {
    if !confirmed {
        return Err("Permanent deletion requires confirmation".into());
    }
    blocking(move || {
        Ok(delete_each(&paths, |p| {
            remove(p).map_err(|e| failure(p, e))
        }))
    })
    .await
}
pub fn delete_each(paths: &[String], delete: impl Fn(&Path) -> Result<(), String>) -> Vec<Failure> {
    let mut failed = Vec::new();
    for raw in paths {
        let result = resolve(raw).and_then(|path| {
            if let Some(reason) = protected(&path) {
                return Err(format!("{reason}; it was not deleted"));
            }
            entry(&path).map_err(|e| failure(&path, e))?;
            delete(&path)
        });
        if let Err(error) = result {
            failed.push(Failure {
                name: Path::new(raw)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| raw.clone()),
                error,
            });
        }
    }
    failed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(
        mode: Mode,
        sources: &[&Path],
        destination: &Path,
        resolutions: HashMap<String, Resolution>,
        discarded: &Mutex<Vec<PathBuf>>,
    ) -> Report {
        let discard = |p: &Path| {
            // Test double for the Trash: keep the replaced content aside instead of using the OS bin.
            let aside = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
            fs::rename(p, &aside).map_err(|e| e.to_string())?;
            discarded.lock().unwrap().push(aside);
            Ok(())
        };
        Transfer {
            mode,
            destination: destination.to_path_buf(),
            resolutions: &resolutions,
            cancel: &AtomicBool::new(false),
            progress: &|_| {},
            discard: &discard,
        }
        .run(&sources.iter().map(|p| display(p)).collect::<Vec<_>>())
        .unwrap()
    }
    fn tree() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        fs::create_dir_all(a.join("folder").join("nested")).unwrap();
        fs::write(a.join("folder").join("nested").join("deep.txt"), b"deep").unwrap();
        fs::write(a.join("note.txt"), b"new").unwrap();
        fs::create_dir(&b).unwrap();
        fs::write(b.join("note.txt"), b"old").unwrap();
        (dir, a, b)
    }

    #[test]
    fn plan_reports_conflicts_and_rejects_cycles() {
        let (_dir, a, b) = tree();
        let sources = [display(&a.join("note.txt")), display(&a.join("folder"))];
        let plan = plan(&sources, &display(&b), Mode::Copy).unwrap();
        assert_eq!(plan.conflicts.len(), 1);
        assert_eq!(plan.conflicts[0].name, "note.txt");
        assert!(!plan.conflicts[0].same);
        let nested = display(&a.join("folder").join("nested"));
        for mode in [Mode::Copy, Mode::Move] {
            assert!(super::plan(&[display(&a.join("folder"))], &nested, mode).is_err());
            assert!(super::plan(&[display(&a)], &display(&a), mode).is_err());
        }
        let same = super::plan(&[display(&a.join("note.txt"))], &display(&a), Mode::Copy).unwrap();
        assert!(same.conflicts[0].same);
    }
    #[test]
    fn unresolved_conflicts_and_skip_never_overwrite() {
        let (_dir, a, b) = tree();
        let discarded = Mutex::new(vec![]);
        let report = run(
            Mode::Copy,
            &[&a.join("note.txt")],
            &b,
            HashMap::new(),
            &discarded,
        );
        assert_eq!(report.failed.len(), 1);
        let skip = HashMap::from([(display(&a.join("note.txt")), Resolution::Skip)]);
        let report = run(Mode::Move, &[&a.join("note.txt")], &b, skip, &discarded);
        assert_eq!(report.skipped, 1);
        assert_eq!(fs::read(b.join("note.txt")).unwrap(), b"old");
        assert!(a.join("note.txt").exists());
        assert!(discarded.lock().unwrap().is_empty());
        assert_eq!(fs::read_dir(&b).unwrap().count(), 1, "no staging leftovers");
    }
    #[test]
    fn keep_both_and_replace_resolve_explicitly() {
        let (_dir, a, b) = tree();
        let discarded = Mutex::new(vec![]);
        let source = a.join("note.txt");
        let both = HashMap::from([(display(&source), Resolution::KeepBoth)]);
        let report = run(Mode::Copy, &[&source], &b, both.clone(), &discarded);
        assert_eq!(report.completed, vec![display(&b.join("note (2).txt"))]);
        run(Mode::Copy, &[&source], &b, both, &discarded);
        assert!(b.join("note (3).txt").exists());
        let replace = HashMap::from([(display(&source), Resolution::Replace)]);
        let report = run(Mode::Move, &[&source], &b, replace, &discarded);
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert_eq!(fs::read(b.join("note.txt")).unwrap(), b"new");
        assert!(!source.exists());
        let aside = discarded.lock().unwrap();
        assert_eq!(
            fs::read(&aside[0]).unwrap(),
            b"old",
            "replaced item is recoverable"
        );
    }
    #[test]
    fn copying_into_the_same_folder_keeps_both() {
        let (_dir, a, _b) = tree();
        let source = a.join("folder");
        let both = HashMap::from([(display(&source), Resolution::KeepBoth)]);
        let report = run(Mode::Copy, &[&source], &a, both, &Mutex::new(vec![]));
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert!(
            a.join("folder (2)")
                .join("nested")
                .join("deep.txt")
                .exists()
        );
        let replace = HashMap::from([(display(&source), Resolution::Replace)]);
        let report = run(Mode::Copy, &[&source], &a, replace, &Mutex::new(vec![]));
        assert_eq!(report.failed.len(), 1);
        assert!(source.join("nested").join("deep.txt").exists());
    }
    #[test]
    fn moves_folders_and_copy_failures_leave_the_source_intact() {
        let (_dir, a, b) = tree();
        let report = run(
            Mode::Move,
            &[&a.join("folder")],
            &b,
            HashMap::new(),
            &Mutex::new(vec![]),
        );
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert!(b.join("folder").join("nested").join("deep.txt").exists());
        assert!(!a.join("folder").exists());
        // Cross-volume moves copy into staging first; an interrupted copy is cleaned up
        // and the source stays where it was.
        let before = fs::read_dir(&a).unwrap().count();
        let mut copier = Copier {
            cancel: &AtomicBool::new(true),
            progress: &|_| {},
            files: 0,
            last: Instant::now(),
        };
        let transfer = Transfer {
            mode: Mode::Copy,
            destination: a.clone(),
            resolutions: &HashMap::new(),
            cancel: &AtomicBool::new(false),
            progress: &|_| {},
            discard: &|_| Ok(()),
        };
        let item = Item {
            source: b.join("folder"),
            name: "folder".into(),
            directory: true,
        };
        assert_eq!(transfer.stage(&item, &mut copier).err().unwrap(), CANCELLED);
        assert_eq!(fs::read_dir(&a).unwrap().count(), before);
        assert!(b.join("folder").join("nested").join("deep.txt").exists());
    }
    #[test]
    fn missing_sources_and_protected_paths_are_refused() {
        let (_dir, a, b) = tree();
        assert!(plan(&[display(&a.join("gone"))], &display(&b), Mode::Copy).is_err());
        let home = crate::directory::home().unwrap();
        let failed = delete_each(&[display(&home)], |_| panic!("must not delete home"));
        assert_eq!(failed.len(), 1);
        let failed = delete_each(&[display(&b.join("note.txt"))], |p| {
            remove(p).map_err(|e| e.to_string())
        });
        assert!(failed.is_empty());
        assert!(!b.join("note.txt").exists());
    }
    #[cfg(unix)]
    #[test]
    fn copies_recreate_links_instead_of_following_them() {
        let (_dir, a, b) = tree();
        std::os::unix::fs::symlink(&b, a.join("folder").join("link-to-b")).unwrap();
        let report = run(
            Mode::Copy,
            &[&a.join("folder")],
            &b,
            HashMap::new(),
            &Mutex::new(vec![]),
        );
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        let copied = b.join("folder").join("link-to-b");
        assert!(fs::symlink_metadata(&copied).unwrap().is_symlink());
        assert_eq!(fs::read_link(copied).unwrap(), b);
    }
}
