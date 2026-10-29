//! Directory listing, path handling and single-entry actions for the File Manager.
//! Kept free of view concepts so another panel (for example a future project tree) can reuse it.
use crate::files::atomic_write;
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Component, MAIN_SEPARATOR_STR, Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{Emitter, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    /// `symlink` covers Unix symlinks and Windows symlinks/junctions; it is never recursed into.
    pub kind: &'static str,
    pub target_kind: Option<&'static str>,
    pub hidden: bool,
    pub size: Option<u64>,
    /// Milliseconds since the Unix epoch.
    pub modified: Option<f64>,
    pub broken: bool,
    /// The OS name is not valid Unicode. It is displayed lossily and never operated on,
    /// because the lossy string would name a different (or no) file.
    pub unsupported: bool,
}
#[derive(Debug, Serialize)]
pub struct Crumb {
    pub name: String,
    pub path: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub directory: String,
    pub parent: Option<String>,
    pub crumbs: Vec<Crumb>,
    pub separator: &'static str,
    pub entries: Vec<Entry>,
    /// Entries that disappeared or could not be read while listing.
    pub unreadable: usize,
    /// Set when the requested folder is gone and an existing ancestor is shown instead.
    pub fallback_from: Option<String>,
}

pub fn home() -> Result<PathBuf, String> {
    std::env::home_dir()
        .filter(|p| p.is_absolute())
        .ok_or_else(|| "Could not determine the home directory".into())
}
/// Lexical normalization: removes `.` and `..` without resolving symlinks, so a path the
/// user chose through a link keeps its identity (like a shell's logical `cd`).
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => (),
            Component::ParentDir => {
                if matches!(out.components().next_back(), Some(Component::Normal(_))) {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}
/// Accepts absolute paths, `~`-prefixed home paths and bare Windows drive letters.
pub fn resolve(input: &str) -> Result<PathBuf, String> {
    if input.is_empty() || input.contains('\0') {
        return Err("Enter a folder path".into());
    }
    let path = if input == "~" {
        home()?
    } else if let Some(rest) = input
        .strip_prefix("~/")
        .or_else(|| input.strip_prefix(if cfg!(windows) { "~\\" } else { "~/" }))
    {
        home()?.join(rest)
    } else if cfg!(windows)
        && input.len() == 2
        && input.ends_with(':')
        && input.as_bytes()[0].is_ascii_alphabetic()
    {
        PathBuf::from(format!("{input}\\"))
    } else {
        PathBuf::from(input)
    };
    if !path.is_absolute() {
        return Err(format!("“{input}” is not a full path"));
    }
    Ok(normalize(&path))
}
pub fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
fn crumbs(path: &Path) -> Vec<Crumb> {
    let mut current = PathBuf::new();
    let mut result: Vec<Crumb> = Vec::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match component {
            // A Windows prefix and its root separator form one crumb ("C:").
            Component::RootDir if !result.is_empty() => {
                result.last_mut().unwrap().path = display(&current);
            }
            Component::Prefix(prefix) => result.push(Crumb {
                name: prefix.as_os_str().to_string_lossy().into_owned(),
                path: display(&current),
            }),
            _ => result.push(Crumb {
                name: if component == Component::RootDir {
                    MAIN_SEPARATOR_STR.into()
                } else {
                    component.as_os_str().to_string_lossy().into_owned()
                },
                path: display(&current),
            }),
        }
    }
    result
}
fn millis(metadata: &fs::Metadata) -> Option<f64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as f64)
}
#[cfg(windows)]
fn hidden(_name: &str, metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN != 0
}
#[cfg(not(windows))]
fn hidden(name: &str, _metadata: &fs::Metadata) -> bool {
    name.starts_with('.')
}
fn kind(file_type: fs::FileType) -> &'static str {
    if file_type.is_symlink() {
        "symlink"
    } else if file_type.is_dir() {
        "directory"
    } else if file_type.is_file() {
        "file"
    } else {
        "other"
    }
}
pub fn entry(path: &Path) -> io::Result<Entry> {
    let own = fs::symlink_metadata(path)?;
    let os_name = path.file_name().unwrap_or(path.as_os_str());
    let name = os_name.to_string_lossy().into_owned();
    let kind = kind(own.file_type());
    // Links show their target's size and date; a loop or missing target is "broken".
    let (target_kind, broken, shown) = if kind == "symlink" {
        match fs::metadata(path) {
            Ok(target) => (
                Some(if target.is_dir() { "directory" } else { "file" }),
                false,
                target,
            ),
            Err(_) => (Some("unknown"), true, own.clone()),
        }
    } else {
        (None, false, own.clone())
    };
    Ok(Entry {
        path: display(path),
        hidden: hidden(&name, &own),
        unsupported: os_name.to_str().is_none(),
        name,
        kind,
        target_kind,
        size: (shown.is_file() && !broken).then_some(shown.len()),
        modified: millis(&shown),
        broken,
    })
}
fn read_error(path: &Path, error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => format!("{} does not exist", display(path)),
        io::ErrorKind::PermissionDenied => {
            format!("You do not have permission to open {}", display(path))
        }
        io::ErrorKind::NotADirectory => format!("{} is not a folder", display(path)),
        _ => format!("Cannot open {}: {error}", display(path)),
    }
}
pub fn list(directory: &Path) -> Result<Listing, String> {
    let metadata = fs::metadata(directory).map_err(|e| read_error(directory, e))?;
    if !metadata.is_dir() {
        return Err(format!("{} is not a folder", display(directory)));
    }
    let mut entries = Vec::new();
    let mut unreadable = 0;
    for item in fs::read_dir(directory).map_err(|e| read_error(directory, e))? {
        match item.and_then(|item| entry(&item.path())) {
            Ok(entry) => entries.push(entry),
            Err(_) => unreadable += 1,
        }
    }
    Ok(Listing {
        directory: display(directory),
        parent: directory.parent().map(display),
        crumbs: crumbs(directory),
        separator: MAIN_SEPARATOR_STR,
        entries,
        unreadable,
        fallback_from: None,
    })
}
/// The closest existing folder at or above `path`, or home when the whole chain is gone.
fn nearest(path: &Path) -> Result<PathBuf, String> {
    let mut candidate = Some(path);
    while let Some(dir) = candidate {
        if dir.is_dir() {
            return Ok(dir.to_path_buf());
        }
        candidate = dir.parent();
    }
    home()
}
pub async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// Reads one directory without recursion. `None` is the home directory. With `fallback`,
/// a folder that no longer exists is replaced by its closest existing ancestor.
#[tauri::command]
pub async fn read_directory(path: Option<String>, fallback: bool) -> Result<Listing, String> {
    blocking(move || {
        let requested = match path {
            Some(path) => resolve(&path)?,
            None => home()?,
        };
        if fallback && !requested.is_dir() {
            let shown = nearest(&requested)?;
            let mut listing = list(&shown)?;
            listing.fallback_from = Some(display(&requested));
            return Ok(listing);
        }
        list(&requested)
    })
    .await
}

