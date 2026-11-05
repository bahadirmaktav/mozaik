use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

/// Git awareness: the branch, file states and the committed and staged text of a file,
/// plus the Source Control actions the user starts: stage, unstage and discard of chosen
/// files. Only fixed `git` subcommands run, with paths as literal pathspecs.
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
    /// The change in the index (staged), if any.
    staged: Option<char>,
    /// The change in the working tree (not staged), if any; untracked and conflicted files.
    unstaged: Option<char>,
}
#[derive(Serialize, Debug, PartialEq)]
pub struct Status {
    root: String,
    branch: String,
    /// The commit `HEAD` names; `None` before the first commit.
    head: Option<String>,
    changes: Vec<Change>,
    /// Ignored files and folders; a wholly ignored folder is one entry.
    ignored: Vec<String>,
}

/// One side (index or working tree) of a porcelain `XY` state.
fn side(c: char) -> Option<char> {
    match c {
        '.' => None,
        'A' => Some('A'),
        'D' => Some('D'),
        'R' | 'C' => Some('R'),
        _ => Some('M'),
    }
}
fn change(path: String, xy: &str) -> Change {
    let mut sides = xy.chars();
    Change {
        path,
        status: state(xy),
        staged: side(sides.next().unwrap_or('.')),
        unstaged: side(sides.next().unwrap_or('.')),
    }
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
            oid = Some(value.to_owned());
        } else if let Some(rest) = record.strip_prefix("1 ") {
            let fields: Vec<&str> = rest.splitn(8, ' ').collect();
            if let [xy, .., file] = fields.as_slice() {
                changes.push(change(path(file), xy));
            }
        } else if let Some(rest) = record.strip_prefix("2 ") {
            let fields: Vec<&str> = rest.splitn(9, ' ').collect();
            if let [xy, .., file] = fields.as_slice() {
                changes.push(change(path(file), xy));
            }
            // The original path of a rename follows as its own record.
            records.next();
        } else if let Some(rest) = record.strip_prefix("u ") {
            if let Some(file) = rest.splitn(10, ' ').nth(9) {
                changes.push(Change {
                    path: path(file),
                    status: 'C',
                    staged: None,
                    unstaged: Some('C'),
                });
            }
        } else if let Some(file) = record.strip_prefix("? ") {
            changes.push(Change {
                path: path(file.trim_end_matches('/')),
                status: 'U',
                staged: None,
                unstaged: Some('U'),
            });
        } else if let Some(file) = record.strip_prefix("! ") {
            ignored.push(path(file.trim_end_matches('/')));
        }
    }
    let branch = match head.as_deref() {
        Some("(detached)") | None => match oid {
            Some(ref oid) if oid != "(initial)" => {
                format!("detached at {}", oid.chars().take(7).collect::<String>())
            }
            _ => "no commits".into(),
        },
        Some(name) => name.to_owned(),
    };
    Status {
        root: crate::directory::display(root),
        branch,
        head: oid.filter(|oid| oid != "(initial)"),
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

#[derive(Serialize, Debug, PartialEq)]
pub struct Commit {
    hash: String,
    parents: Vec<String>,
    author: String,
    /// Seconds since the Unix epoch.
    date: i64,
    /// Branches, tags and `HEAD` at this commit, as `git log` decorates them.
    refs: Vec<String>,
    subject: String,
}
/// One unit-separated record per commit of the format in `git_log`.
fn parse_log(output: &[u8]) -> Vec<Commit> {
    String::from_utf8_lossy(output)
        .split('\0')
        .filter_map(|record| {
            let mut fields = record.trim_start_matches('\n').splitn(6, '\u{1f}');
            let hash = fields.next().filter(|h| !h.is_empty())?.to_owned();
            let parents = fields.next()?;
            let author = fields.next()?.to_owned();
            let date = fields.next()?.parse().unwrap_or(0);
            let refs = fields.next()?;
            Some(Commit {
                hash,
                parents: parents.split_whitespace().map(str::to_owned).collect(),
                author,
                date,
                refs: refs
                    .split(", ")
                    .filter(|r| !r.is_empty())
                    .map(str::to_owned)
                    .collect(),
                subject: fields.next().unwrap_or_default().to_owned(),
            })
        })
        .collect()
}
/// The history of every branch and tag, newest first with children before parents, for the
/// Source Control graph: `limit` commits after the first `skip`. Reads only. `None` outside a
/// repository.
#[tauri::command]
pub async fn git_log(root: String, skip: u32, limit: u32) -> Result<Option<Vec<Commit>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::project::root(&root)?;
        let Some(top) = toplevel(&root)? else {
            return Ok(None);
        };
        let output = git(
            &top,
            &[
                "log",
                "--all",
                "--topo-order",
                "--no-show-signature",
                "-z",
                "--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s",
                &format!("--skip={skip}"),
                &format!("--max-count={}", limit.clamp(1, 1000)),
            ],
        )?;
        Ok(Some(parse_log(&output)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The committed (`HEAD`) text of a file, decoded like an opened file. `None` when the
/// file is not in `HEAD` (new or untracked). Filters and textconv are not applied.
#[tauri::command]
pub async fn git_head_text(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || stored_text(&path, "HEAD:"))
        .await
        .map_err(|e| e.to_string())?
}
/// The staged (index) text of a file; `None` when it is not in the index.
#[tauri::command]
pub async fn git_index_text(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || stored_text(&path, ":"))
        .await
        .map_err(|e| e.to_string())?
}
fn stored_text(path: &str, revision: &str) -> Result<Option<String>, String> {
    let path = PathBuf::from(path);
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
    let spec = format!("{revision}{relative}");
    if git(&top, &["cat-file", "-e", &spec]).is_err() {
        return Ok(None);
    }
    let bytes = git(&top, &["cat-file", "blob", &spec])?;
    crate::files::decode(&file, &bytes).map(|data| Some(data.text))
}

/// The repository of a project and the given files in it as literal pathspecs (no globs).
/// Files may be deleted, so they are checked lexically against the repository folder.
fn pathspecs(root: &str, paths: &[String]) -> Result<(PathBuf, Vec<String>), String> {
    let root = crate::project::root(root)?;
    let top = toplevel(&root)?.ok_or("The project is not in a Git repository")?;
    let base = plain(&top);
    if paths.is_empty() {
        return Err("No files were given".into());
    }
    let specs = paths
        .iter()
        .map(|path| {
            let path = plain(Path::new(path));
            if path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir))
            {
                return Err(format!("{} is not a plain path", path.display()));
            }
            let relative = path
                .strip_prefix(&base)
                .map_err(|_| format!("{} is outside the repository", path.display()))?
                .to_string_lossy()
                .replace('\\', "/");
            if relative.is_empty() {
                return Err("The repository itself is not a file".into());
            }
            Ok(format!(":(literal){relative}"))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok((top, specs))
}
fn with_specs<'a>(args: &[&'a str], specs: &'a [String]) -> Vec<&'a str> {
    let mut all = args.to_vec();
    all.push("--");
    all.extend(specs.iter().map(String::as_str));
    all
}
async fn blocking(
    work: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// Stages files (new, changed and deleted ones), as `git add`.
#[tauri::command]
pub async fn git_stage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let (top, specs) = pathspecs(&root, &paths)?;
        git(&top, &with_specs(&["add", "-A"], &specs)).map(|_| ())
    })
    .await
}
/// Takes files out of the index again; their working tree text is kept.
#[tauri::command]
pub async fn git_unstage(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let (top, specs) = pathspecs(&root, &paths)?;
        // Before the first commit there is no HEAD to restore the index from.
        let args: &[&str] = if git(&top, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok() {
            &["restore", "--staged"]
        } else {
            &["rm", "--cached", "-r", "-q"]
        };
        git(&top, &with_specs(args, &specs)).map(|_| ())
    })
    .await
}
/// Discards the working tree changes of tracked files: they get the staged text back.
/// Untracked files are not touched here; the renderer moves them to the Trash.
#[tauri::command]
pub async fn git_discard(root: String, paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        let (top, specs) = pathspecs(&root, &paths)?;
        git(&top, &with_specs(&["restore", "--worktree"], &specs)).map(|_| ())
    })
    .await
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
        run(&["config", "user.name", "Mozaik test"]).unwrap();
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

    #[test]
    fn stage_unstage_and_discard_chosen_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let run = |args: &[&str]| git(&root, args);
        if run(&["init", "-q", "-b", "main"]).is_err() {
            eprintln!("git is not installed; skipped");
            return;
        }
        run(&["config", "user.email", "t@example.invalid"]).unwrap();
        run(&["config", "user.name", "Mozaik test"]).unwrap();
        let file = |name: &str| crate::directory::display(&root.join(name));
        let project = crate::directory::display(&root);
        let status = || {
            tauri::async_runtime::block_on(git_status(project.clone()))
                .unwrap()
                .unwrap()
                .changes
                .into_iter()
                .map(|c| {
                    (
                        c.path.rsplit(['/', '\\']).next().unwrap().to_owned(),
                        c.staged,
                        c.unstaged,
                    )
                })
                .collect::<Vec<_>>()
        };
        // Before the first commit: unstaging uses the index alone.
        std::fs::write(root.join("[a].cpp"), "int a;\n").unwrap();
        tauri::async_runtime::block_on(git_stage(project.clone(), vec![file("[a].cpp")])).unwrap();
        assert_eq!(status(), [("[a].cpp".into(), Some('A'), None)]);
        tauri::async_runtime::block_on(git_unstage(project.clone(), vec![file("[a].cpp")]))
            .unwrap();
        assert_eq!(status(), [("[a].cpp".into(), None, Some('U'))]);
        run(&["add", "-A"]).unwrap();
        run(&["commit", "-q", "-m", "init"]).unwrap();

        std::fs::write(root.join("[a].cpp"), "int b;\n").unwrap();
        tauri::async_runtime::block_on(git_stage(project.clone(), vec![file("[a].cpp")])).unwrap();
        std::fs::write(root.join("[a].cpp"), "int c;\n").unwrap();
        assert_eq!(status(), [("[a].cpp".into(), Some('M'), Some('M'))]);
        assert_eq!(
            tauri::async_runtime::block_on(git_index_text(file("[a].cpp")))
                .unwrap()
                .as_deref(),
            Some("int b;\n")
        );
        // Discard brings back the staged text; unstage then leaves the file changed.
        tauri::async_runtime::block_on(git_discard(project.clone(), vec![file("[a].cpp")]))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("[a].cpp"))
                .unwrap()
                .replace("\r\n", "\n"),
            "int b;\n"
        );
        tauri::async_runtime::block_on(git_unstage(project.clone(), vec![file("[a].cpp")]))
            .unwrap();
        assert_eq!(status(), [("[a].cpp".into(), None, Some('M'))]);
        // Deleted files stage too; paths outside the repository are refused.
        std::fs::remove_file(root.join("[a].cpp")).unwrap();
        tauri::async_runtime::block_on(git_stage(project.clone(), vec![file("[a].cpp")])).unwrap();
        assert_eq!(status(), [("[a].cpp".into(), Some('D'), None)]);
        let outside = dir.path().parent().unwrap().join("x.cpp");
        assert!(
            tauri::async_runtime::block_on(git_stage(
                project.clone(),
                vec![crate::directory::display(&outside)]
            ))
            .is_err()
        );
    }
}
