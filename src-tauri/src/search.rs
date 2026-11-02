//! The File Manager's search box: names under the shown folder and its subfolders, as a file
//! explorer's search finds them. Names only (no file contents), links are not followed,
//! results stream in batches and a newer search of the same panel cancels the older one.
use crate::directory::{self, Entry};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::ipc::Channel;

/// The running search of each File Manager panel.
#[derive(Default)]
pub struct Searches(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Batch {
    pub entries: Vec<Entry>,
    /// The last batch: the walk ended, was cancelled or reached the limit.
    pub done: bool,
    /// More names matched than the limit.
    pub truncated: bool,
}

/// At most this many results; a broader query should be narrowed.
pub const LIMIT: usize = 5000;

/// Case-insensitive: `*` and `?` match the whole name as wildcards; other text is found
/// anywhere in the name.
pub fn matcher(query: &str) -> impl Fn(&str) -> bool + use<> {
    let query = query.trim().to_lowercase();
    let wildcard = query.contains(['*', '?']);
    let pattern: Vec<char> = query.chars().collect();
    move |name: &str| {
        let name = name.to_lowercase();
        if wildcard {
            let name: Vec<char> = name.chars().collect();
            glob(&pattern, &name)
        } else {
            name.contains(&query)
        }
    }
}
fn glob(pattern: &[char], name: &[char]) -> bool {
    // Iterative matching with backtracking to the last `*`.
    let (mut p, mut n) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while n < name.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == name[n]) {
            p += 1;
            n += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some((p, n));
            p += 1;
        } else if let Some((sp, sn)) = star {
            p = sp + 1;
            n = sn + 1;
            star = Some((sp, sn + 1));
        } else {
            return false;
        }
    }
    pattern[p..].iter().all(|&c| c == '*')
}

/// Walks `root`, sending matching entries; stops when `cancel` is set or the channel closes.
pub fn search(
    root: &Path,
    query: &str,
    show_hidden: bool,
    cancel: &AtomicBool,
    mut send: impl FnMut(Batch) -> bool,
) {
    let matches = matcher(query);
    let walk = ignore::WalkBuilder::new(root)
        .standard_filters(false)
        .hidden(!show_hidden)
        .follow_links(false)
        .build();
    let mut batch = Vec::new();
    let mut found = 0;
    let mut sent = Instant::now();
    let mut truncated = false;
    for item in walk {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let Ok(item) = item else { continue };
        if item.depth() == 0 {
            continue;
        }
        let name = item.file_name().to_string_lossy();
        if !matches(&name) {
            continue;
        }
        if found == LIMIT {
            truncated = true;
            break;
        }
        if let Ok(entry) = directory::entry(item.path()) {
            batch.push(entry);
            found += 1;
        }
        if batch.len() >= 200 || sent.elapsed() > Duration::from_millis(150) {
            let entries = std::mem::take(&mut batch);
            if !send(Batch {
                entries,
                done: false,
                truncated: false,
            }) {
                return;
            }
            sent = Instant::now();
        }
    }
    send(Batch {
        entries: batch,
        done: true,
        truncated,
    });
}

#[tauri::command]
pub async fn search_directory(
    searches: tauri::State<'_, Searches>,
    id: String,
    root: String,
    query: String,
    show_hidden: bool,
    results: Channel<Batch>,
) -> Result<(), String> {
    if query.trim().is_empty() || query.len() > 260 {
        return Err("Enter a name to search for".into());
    }
    let root = directory::resolve(&root)?;
    if !root.is_dir() {
        return Err(format!("{} is not a folder", directory::display(&root)));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut running = searches.0.lock().map_err(|e| e.to_string())?;
        if let Some(previous) = running.insert(id.clone(), cancel.clone()) {
            previous.store(true, Ordering::Relaxed);
        }
    }
    let flag = cancel.clone();
    directory::blocking(move || {
        search(&root, &query, show_hidden, &flag, |batch| {
            results.send(batch).is_ok()
        });
        Ok(())
    })
    .await?;
    if let Ok(mut running) = searches.0.lock()
        && running.get(&id).is_some_and(|c| Arc::ptr_eq(c, &cancel))
    {
        running.remove(&id);
    }
    Ok(())
}

/// Stops a panel's search (its box was cleared, it navigated or closed).
#[tauri::command]
pub fn cancel_search(searches: tauri::State<'_, Searches>, id: String) -> Result<(), String> {
    if let Some(cancel) = searches.0.lock().map_err(|e| e.to_string())?.remove(&id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn queries_match_parts_of_names_or_wildcards() {
        let m = matcher("Report");
        assert!(m("annual-report.txt"));
        assert!(!m("summary.txt"));
        let m = matcher("*.RS");
        assert!(m("main.rs"));
        assert!(!m("main.rs.bak"));
        let m = matcher("a?c*");
        assert!(m("abc"));
        assert!(m("ABCdef"));
        assert!(!m("ac"));
    }

    #[test]
    fn search_walks_subfolders_skips_hidden_and_stops_at_cancel() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("a/b")).unwrap();
        fs::write(dir.path().join("note.txt"), "").unwrap();
        fs::write(dir.path().join("a/b/notes.md"), "").unwrap();
        fs::write(dir.path().join("a/other.txt"), "").unwrap();
        fs::create_dir(dir.path().join(".hidden")).unwrap();
        fs::write(dir.path().join(".hidden/note.txt"), "").unwrap();
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            let path: Vec<u16> = dir
                .path()
                .join(".hidden")
                .as_os_str()
                .encode_wide()
                .chain([0])
                .collect();
            unsafe {
                windows_sys::Win32::Storage::FileSystem::SetFileAttributesW(
                    path.as_ptr(),
                    windows_sys::Win32::Storage::FileSystem::FILE_ATTRIBUTE_HIDDEN,
                );
            }
        }
        let run = |hidden: bool, cancel: bool| {
            let mut names = Vec::new();
            let mut last = None;
            search(
                dir.path(),
                "note",
                hidden,
                &AtomicBool::new(cancel),
                |batch| {
                    names.extend(batch.entries.into_iter().map(|e| e.name));
                    last = Some((batch.done, batch.truncated));
                    true
                },
            );
            names.sort();
            (names, last)
        };
        assert_eq!(
            run(false, false),
            (
                vec!["note.txt".to_string(), "notes.md".to_string()],
                Some((true, false))
            )
        );
        assert_eq!(run(true, false).0.len(), 3);
        assert_eq!(run(false, true), (vec![], Some((true, false))));
    }
}
