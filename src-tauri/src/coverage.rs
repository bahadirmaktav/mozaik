//! Coverage reports for the IDE's Coverage view (see `docs/decisions/015-coverage.md`).
//! Mozaik runs no coverage tool: a build target or the user writes an LCOV or Cobertura
//! report, the user picks it in a native dialog, and this module remembers that path per
//! project in app data and reads it. The renderer never names the report file itself.

use crate::files::atomic_write;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::Manager;

/// Larger reports are refused instead of being read into the renderer.
const LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    path: String,
    text: String,
    /// Milliseconds since the Unix epoch.
    modified: Option<u64>,
}

fn modified(path: &Path) -> Option<u64> {
    let time = fs::metadata(path).ok()?.modified().ok()?;
    Some(time.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn read_report(path: &Path) -> Result<Report, String> {
    let size = fs::metadata(path)
        .map_err(|e| format!("The coverage report cannot be read: {e}"))?
        .len();
    if size > LIMIT {
        return Err(format!(
            "The coverage report is larger than {} MB",
            LIMIT / 1024 / 1024
        ));
    }
    let bytes = fs::read(path).map_err(|e| format!("The coverage report cannot be read: {e}"))?;
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    let text = String::from_utf8(bytes.to_vec())
        .map_err(|_| "The coverage report is not UTF-8 text".to_string())?;
    Ok(Report {
        path: crate::project::display(path),
        text,
        modified: modified(path),
    })
}

static STORE: Mutex<()> = Mutex::new(());
fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("coverage.json"))
}
/// The chosen report of each project, by project root.
fn read_store(path: &Path) -> Result<BTreeMap<String, PathBuf>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|_| {
        format!(
            "The coverage settings file is damaged and was left unchanged: {}",
            path.display()
        )
    })
}
fn update_store(path: &Path, root: &Path, report: Option<PathBuf>) -> Result<(), String> {
    let _guard = STORE.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = read_store(path)?;
    let key = crate::project::display(root);
    match report {
        Some(report) => all.insert(key, report),
        None => all.remove(&key),
    };
    fs::create_dir_all(path.parent().ok_or("Invalid app data directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        path,
        &serde_json::to_vec_pretty(&all).map_err(|e| e.to_string())?,
    )
}
fn stored(path: &Path, root: &Path) -> Result<Option<PathBuf>, String> {
    let _guard = STORE.lock().unwrap_or_else(|e| e.into_inner());
    Ok(read_store(path)?.remove(&crate::project::display(root)))
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// Asks for a report in a native dialog, reads it and remembers it for the project.
#[tauri::command]
pub async fn coverage_choose(
    app: tauri::AppHandle,
    root: String,
) -> Result<Option<Report>, String> {
    let root = crate::project::root(&root)?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("Open Coverage Report")
        .set_directory(crate::git::plain(&root))
        .add_filter(
            "Coverage reports (LCOV, Cobertura)",
            &["info", "lcov", "xml"],
        )
        .add_filter("All files", &["*"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = crate::git::plain(&file.path().canonicalize().map_err(|e| e.to_string())?);
    blocking(move || {
        let report = read_report(&path)?;
        update_store(&store_path(&app)?, &root, Some(path))?;
        Ok(Some(report))
    })
    .await
}
/// The project's chosen report, read again; `None` when none was chosen.
#[tauri::command]
pub async fn coverage_report(
    app: tauri::AppHandle,
    root: String,
) -> Result<Option<Report>, String> {
    blocking(move || {
        let root = crate::project::root(&root)?;
        match stored(&store_path(&app)?, &root)? {
            Some(path) => read_report(&path).map(Some),
            None => Ok(None),
        }
    })
    .await
}
/// Forgets the project's report; the file stays.
#[tauri::command]
pub async fn coverage_forget(app: tauri::AppHandle, root: String) -> Result<(), String> {
    blocking(move || {
        let root = crate::project::root(&root)?;
        update_store(&store_path(&app)?, &root, None)
    })
    .await
}
/// When the report's source files were last changed, to mark those newer than the report.
#[tauri::command]
pub async fn coverage_modified(paths: Vec<String>) -> Result<Vec<Option<u64>>, String> {
    if paths.len() > 20_000 {
        return Err("The report names too many files".into());
    }
    blocking(move || Ok(paths.iter().map(|p| modified(Path::new(p))).collect())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_utf8_reports_and_remembers_them_per_project() {
        let dir = tempfile::tempdir().unwrap();
        let report = dir.path().join("coverage.info");
        fs::write(&report, b"\xEF\xBB\xBFSF:a.cpp\nDA:1,2\nend_of_record\n").unwrap();
        let read = read_report(&report).unwrap();
        assert!(read.text.starts_with("SF:a.cpp"));
        assert!(read.modified.is_some());

        let binary = dir.path().join("coverage.bin");
        fs::write(&binary, [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_report(&binary).unwrap_err().contains("UTF-8"));
        assert!(read_report(&dir.path().join("missing.xml")).is_err());

        let store = dir.path().join("app/coverage.json");
        let root = dir.path().join("project");
        assert_eq!(stored(&store, &root).unwrap(), None);
        update_store(&store, &root, Some(report.clone())).unwrap();
        assert_eq!(stored(&store, &root).unwrap(), Some(report));
        update_store(&store, &root, None).unwrap();
        assert_eq!(stored(&store, &root).unwrap(), None);

        // A damaged file is reported and left as it is.
        fs::write(&store, "{").unwrap();
        assert!(
            update_store(&store, &root, None)
                .unwrap_err()
                .contains("damaged")
        );
        assert_eq!(fs::read_to_string(&store).unwrap(), "{");
    }
}
