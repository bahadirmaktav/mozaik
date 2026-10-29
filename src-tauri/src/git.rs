use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

/// Read-only Git awareness: the branch, file states and the committed text of a file.
/// Only fixed `git` subcommands that never write the repository are run.
/// Without the `\\?\` prefix of canonical Windows paths, which external tools may reject.
pub fn plain(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if rest.as_bytes().get(1) == Some(&b':') => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}
fn git(directory: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let directory = plain(directory);
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(&directory)
        // A repository's fsmonitor hook is a program; status must not start it.
        .args(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false"])
        .args(args)
        .current_dir(&directory)
        // Keep `status` from refreshing the index, so nothing in `.git` is written.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .output()
        .map_err(|e| format!("Git is not available: {e}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    Ok(output.stdout)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Change {
    path: String,
    /// `M` modified, `A` added, `D` deleted, `R` renamed, `U` untracked, `C` conflicted.
    status: char,
}
#[derive(Serialize, Debug, PartialEq)]
pub struct Status {
    root: String,
    branch: String,
    changes: Vec<Change>,
    /// Ignored files and folders; a wholly ignored folder is one entry.
    ignored: Vec<String>,
}

fn state(xy: &str) -> char {
    let (x, y) = (
        xy.chars().next().unwrap_or('.'),
        xy.chars().nth(1).unwrap_or('.'),
    );
    // The working tree state wins: it is what the editor shows.
    match if y != '.' { y } else { x } {
        'A' => 'A',
        'D' => 'D',
        'R' | 'C' => 'R',
        _ => 'M',
    }
}
/// Parses `git status --porcelain=v2 --branch -z`. Paths are relative to the repository root.
pub fn parse(root: &Path, output: &[u8]) -> Status {
    let text = String::from_utf8_lossy(output);
    let mut records = text.split('\0');
    let mut head = None;
    let mut oid = None;
    let mut changes = Vec::new();
    let mut ignored = Vec::new();
    let path = |relative: &str| crate::directory::display(&root.join(relative));
    while let Some(record) = records.next() {
        if let Some(value) = record.strip_prefix("# branch.head ") {
            head = Some(value.to_owned());
        } else if let Some(value) = record.strip_prefix("# branch.oid ") {
            oid = Some(value.chars().take(7).collect::<String>());
        } else if let Some(rest) = record.strip_prefix("1 ") {
            let fields: Vec<&str> = rest.splitn(8, ' ').collect();
            if let [xy, .., file] = fields.as_slice() {
                changes.push(Change {
                    path: path(file),
                    status: state(xy),
                });
            }
        } else if let Some(rest) = record.strip_prefix("2 ") {
            let fields: Vec<&str> = rest.splitn(9, ' ').collect();
            if let [xy, .., file] = fields.as_slice() {
                changes.push(Change {
                    path: path(file),
                    status: state(xy),
                });
            }
            // The original path of a rename follows as its own record.
            records.next();
        } else if let Some(rest) = record.strip_prefix("u ") {
            if let Some(file) = rest.splitn(10, ' ').nth(9) {
                changes.push(Change {
                    path: path(file),
                    status: 'C',
                });
            }
        } else if let Some(file) = record.strip_prefix("? ") {
            changes.push(Change {
                path: path(file.trim_end_matches('/')),
                status: 'U',
            });
        } else if let Some(file) = record.strip_prefix("! ") {
            ignored.push(path(file.trim_end_matches('/')));
        }
    }
    let branch = match head.as_deref() {
        Some("(detached)") | None => match oid {
            Some(oid) if oid != "(initial" => format!("detached at {oid}"),
            _ => "no commits".into(),
        },
        Some(name) => name.to_owned(),
    };
    Status {
        root: crate::directory::display(root),
        branch,
        changes,
        ignored,
    }
}

fn toplevel(directory: &Path) -> Result<Option<PathBuf>, String> {
    match git(directory, &["rev-parse", "--show-toplevel"]) {
        Ok(output) => {
            let top = String::from_utf8_lossy(&output).trim().to_owned();
            Ok(Some(
                PathBuf::from(top)
                    .canonicalize()
                    .map_err(|e| e.to_string())?,
            ))
        }
        Err(error) if error.starts_with("Git is not available") => Err(error),
        // Not a repository.
        Err(_) => Ok(None),
    }
}

/// `None` outside a repository. Untracked folders are reported as one entry.
#[tauri::command]
pub async fn git_status(root: String) -> Result<Option<Status>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::project::root(&root)?;
        let Some(top) = toplevel(&root)? else {
            return Ok(None);
        };
        let output = git(
            &top,
            &[
                "status",
                "--porcelain=v2",
                "--branch",
                "-z",
                "--untracked-files=normal",
                "--ignored=traditional",
                "--ignore-submodules=dirty",
            ],
        )?;
        Ok(Some(parse(&top, &output)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The committed (`HEAD`) text of a file, decoded like an opened file. `None` when the
/// file is not in `HEAD` (new or untracked). Filters and textconv are not applied.
#[tauri::command]
pub async fn git_head_text(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = PathBuf::from(&path);
        let directory = path
            .parent()
            .ok_or("Invalid path")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let Some(top) = toplevel(&directory)? else {
            return Err("The file is not in a Git repository".into());
        };
        let file = directory.join(path.file_name().ok_or("Invalid path")?);
        let relative = file
            .strip_prefix(&top)
            .map_err(|_| "The file is outside the repository")?
            .to_string_lossy()
            .replace('\\', "/");
        let spec = format!("HEAD:{relative}");
        if git(&top, &["cat-file", "-e", &spec]).is_err() {
            return Ok(None);
        }
        let bytes = git(&top, &["cat-file", "blob", &spec])?;
        crate::files::decode(&file, &bytes).map(|data| Some(data.text))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn porcelain_v2_records_become_file_states() {
        let root = Path::new("/repo");
        let output = b"# branch.oid 0123456789abcdef\0# branch.head main\0\
1 .M N... 100644 100644 100644 aaa bbb src/a.cpp\0\
1 A. N... 000000 100644 100644 000 bbb new file.h\0\
2 R. N... 100644 100644 100644 aaa bbb R100 b.cpp\0old.cpp\0\
u UU N... 100644 100644 100644 100644 a b c both.cpp\0\
? build/\0! target/\0";
        let status = parse(root, output);
        assert_eq!(status.branch, "main");
        let states: Vec<(String, char)> = status
            .changes
            .iter()
            .map(|c| (c.path.replace('\\', "/"), c.status))
            .collect();
        assert_eq!(
            states,
            [
                ("/repo/src/a.cpp".into(), 'M'),
                ("/repo/new file.h".into(), 'A'),
                ("/repo/b.cpp".into(), 'R'),
                ("/repo/both.cpp".into(), 'C'),
                ("/repo/build".into(), 'U'),
            ]
        );
        assert_eq!(
            status
                .ignored
                .iter()
                .map(|p| p.replace('\\', "/"))
                .collect::<Vec<_>>(),
            ["/repo/target"]
        );
        let detached = parse(
            root,
            b"# branch.oid 0123456789abcdef\0# branch.head (detached)\0",
        );
        assert_eq!(detached.branch, "detached at 0123456");
    }

    #[test]
    fn status_and_head_text_of_a_real_repository() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let run = |args: &[&str]| git(&root, args);
        if run(&["init", "-q", "-b", "main"]).is_err() {
            eprintln!("git is not installed; skipped");
            return;
        }
        run(&["config", "user.email", "t@example.invalid"]).unwrap();
        run(&["config", "user.name", "Tessera test"]).unwrap();
        std::fs::write(root.join("a.cpp"), "int a;\r\n").unwrap();
        run(&["add", "a.cpp"]).unwrap();
        run(&["commit", "-q", "-m", "init"]).unwrap();
        std::fs::write(root.join("a.cpp"), "int b;\n").unwrap();
        std::fs::write(root.join("new.cpp"), "x").unwrap();
        std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
        std::fs::create_dir(root.join("build")).unwrap();
        std::fs::write(root.join("build").join("out.o"), "x").unwrap();
        let status = tauri::async_runtime::block_on(git_status(crate::directory::display(&root)))
            .unwrap()
            .unwrap();
        assert_eq!(status.branch, "main");
        // a.cpp, new.cpp and .gitignore; the ignored folder is reported once, apart.
        assert_eq!(status.changes.len(), 3);
        assert_eq!(
            status.ignored,
            [crate::directory::display(&root.join("build"))]
        );
        let head = tauri::async_runtime::block_on(git_head_text(crate::directory::display(
            &root.join("a.cpp"),
        )))
        .unwrap();
        assert_eq!(head.as_deref(), Some("int a;\n"));
        let untracked = tauri::async_runtime::block_on(git_head_text(crate::directory::display(
            &root.join("new.cpp"),
        )))
        .unwrap();
        assert_eq!(untracked, None);
    }
}
