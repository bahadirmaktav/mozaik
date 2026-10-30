//! The application was called Tessera before; its data lived under `dev.tessera.desktop`.
//! At the first start under the new identifier the old folders are copied, never moved, so
//! settings, tasks, notes, pins and recovery snapshots stay and the old folders remain intact.

use std::fs;
use std::io;
use std::path::Path;

const PREVIOUS: &str = "dev.tessera.desktop";

/// Copies the previous identifier's sibling of `dir` into `dir` if `dir` does not exist yet.
/// The copy is staged next to it and renamed into place, so an interrupted copy is retried.
pub fn adopt_previous(dir: &Path) -> io::Result<()> {
    let Some(parent) = dir.parent() else {
        return Ok(());
    };
    let previous = parent.join(PREVIOUS);
    if dir.exists() || !previous.is_dir() {
        return Ok(());
    }
    let staging = parent.join(format!(".mozaik-adopt-{}", uuid::Uuid::new_v4()));
    let result = copy_tree(&previous, &staging).and_then(|()| fs::rename(&staging, dir));
    if result.is_err() || staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    // Another process may have adopted the folder first.
    if dir.is_dir() { Ok(()) } else { result }
}

fn copy_tree(source: &Path, target: &Path) -> io::Result<()> {
    fs::create_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let to = target.join(entry.file_name());
        if kind.is_dir() {
            copy_tree(&entry.path(), &to)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), &to)?;
        }
        // Links are not followed: the app writes none there.
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copies_the_previous_folder_once_and_keeps_it() {
        let root = tempfile::tempdir().unwrap();
        let previous = root.path().join(PREVIOUS);
        fs::create_dir_all(previous.join("recovery")).unwrap();
        fs::write(previous.join("tasks.json"), "{}").unwrap();
        fs::write(previous.join("recovery/a.json"), "a").unwrap();
        let current = root.path().join("dev.mozaik.desktop");

        adopt_previous(&current).unwrap();
        assert_eq!(
            fs::read_to_string(current.join("tasks.json")).unwrap(),
            "{}"
        );
        assert_eq!(
            fs::read_to_string(current.join("recovery/a.json")).unwrap(),
            "a"
        );
        assert!(previous.join("tasks.json").exists());

        // Once the new folder exists it is never replaced.
        fs::write(current.join("tasks.json"), "new").unwrap();
        adopt_previous(&current).unwrap();
        assert_eq!(
            fs::read_to_string(current.join("tasks.json")).unwrap(),
            "new"
        );
        let leftovers = fs::read_dir(root.path()).unwrap().count();
        assert_eq!(leftovers, 2);
    }

    #[test]
    fn does_nothing_without_a_previous_folder() {
        let root = tempfile::tempdir().unwrap();
        let current = root.path().join("dev.mozaik.desktop");
        adopt_previous(&current).unwrap();
        assert!(!current.exists());
    }
}
