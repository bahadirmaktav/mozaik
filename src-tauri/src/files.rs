use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

// Allocation safety limit, not a performance promise. Lower-cost editor mode is separate.
const MAX_BYTES: u64 = 64 * 1024 * 1024;
#[derive(Debug, Clone, Serialize)]
pub struct FileData {
    pub path: String,
    pub name: String,
    pub text: String,
    pub revision: String,
    pub bom: bool,
    pub ending: String,
}
#[derive(Deserialize)]
pub struct SaveRequest {
    pub path: Option<String>,
    pub text: String,
    pub revision: Option<String>,
    pub bom: bool,
    pub ending: String,
    pub name: String,
    #[serde(default, rename = "excludedPaths")]
    pub excluded_paths: Vec<String>,
}
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub const CHANGED_ON_DISK: &str = "The file changed or disappeared on disk. Reload it or use Save As; your edits are still in memory.";
pub fn bytes(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("Cannot open file: {e}"))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Only regular files can be opened".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("File exceeds the 64 MiB allocation safety limit".into());
    }
    Ok(bytes)
}
pub fn decode(path: &Path, bytes: &[u8]) -> Result<FileData, String> {
    let bom = bytes.starts_with(&[0xef, 0xbb, 0xbf]);
    let text = std::str::from_utf8(if bom { &bytes[3..] } else { bytes })
        .map_err(|_| "Unsupported encoding: only UTF-8 text is accepted")?;
    if text
        .chars()
        .any(|c| c == '\0' || (c.is_control() && !matches!(c, '\n' | '\r' | '\t' | '\u{c}')))
    {
        return Err("This appears to be a binary file; it was not opened as text".into());
    }
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count();
    if text.replace("\r\n", "").contains('\r') || (crlf > 0 && crlf != lf) {
        return Err(
            "Mixed or CR-only line endings are not supported yet. The file has not been changed."
                .into(),
        );
    }
    Ok(FileData {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        text: text.replace("\r\n", "\n"),
        revision: digest(bytes),
        bom,
        ending: if crlf > 0 { "crlf" } else { "lf" }.into(),
    })
}
pub fn read(path: &Path) -> Result<FileData, String> {
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("File is missing or inaccessible: {e}"))?;
    decode(&canonical, &bytes(&canonical)?)
}
pub fn encode(text: &str, bom: bool, ending: &str) -> Result<Vec<u8>, String> {
    if text.len() as u64 > MAX_BYTES {
        return Err("Document exceeds the 64 MiB safety limit".into());
    }
    let content = match ending {
        "lf" => text.to_owned(),
        "crlf" => text.replace('\n', "\r\n"),
        _ => return Err("Unsupported line ending mode".into()),
    };
    let mut output = Vec::with_capacity(content.len() + 3);
    if bom {
        output.extend_from_slice(&[0xef, 0xbb, 0xbf]);
    }
    output.extend_from_slice(content.as_bytes());
    Ok(output)
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("File must have a parent directory")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Cannot create save file: {e}"))?;
    if let Ok(metadata) = fs::metadata(path) {
        if metadata.permissions().readonly() {
            return Err("File is read-only; use Save As".into());
        }
        temp.as_file()
            .set_permissions(metadata.permissions())
            .map_err(|e| e.to_string())?;
    }
    temp.write_all(bytes)
        .map_err(|e| format!("Write failed; original file is intact: {e}"))?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(path)
        .map_err(|e| format!("Replace failed; original file is intact: {}", e.error))?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|e| format!("Saved, but directory synchronization failed: {e}"))?;
    Ok(())
}
pub fn save(
    path: &Path,
    request: &SaveRequest,
    expected: Option<&str>,
) -> Result<FileData, String> {
    // Serialize Tessera writers across windows and processes. Non-cooperating external
    // writers are detected by content hash immediately before replacement.
    let parent = path.parent().ok_or("Invalid path")?;
    let lock_path = parent.join(format!(
        ".tessera-{}.lock",
        digest(path.to_string_lossy().as_bytes())
    ));
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|e| e.to_string())?;
    fs2::FileExt::lock_exclusive(&lock).map_err(|e| e.to_string())?;
    match (expected, path.exists()) {
        (Some(revision), true) if digest(&bytes(path)?) == revision => (),
        (None, false) => (),
        _ => return Err(CHANGED_ON_DISK.into()),
    }
    let output = encode(&request.text, request.bom, &request.ending)?;
    decode(path, &output)?;
    atomic_write(path, &output)?;
    // Return the exact revision we wrote, even if another process changes the file
    // immediately afterwards. A reread here could bless unseen external content.
    decode(&path.canonicalize().map_err(|e| e.to_string())?, &output)
}
/// The canonical form of a path picked in a save dialog, which may not exist yet.
pub fn chosen(selected: &Path) -> Result<PathBuf, String> {
    Ok(if selected.exists() {
        selected.canonicalize().map_err(|e| e.to_string())?
    } else {
        selected
            .parent()
            .ok_or("File has no parent")?
            .canonicalize()
            .map_err(|e| e.to_string())?
            .join(selected.file_name().ok_or("File has no name")?)
    })
}
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_file(path: String) -> Result<FileData, String> {
    blocking(move || read(Path::new(&path))).await
}
#[tauri::command]
pub async fn open_file(path: Option<String>) -> Result<Option<FileData>, String> {
    let path = match path {
        Some(path) => PathBuf::from(path),
        None => match rfd::AsyncFileDialog::new()
            .set_title("Open text file")
            .pick_file()
            .await
        {
            Some(file) => file.path().to_path_buf(),
            None => return Ok(None),
        },
    };
    blocking(move || read(&path).map(Some)).await
}
#[tauri::command]
pub async fn check_file(
    path: String,
    revision: Option<String>,
) -> Result<Option<FileData>, String> {
    blocking(move || {
        let file = read(Path::new(&path))?;
        Ok(if Some(&file.revision) == revision.as_ref() {
            None
        } else {
            Some(file)
        })
    })
    .await
}
#[tauri::command]
pub async fn save_file(request: SaveRequest) -> Result<Option<FileData>, String> {
    let (path, expected) = if let Some(path) = &request.path {
        (PathBuf::from(path), request.revision.clone())
    } else {
        let selected = rfd::AsyncFileDialog::new()
            .set_title("Save text file")
            .set_file_name(&request.name)
            .save_file()
            .await;
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = chosen(selected.path())?;
        if request
            .excluded_paths
            .iter()
            .any(|other| Path::new(other).canonicalize().ok().as_ref() == Some(&path))
        {
            return Err("That file is already open in another tab. Choose a different name or close that tab first.".into());
        }
        // Dialog explicitly confirmed replacement; bind that decision to this disk version.
        let expected = if path.exists() {
            Some(digest(&bytes(&path)?))
        } else {
            None
        };
        (path, expected)
    };
    blocking(move || save(&path, &request, expected.as_deref()).map(Some)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoding_round_trip() {
        for raw in [
            b"hello\nworld\n".as_slice(),
            b"\xef\xbb\xbfhello\r\nworld\r\n",
            "Türkçe 🌱\n".as_bytes(),
        ] {
            let doc = decode(Path::new("test.txt"), raw).unwrap();
            assert_eq!(encode(&doc.text, doc.bom, &doc.ending).unwrap(), raw);
        }
    }
    #[test]
    fn rejects_binary_invalid_utf8_and_mixed_endings() {
        for raw in [b"a\0b".as_slice(), &[0xff, 0xfe], b"a\r\nb\n", b"a\rb"] {
            assert!(decode(Path::new("x"), raw).is_err());
        }
    }
    #[test]
    fn stale_save_never_overwrites_external_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        fs::write(&path, b"original").unwrap();
        let doc = read(&path).unwrap();
        let request = SaveRequest {
            path: Some(doc.path),
            text: "local".into(),
            revision: Some(doc.revision.clone()),
            bom: false,
            ending: "lf".into(),
            name: "note.txt".into(),
            excluded_paths: vec![],
        };
        fs::write(&path, b"external").unwrap();
        assert!(save(&path, &request, Some(&doc.revision)).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"external");
    }
    #[test]
    fn safe_save_and_deleted_file_conflict() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.txt");
        let mut request = SaveRequest {
            path: None,
            text: "first\n".into(),
            revision: None,
            bom: true,
            ending: "crlf".into(),
            name: "note.txt".into(),
            excluded_paths: vec![],
        };
        let doc = save(&path, &request, None).unwrap();
        request.text = "second\n".into();
        assert!(save(&path, &request, Some(&doc.revision)).is_ok());
        fs::remove_file(&path).unwrap();
        assert!(save(&path, &request, Some(&doc.revision)).is_err());
        assert!(!path.exists());
    }
}