/// Validates a single new file or folder name for the current platform.
pub fn valid_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name == "." || name == ".." {
        return Err("Enter a name".into());
    }
    if name.len() > 255 {
        return Err("The name is too long".into());
    }
    let forbidden: &[char] = if cfg!(windows) {
        &['/', '\\', '<', '>', ':', '"', '|', '?', '*']
    } else {
        &['/']
    };
    if name.chars().any(|c| c == '\0' || c.is_control()) || name.contains(forbidden) {
        return Err(if cfg!(windows) {
            "Names cannot contain control characters or any of \\ / : * ? \" < > |".into()
        } else {
            "Names cannot contain / or control characters".into()
        });
    }
    if cfg!(windows) {
        if name.ends_with(['.', ' ']) {
            return Err("Names cannot end with a dot or a space on Windows".into());
        }
        let stem = name.split('.').next().unwrap_or_default().trim_end();
        let upper = stem.to_ascii_uppercase();
        let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&upper.as_str())
            || ((upper.starts_with("COM") || upper.starts_with("LPT"))
                && upper.len() == 4
                && upper.as_bytes()[3].is_ascii_digit()
                && upper.as_bytes()[3] != b'0');
        if reserved {
            return Err(format!("“{stem}” is a reserved name on Windows"));
        }
    }
    Ok(())
}

