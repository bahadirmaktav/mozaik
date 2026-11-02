//! The File Manager's This PC page: the drives (Windows) or mounted file systems (Linux)
//! to start browsing from, with their size and free space.
use serde::Serialize;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Drive {
    /// The folder to open: `C:\` or a mount point.
    pub path: String,
    pub name: String,
    /// `fixed`, `removable`, `network`, `optical` or `other`.
    pub kind: &'static str,
    pub total: Option<u64>,
    pub free: Option<u64>,
}

#[cfg(windows)]
fn drives() -> Vec<Drive> {
    use windows_sys::Win32::Storage::FileSystem::{
        GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW,
    };
    // `GetDriveTypeW` results (WindowsProgramming, not a feature Mozaik enables).
    const REMOVABLE: u32 = 2;
    const FIXED: u32 = 3;
    const REMOTE: u32 = 4;
    const CDROM: u32 = 5;
    let mask = unsafe { GetLogicalDrives() };
    (0..26u8)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| {
            let letter = (b'A' + i) as char;
            let path = format!("{letter}:\\");
            // The plain root (`C:\`): the volume functions want it, not the `\\?\` form.
            let root: Vec<u16> = path.encode_utf16().chain([0]).collect();
            let kind = match unsafe { GetDriveTypeW(root.as_ptr()) } {
                FIXED => "fixed",
                REMOVABLE => "removable",
                REMOTE => "network",
                CDROM => "optical",
                _ => "other",
            };
            let (mut free, mut total) = (0u64, 0u64);
            // Fails without a medium (an empty card reader or disc drive): no size, no label.
            let ready = unsafe {
                GetDiskFreeSpaceExW(root.as_ptr(), &mut free, &mut total, std::ptr::null_mut())
            } != 0;
            let mut label = [0u16; 261];
            let named = ready
                && unsafe {
                    GetVolumeInformationW(
                        root.as_ptr(),
                        label.as_mut_ptr(),
                        label.len() as u32,
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        std::ptr::null_mut(),
                        0,
                    )
                } != 0;
            let label = if named {
                let end = label.iter().position(|&c| c == 0).unwrap_or(label.len());
                String::from_utf16_lossy(&label[..end])
            } else {
                String::new()
            };
            let label = if !label.is_empty() {
                label
            } else {
                match kind {
                    "fixed" => "Local Disk",
                    "removable" => "Removable Disk",
                    "network" => "Network Drive",
                    "optical" => "CD Drive",
                    _ => "Drive",
                }
                .to_string()
            };
            Drive {
                name: format!("{label} ({letter}:)"),
                path,
                kind,
                total: ready.then_some(total),
                free: ready.then_some(free),
            }
        })
        .collect()
}

/// `/proc/mounts` escapes spaces and other characters as octal (`\040`).
#[cfg(any(not(windows), test))]
fn unescape(field: &str) -> String {
    let bytes = field.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let octal = bytes
            .get(i + 1..i + 4)
            .filter(|digits| bytes[i] == b'\\' && digits.iter().all(|d| (b'0'..=b'7').contains(d)));
        if let Some(digits) = octal {
            let value = digits.iter().fold(0u32, |v, d| v * 8 + (d - b'0') as u32);
            out.push(value as u8);
            i += 4;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
/// The mount points worth starting from: the root, a separate home, and removable or
/// added disks under `/media`, `/run/media` and `/mnt`.
#[cfg(any(not(windows), test))]
fn mount_points(mounts: &str) -> Vec<(String, &'static str)> {
    let mut seen = Vec::new();
    for line in mounts.lines() {
        let mut fields = line.split_whitespace();
        let (Some(_device), Some(point)) = (fields.next(), fields.next()) else {
            continue;
        };
        let point = unescape(point);
        let kind = if point == "/" || point == "/home" {
            "fixed"
        } else if point.starts_with("/media/") || point.starts_with("/run/media/") {
            "removable"
        } else if point.starts_with("/mnt/") {
            "other"
        } else {
            continue;
        };
        if !seen.iter().any(|(p, _)| p == &point) {
            seen.push((point, kind));
        }
    }
    seen
}

#[cfg(not(windows))]
fn drives() -> Vec<Drive> {
    let mounts = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
    let mut points = mount_points(&mounts);
    if points.is_empty() {
        points.push(("/".into(), "fixed"));
    }
    points
        .into_iter()
        .map(|(path, kind)| {
            let (total, free) = space(&path).unzip();
            let name = if path == "/" {
                "File System".to_string()
            } else {
                std::path::Path::new(&path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone())
            };
            Drive {
                name,
                path,
                kind,
                total,
                free,
            }
        })
        .collect()
}
#[cfg(not(windows))]
fn space(path: &str) -> Option<(u64, u64)> {
    let path = std::ffi::CString::new(path).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    let block = stat.f_frsize as u64;
    Some((stat.f_blocks as u64 * block, stat.f_bavail as u64 * block))
}

/// The drives or mount points of this computer, read when the page opens.
#[tauri::command]
pub async fn list_drives() -> Result<Vec<Drive>, String> {
    crate::directory::blocking(|| Ok(drives())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mounts_keep_the_root_home_and_added_disks() {
        let mounts = "sysfs /sys sysfs rw 0 0\n\
            /dev/nvme0n1p2 / ext4 rw 0 0\n\
            /dev/nvme0n1p3 /home ext4 rw 0 0\n\
            tmpfs /run tmpfs rw 0 0\n\
            /dev/sda1 /run/media/me/USB\\040Stick vfat rw 0 0\n\
            /dev/sdb1 /mnt/data ext4 rw 0 0\n\
            /dev/nvme0n1p2 / ext4 rw 0 0\n";
        assert_eq!(
            mount_points(mounts),
            vec![
                ("/".to_string(), "fixed"),
                ("/home".to_string(), "fixed"),
                ("/run/media/me/USB Stick".to_string(), "removable"),
                ("/mnt/data".to_string(), "other"),
            ]
        );
    }

    #[test]
    fn this_computer_has_at_least_one_drive() {
        let list = drives();
        assert!(!list.is_empty());
        assert!(
            list.iter()
                .all(|d| std::path::Path::new(&d.path).is_absolute())
        );
    }
}
