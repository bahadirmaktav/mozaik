//! Windows shortcuts (`.lnk`), read for the File Manager: what one points at, never run. The
//! Shell Link format is read directly, so opening a shortcut starts nothing and asks no shell
//! ([MS-SHLLINK]: the header, an optional ID list, the LinkInfo paths and the string data).
use crate::directory::{blocking, display, launchable, normalize};
use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf, Prefix},
};

const HEADER: usize = 76;
const CLSID: [u8; 16] = [
    0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46,
];
// LinkFlags
const HAS_ID_LIST: u32 = 0x01;
const HAS_LINK_INFO: u32 = 0x02;
const HAS_NAME: u32 = 0x04;
const HAS_RELATIVE_PATH: u32 = 0x08;
const IS_UNICODE: u32 = 0x80;
/// A shortcut is a small file; anything larger is not one.
const MAX_SIZE: u64 = 4 * 1024 * 1024;

fn u16_at(data: &[u8], at: usize) -> Option<usize> {
    let bytes = data.get(at..at.checked_add(2)?)?;
    Some(u16::from_le_bytes(bytes.try_into().ok()?) as usize)
}
fn u32_at(data: &[u8], at: usize) -> Option<usize> {
    let bytes = data.get(at..at.checked_add(4)?)?;
    Some(u32::from_le_bytes(bytes.try_into().ok()?) as usize)
}
/// A NUL-terminated string in the file's ANSI code page; only ASCII is certain to be right,
/// and the Unicode form is preferred where the file has one.
fn ansi(data: &[u8], at: usize) -> Option<String> {
    let rest = data.get(at..)?;
    let end = rest.iter().position(|&b| b == 0)?;
    Some(String::from_utf8_lossy(&rest[..end]).into_owned())
}
fn wide(data: &[u8], at: usize) -> Option<String> {
    let rest = data.get(at..)?;
    let units: Vec<u16> = rest
        .as_chunks::<2>()
        .0
        .iter()
        .map(|&pair| u16::from_le_bytes(pair))
        .take_while(|&u| u != 0)
        .collect();
    String::from_utf16(&units).ok()
}
/// The local target path from the LinkInfo structure at `info`: `true` with it when it is
/// certainly right (Unicode or ASCII; other ANSI text depends on the code page that wrote it).
fn link_info_path(data: &[u8], info: usize) -> Option<(String, bool)> {
    let flags = u32_at(data, info.checked_add(8)?)?;
    // VolumeIDAndLocalBasePath: network shares have no local path here.
    if flags & 1 == 0 {
        return None;
    }
    let header = u32_at(data, info.checked_add(4)?)?;
    let suffix_offset = u32_at(data, info.checked_add(24)?)?;
    let (base, suffix, certain) = if header >= 0x24 {
        let base = u32_at(data, info.checked_add(28)?)?;
        let suffix = u32_at(data, info.checked_add(32)?)?;
        (
            wide(data, info.checked_add(base)?)?,
            wide(data, info.checked_add(suffix)?).unwrap_or_default(),
            true,
        )
    } else {
        let base = u32_at(data, info.checked_add(16)?)?;
        let base = ansi(data, info.checked_add(base)?)?;
        let suffix = ansi(data, info.checked_add(suffix_offset)?).unwrap_or_default();
        let certain = base.is_ascii() && suffix.is_ascii();
        (base, suffix, certain)
    };
    let path = if suffix.is_empty() || base.ends_with('\\') {
        format!("{base}{suffix}")
    } else {
        format!("{base}\\{suffix}")
    };
    Some((path, certain))
}
/// A counted string of the StringData section; returns it and the offset after it.
fn counted(data: &[u8], at: usize, unicode: bool) -> Option<(String, usize)> {
    let count = u16_at(data, at)?;
    let start = at.checked_add(2)?;
    if unicode {
        let end = start.checked_add(count.checked_mul(2)?)?;
        let units: Vec<u16> = data
            .get(start..end)?
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&pair| u16::from_le_bytes(pair))
            .collect();
        Some((String::from_utf16(&units).ok()?, end))
    } else {
        let end = start.checked_add(count)?;
        Some((
            String::from_utf8_lossy(data.get(start..end)?).into_owned(),
            end,
        ))
    }
}
/// What a Shell Link names, best first: its absolute local path and its path relative to the
/// shortcut. `None` when the file is not a shortcut; empty when it names nothing on disk (a
/// shell folder or item).
pub fn parse(data: &[u8]) -> Option<Vec<String>> {
    if data.get(..4)? != [0x4C, 0, 0, 0] || data.get(4..20)? != CLSID {
        return None;
    }
    let flags = u32_at(data, 20)? as u32;
    let mut at = HEADER;
    if flags & HAS_ID_LIST != 0 {
        at = at.checked_add(2)?.checked_add(u16_at(data, at)?)?;
    }
    let mut local = None;
    if flags & HAS_LINK_INFO != 0 {
        local = link_info_path(data, at).filter(|(path, _)| !path.is_empty());
        at = at.checked_add(u32_at(data, at)?)?;
    }
    let unicode = flags & IS_UNICODE != 0;
    if flags & HAS_NAME != 0 {
        at = counted(data, at, unicode)?.1;
    }
    let relative = if flags & HAS_RELATIVE_PATH != 0 {
        Some(counted(data, at, unicode)?.0)
    } else {
        None
    };
    let mut found = Vec::new();
    if let Some((path, true)) = &local {
        found.push(path.clone());
    }
    found.extend(relative);
    if let Some((path, false)) = local {
        found.push(path);
    }
    Some(found)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Target {
    /// A folder: the File Manager goes there.
    Folder { path: String },
    /// A file Mozaik may open: as a tab, or with its default application.
    File { path: String },
    /// A program or script: Mozaik does not run those from the File Manager.
    Program { path: String },
}
fn prefix(path: &Path) -> Option<Prefix<'_>> {
    match path.components().next() {
        Some(Component::Prefix(prefix)) => Some(prefix.kind()),
        _ => None,
    }
}
/// A shortcut's target is whatever its author wrote. Merely asking Windows about `\\host\x`
/// connects to that host and offers it the user's credentials, so a target leaves this computer
/// (or the share the shortcut itself is on) only by the user going there, never by a shortcut.
fn stays_local(link: &Path, target: &Path) -> bool {
    match prefix(target) {
        None | Some(Prefix::Disk(_)) => true,
        other => other == prefix(link),
    }
}
pub fn resolve(link: &Path) -> Result<Target, String> {
    let metadata = fs::metadata(link).map_err(|e| format!("{}: {e}", display(link)))?;
    if metadata.len() > MAX_SIZE {
        return Err(format!("{} is not a shortcut", display(link)));
    }
    let data = fs::read(link).map_err(|e| format!("{}: {e}", display(link)))?;
    let named = parse(&data).unwrap_or_default();
    let targets: Vec<PathBuf> = named
        .iter()
        .map(|named| {
            let named = PathBuf::from(named);
            if named.is_absolute() {
                normalize(&named)
            } else {
                normalize(&link.parent().unwrap_or(link).join(named))
            }
        })
        .collect();
    let targets: Vec<PathBuf> = targets
        .into_iter()
        .filter(|target| stays_local(link, target))
        .collect();
    let Some(first) = targets.first() else {
        return Err(format!(
            "{} does not point to a file or folder on this computer",
            display(link)
        ));
    };
    let Some((target, shown)) = targets
        .iter()
        .find_map(|t| fs::metadata(t).ok().map(|m| (t, m)))
    else {
        return Err(format!(
            "The shortcut's target {} is missing",
            display(first)
        ));
    };
    let path = display(target);
    if shown.is_dir() {
        Ok(Target::Folder { path })
    } else if launchable(target).is_err() {
        Ok(Target::Program { path })
    } else {
        Ok(Target::File { path })
    }
}
/// What a shortcut the user opened in the File Manager points at. Nothing is started here.
#[tauri::command]
pub async fn shortcut_target(path: String) -> Result<Target, String> {
    blocking(move || resolve(&crate::directory::resolve(&path)?)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(flags: u32) -> Vec<u8> {
        let mut data = vec![0u8; HEADER];
        data[0] = 0x4C;
        data[4..20].copy_from_slice(&CLSID);
        data[20..24].copy_from_slice(&flags.to_le_bytes());
        data
    }
    fn counted_wide(text: &str) -> Vec<u8> {
        let units: Vec<u16> = text.encode_utf16().collect();
        let mut out = (units.len() as u16).to_le_bytes().to_vec();
        out.extend(units.iter().flat_map(|u| u.to_le_bytes()));
        out
    }
    /// LinkInfo with an ANSI local path and suffix.
    fn link_info(base: &str, suffix: &str) -> Vec<u8> {
        let base_at = 28usize;
        let suffix_at = base_at + base.len() + 1;
        let size = suffix_at + suffix.len() + 1;
        let mut out = vec![0u8; 28];
        out[0..4].copy_from_slice(&(size as u32).to_le_bytes());
        out[4..8].copy_from_slice(&28u32.to_le_bytes());
        out[8..12].copy_from_slice(&1u32.to_le_bytes());
        out[16..20].copy_from_slice(&(base_at as u32).to_le_bytes());
        out[24..28].copy_from_slice(&(suffix_at as u32).to_le_bytes());
        out.extend(base.as_bytes());
        out.push(0);
        out.extend(suffix.as_bytes());
        out.push(0);
        out
    }

    #[test]
    fn reads_the_local_path_after_an_id_list() {
        let mut data = header(HAS_ID_LIST | HAS_LINK_INFO | IS_UNICODE);
        data.extend(3u16.to_le_bytes());
        data.extend([9, 9, 9]);
        data.extend(link_info(r"C:\Projects", r"app\notes.txt"));
        assert_eq!(parse(&data).unwrap(), [r"C:\Projects\app\notes.txt"]);
    }
    #[test]
    fn falls_back_to_the_relative_path_past_the_name() {
        let mut data = header(HAS_NAME | HAS_RELATIVE_PATH | IS_UNICODE);
        data.extend(counted_wide("A description"));
        data.extend(counted_wide(r"..\docs\şema.md"));
        assert_eq!(parse(&data).unwrap(), [r"..\docs\şema.md"]);
    }
    #[test]
    fn an_ansi_path_with_other_letters_comes_after_the_unicode_relative_path() {
        let mut data = header(HAS_LINK_INFO | HAS_RELATIVE_PATH | IS_UNICODE);
        data.extend(link_info("C:\\Dosyalar\u{131}", "not.txt"));
        data.extend(counted_wide(r"..\Dosyalarım\not.txt"));
        let found = parse(&data).unwrap();
        assert_eq!(found[0], r"..\Dosyalarım\not.txt");
        assert_eq!(found.len(), 2);
    }
    #[test]
    fn other_or_truncated_files_are_not_shortcuts() {
        assert_eq!(parse(b"not a shortcut at all"), None);
        assert_eq!(parse(&[]), None);
        // Offsets that run past the end of the file are refused, not read.
        let mut data = header(HAS_LINK_INFO);
        data.extend(40u32.to_le_bytes());
        data.extend(28u32.to_le_bytes());
        data.extend(1u32.to_le_bytes());
        assert_eq!(parse(&data), Some(vec![]));
        let mut data = header(HAS_ID_LIST);
        data.extend(u16::MAX.to_le_bytes());
        assert_eq!(parse(&data), Some(vec![]));
        // A shortcut to a shell item names nothing on disk.
        assert_eq!(parse(&header(0)), Some(vec![]));
    }
    #[test]
    fn a_target_is_a_folder_a_file_or_a_program_that_never_runs() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("folder");
        fs::create_dir(&folder).unwrap();
        let text = folder.join("note.txt");
        fs::write(&text, "x").unwrap();
        let program = folder.join("run.exe");
        fs::write(&program, "x").unwrap();
        let link = |name: &str, target: &str| {
            let mut data = header(HAS_RELATIVE_PATH | IS_UNICODE);
            data.extend(counted_wide(target));
            let path = dir.path().join(name);
            fs::write(&path, data).unwrap();
            path
        };
        assert!(matches!(
            resolve(&link("a.lnk", "folder")).unwrap(),
            Target::Folder { path } if Path::new(&path) == folder
        ));
        assert!(matches!(
            resolve(&link("b.lnk", "folder/note.txt")).unwrap(),
            Target::File { path } if Path::new(&path) == text
        ));
        assert!(matches!(
            resolve(&link("c.lnk", "folder/run.exe")).unwrap(),
            Target::Program { path } if Path::new(&path) == program
        ));
        assert!(resolve(&link("d.lnk", "folder/gone.txt")).is_err());
        let plain = dir.path().join("e.lnk");
        fs::write(&plain, "text").unwrap();
        assert!(resolve(&plain).is_err());
    }
    #[cfg(windows)]
    #[test]
    fn a_target_cannot_reach_a_program_or_the_network_by_how_it_is_written() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("run.cmd"), "x").unwrap();
        let link = |name: &str, target: &str| {
            let mut data = header(HAS_RELATIVE_PATH | IS_UNICODE);
            data.extend(counted_wide(target));
            let path = dir.path().join(name);
            fs::write(&path, data).unwrap();
            path
        };
        for target in ["run.cmd.", "run.cmd "] {
            assert!(
                matches!(
                    resolve(&link("a.lnk", target)).unwrap(),
                    Target::Program { .. }
                ),
                "{target}"
            );
        }
        // 192.0.2.0/24 is reserved for documentation: nothing answers, and nothing is asked.
        for target in [
            r"\\192.0.2.1\share\note.txt",
            "//192.0.2.1/share/note.txt",
            r"\\?\UNC\192.0.2.1\share\note.txt",
            r"\\.\pipe\note",
        ] {
            let error = resolve(&link("b.lnk", target)).unwrap_err();
            assert!(error.contains("on this computer"), "{target}: {error}");
        }
        let on_share = Path::new(r"\\server\share\a.lnk");
        assert!(stays_local(on_share, Path::new(r"\\server\share\b.txt")));
        assert!(!stays_local(on_share, Path::new(r"\\other\share\b.txt")));
        assert!(stays_local(on_share, Path::new(r"C:\b.txt")));
    }
}