/// Paths whose removal would damage the system or the user's account.
pub fn protected(path: &Path) -> Option<String> {
    if path.parent().is_none() {
        return Some(format!("{} is a drive or filesystem root", display(path)));
    }
    if let Ok(home) = home()
        && same_path(&home, path)
    {
        return Some("This is your home folder".into());
    }
    if let Ok(home) = home()
        && starts_with(&home, path)
    {
        return Some(format!("{} contains your home folder", display(path)));
    }
    let system: Vec<PathBuf> = if cfg!(windows) {
        [
            "SystemRoot",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramData",
        ]
        .iter()
        .filter_map(|key| std::env::var_os(key).map(PathBuf::from))
        .collect()
    } else {
        [
            "/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/opt", "/proc", "/root", "/run",
            "/sbin", "/srv", "/sys", "/usr", "/var",
        ]
        .iter()
        .map(PathBuf::from)
        .collect()
    };
    system
        .iter()
        .any(|dir| same_path(dir, path))
        .then(|| format!("{} is a system folder", display(path)))
}
/// Path identity without resolving links. Windows file systems are case-insensitive by default.
pub fn same_path(a: &Path, b: &Path) -> bool {
    identity(a) == identity(b)
}
pub fn identity(path: &Path) -> String {
    let text = display(&normalize(path));
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}
pub fn starts_with(path: &Path, base: &Path) -> bool {
    let (path, base) = (normalize(path), normalize(base));
    let mut a = path.components();
    base.components().all(|b| {
        a.next()
            .is_some_and(|c| identity(c.as_ref()) == identity(b.as_ref()))
    })
}

/// Renames without ever replacing an existing destination.
#[cfg(windows)]
pub fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;
    // Flags 0: fail if `to` exists, and fail across volumes instead of copying implicitly.
    let ok = unsafe { MoveFileExW(wide(from).as_ptr(), wide(to).as_ptr(), 0) };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}
/// Extended-length form so long paths work like they do through `std::fs`.
#[cfg(windows)]
pub fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    let raw = path.as_os_str();
    let text = raw.to_string_lossy();
    let mut result: Vec<u16> = if text.starts_with(r"\\?\") {
        Vec::new()
    } else if let Some(unc) = text.strip_prefix(r"\\") {
        let mut prefix: Vec<u16> = r"\\?\UNC\".encode_utf16().collect();
        prefix.extend(std::ffi::OsStr::new(unc).encode_wide());
        prefix.push(0);
        return prefix;
    } else {
        r"\\?\".encode_utf16().collect()
    };
    result.extend(raw.encode_wide());
    result.push(0);
    result
}
#[cfg(target_os = "linux")]
pub fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let a = CString::new(from.as_os_str().as_bytes())?;
    let b = CString::new(to.as_os_str().as_bytes())?;
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            a.as_ptr(),
            libc::AT_FDCWD,
            b.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if !matches!(error.raw_os_error(), Some(libc::EINVAL | libc::ENOSYS)) {
        return Err(error);
    }
    // File systems without RENAME_NOREPLACE: check, then rename (a narrow race remains).
    checked_rename(from, to)
}
#[cfg(all(unix, not(target_os = "linux")))]
pub fn rename_no_replace(from: &Path, to: &Path) -> io::Result<()> {
    checked_rename(from, to)
}
#[cfg(unix)]
fn checked_rename(from: &Path, to: &Path) -> io::Result<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    fs::rename(from, to)
}

#[tauri::command]
pub async fn create_entry(parent: String, name: String, directory: bool) -> Result<Entry, String> {
    blocking(move || {
        valid_name(&name)?;
        let parent = resolve(&parent)?;
        let path = parent.join(&name);
        let created = if directory {
            fs::create_dir(&path)
        } else {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .map(|_| ())
        };
        created.map_err(|e| match e.kind() {
            io::ErrorKind::AlreadyExists => format!("An item named “{name}” already exists"),
            io::ErrorKind::PermissionDenied => {
                format!(
                    "You do not have permission to create items in {}",
                    display(&parent)
                )
            }
            _ => format!("Could not create “{name}”: {e}"),
        })?;
        entry(&path).map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn rename_entry(path: String, name: String) -> Result<Entry, String> {
    blocking(move || {
        valid_name(&name)?;
        let path = resolve(&path)?;
        if let Some(reason) = protected(&path) {
            return Err(format!("{reason}; it cannot be renamed"));
        }
        let parent = path.parent().ok_or("This item cannot be renamed")?;
        let target = parent.join(&name);
        if target == path {
            return entry(&path).map_err(|e| e.to_string());
        }
        // A case-only change on Windows names the same file, so the no-replace check
        // would always fail; `fs::rename` performs it in place.
        let result = if same_path(&target, &path) {
            fs::rename(&path, &target)
        } else {
            rename_no_replace(&path, &target)
        };
        result.map_err(|e| match e.kind() {
            io::ErrorKind::AlreadyExists => format!("An item named “{name}” already exists"),
            io::ErrorKind::NotFound => format!("{} no longer exists", display(&path)),
            io::ErrorKind::PermissionDenied => "You do not have permission to rename it".into(),
            _ => format!("Could not rename: {e}"),
        })?;
        entry(&target).map_err(|e| e.to_string())
    })
    .await
}

// Opening these through the shell would run a program. Tessera only executes programs in an
// interactive Terminal session; the File Manager does not launch them.
const PROGRAM_TYPES: &[&str] = &[
    "exe",
    "com",
    "bat",
    "cmd",
    "ps1",
    "psm1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "msi",
    "msp",
    "scr",
    "pif",
    "cpl",
    "hta",
    "lnk",
    "url",
    "reg",
    "jar",
    "appref-ms",
    "application",
    "desktop",
    "sh",
    "bash",
    "zsh",
    "fish",
    "run",
    "appimage",
];
pub fn launchable(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if PROGRAM_TYPES.contains(&extension.as_str()) {
        return Err(
            "Tessera does not run programs or scripts from the File Manager. Use a Terminal to run it."
                .into(),
        );
    }
    Ok(())
}
/// Opens a file with the OS default application. Arguments are passed directly
/// (ShellExecuteExW on Windows, xdg-open/gio argument vectors on Linux), never through a shell.
#[tauri::command]
pub async fn open_entry(path: String) -> Result<(), String> {
    blocking(move || {
        let path = resolve(&path)?;
        let metadata = fs::metadata(&path).map_err(|e| read_error(&path, e))?;
        if !metadata.is_file() {
            return Err("Only files can be opened with another application".into());
        }
        launchable(&path)?;
        open::that_detached(&path).map_err(|e| format!("No application could open it: {e}"))
    })
    .await
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub show_hidden: bool,
}
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("file-manager.json"))
}
#[tauri::command]
pub fn file_manager_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "The stored File Manager settings are damaged".into())
}
#[tauri::command]
pub fn set_show_hidden(app: tauri::AppHandle, show: bool) -> Result<(), String> {
    let path = settings_path(&app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    let settings = Settings { show_hidden: show };
    atomic_write(
        &path,
        &serde_json::to_vec(&settings).map_err(|e| e.to_string())?,
    )?;
    let _ = app.emit("file-manager-settings", settings);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_normalize_lexically_and_require_absolute_input() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        assert_eq!(
            resolve(&display(&base.join("a").join("..").join(".").join("b"))).unwrap(),
            base.join("b")
        );
        assert!(resolve("relative").is_err());
        assert!(resolve("").is_err());
        assert_eq!(resolve("~").unwrap(), home().unwrap());
        #[cfg(windows)]
        assert_eq!(resolve("c:").unwrap(), PathBuf::from("c:\\"));
    }
    #[test]
    fn listing_marks_hidden_entries_and_never_sizes_directories() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("folder")).unwrap();
        fs::write(dir.path().join("folder").join("inner.txt"), b"12345").unwrap();
        fs::write(dir.path().join("note.txt"), b"abc").unwrap();
        fs::write(dir.path().join(".dotfile"), b"").unwrap();
        #[cfg(windows)]
        {
            use windows_sys::Win32::Storage::FileSystem::{
                FILE_ATTRIBUTE_HIDDEN, SetFileAttributesW,
            };
            let path = dir.path().join("secret.txt");
            fs::write(&path, b"").unwrap();
            assert_ne!(
                unsafe { SetFileAttributesW(wide(&path).as_ptr(), FILE_ATTRIBUTE_HIDDEN) },
                0
            );
        }
        let listing = list(dir.path()).unwrap();
        let find = |name: &str| listing.entries.iter().find(|e| e.name == name).unwrap();
        assert_eq!(find("folder").kind, "directory");
        assert_eq!(find("folder").size, None);
        assert_eq!(find("note.txt").size, Some(3));
        assert!(find("note.txt").modified.is_some());
        assert!(!find("note.txt").hidden);
        assert_eq!(find(".dotfile").hidden, cfg!(unix));
        #[cfg(windows)]
        assert!(find("secret.txt").hidden);
        assert_eq!(listing.entries.len(), if cfg!(windows) { 4 } else { 3 });
        assert_eq!(
            listing.crumbs.last().unwrap().path,
            display(dir.path()),
            "the last crumb is the listed folder"
        );
    }
    #[cfg(unix)]
    #[test]
    fn links_are_marked_and_loops_or_missing_targets_are_broken() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("real")).unwrap();
        symlink(dir.path().join("real"), dir.path().join("to-real")).unwrap();
        symlink(dir.path().join("missing"), dir.path().join("dangling")).unwrap();
        symlink(dir.path().join("loop-b"), dir.path().join("loop-a")).unwrap();
        symlink(dir.path().join("loop-a"), dir.path().join("loop-b")).unwrap();
        let listing = list(dir.path()).unwrap();
        let find = |name: &str| listing.entries.iter().find(|e| e.name == name).unwrap();
        assert_eq!(find("to-real").kind, "symlink");
        assert_eq!(find("to-real").target_kind, Some("directory"));
        assert!(!find("to-real").broken);
        assert!(find("dangling").broken);
        assert!(find("loop-a").broken);
        assert!(list(&dir.path().join("loop-a")).is_err());
    }
    #[cfg(target_os = "linux")]
    #[test]
    fn names_outside_unicode_are_listed_but_flagged() {
        use std::{ffi::OsStr, os::unix::ffi::OsStrExt};
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(OsStr::from_bytes(b"bad\xffname")), b"").unwrap();
        let listing = list(dir.path()).unwrap();
        assert!(listing.entries[0].unsupported);
    }
    #[test]
    fn fallback_shows_the_nearest_existing_ancestor() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone").join("deeper");
        assert!(list(&gone).is_err());
        assert_eq!(nearest(&gone).unwrap(), dir.path());
    }
    #[test]
    fn invalid_and_reserved_names_are_rejected() {
        for name in ["", " ", ".", "..", "a/b", "a\0b"] {
            assert!(valid_name(name).is_err(), "{name:?}");
        }
        assert!(valid_name("report (2).txt").is_ok());
        #[cfg(windows)]
        for name in ["CON", "nul.txt", "COM1", "a:b", "trailing.", "x?"] {
            assert!(valid_name(name).is_err(), "{name:?}");
        }
    }
    #[test]
    fn roots_home_and_its_ancestors_are_protected() {
        let home = home().unwrap();
        assert!(protected(&home).is_some());
        assert!(protected(home.parent().unwrap()).is_some());
        let root: PathBuf = home.components().take(2).collect();
        assert!(protected(&root).is_some());
        let dir = tempfile::tempdir().unwrap();
        assert!(protected(&dir.path().join("x")).is_none());
    }
    #[test]
    fn rename_never_replaces_and_programs_are_not_launched() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a.txt"), dir.path().join("b.txt"));
        fs::write(&a, b"a").unwrap();
        fs::write(&b, b"b").unwrap();
        let error = rename_no_replace(&a, &b).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&b).unwrap(), b"b");
        rename_no_replace(&a, &dir.path().join("c.txt")).unwrap();
        assert!(launchable(Path::new("setup.EXE")).is_err());
        assert!(launchable(Path::new("start.desktop")).is_err());
        assert!(launchable(Path::new("photo.png")).is_ok());
    }
}
