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
fn status_output(top: &Path) -> Result<Vec<u8>, String> {
    let overrides = status_filter_overrides(top)?;
    let mut args: Vec<&str> = overrides.iter().map(String::as_str).collect();
    args.extend([
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=normal",
        "--ignored=traditional",
        "--ignore-submodules=dirty",
    ]);
    git(top, &args)
}
/// `-c` arguments that turn off the clean filters a repository defines in its own config. They
/// are programs, and `status` starts them for a file whose time changed: a folder from an archive
/// could run anything just by being opened, since Mozaik asks for the status by itself. Filters
/// from the user's global or system config stay. A file with such a filter may show as changed
/// until Git refreshes the index; `add` and `restore` keep the filters, because the user asked for
/// them and git-crypt or LFS would otherwise store the wrong content.
fn status_filter_overrides(top: &Path) -> Result<Vec<String>, String> {
    let output = match git(
        top,
        &[
            "config",
            "--show-scope",
            "--includes",
            "-z",
            "--get-regexp",
            r"^filter\..*\.(clean|process)$",
        ],
    ) {
        Ok(output) => output,
        // Exit code 1 with nothing to say: no filter anywhere.
        Err(error) if error.is_empty() => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let text = String::from_utf8_lossy(&output);
    let mut fields = text.split('\0');
    let mut names = Vec::new();
    while let (Some(scope), Some(entry)) = (fields.next(), fields.next()) {
        if scope == "global" || scope == "system" {
            continue;
        }
        let key = entry.split('\n').next().unwrap_or(entry);
        let Some(name) = key
            .strip_prefix("filter.")
            .and_then(|k| k.rsplit_once('.'))
            .map(|(name, _)| name)
        else {
            continue;
        };
        // `-c` ends a key at its first `=`, so this one could not be turned off.
        if name.contains('=') {
            return Err(format!("This repository's filter {name:?} was not run"));
        }
        if !names.iter().any(|n| n == name) {
            names.push(name.to_owned());
        }
    }
    Ok(names
        .iter()
        .flat_map(|name| {
            [
                format!("filter.{name}.clean="),
                format!("filter.{name}.process="),
                format!("filter.{name}.required=false"),
            ]
        })
        .flat_map(|setting| ["-c".to_owned(), setting])
        .collect())
}
#[tauri::command]
pub async fn git_status(root: String) -> Result<Option<Status>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::project::root(&root)?;
        let Some(top) = toplevel(&root)? else {
            return Ok(None);
        };
        Ok(Some(parse(&top, &status_output(&top)?)))
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

/// A full or abbreviated commit name, as SonarQube reports the analyzed commit; nothing that
/// Git could read as an option or a revision expression.
fn commit_name(revision: &str) -> Result<&str, String> {
    let ok = (7..=64).contains(&revision.len()) && revision.bytes().all(|b| b.is_ascii_hexdigit());
    ok.then_some(revision)
        .ok_or_else(|| format!("{revision:?} is not a commit"))
}
/// Whether the project's repository has a commit, for matching a SonarQube analysis.
#[tauri::command]
pub async fn git_has_commit(root: String, revision: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let revision = commit_name(&revision)?;
        let root = crate::project::root(&root)?;
        let Some(top) = toplevel(&root)? else {
            return Ok(false);
        };
        Ok(git(&top, &["cat-file", "-e", &format!("{revision}^{{commit}}")]).is_ok())
    })
    .await
    .map_err(|e| e.to_string())?
}
/// The text of a file at a commit; `None` when the file is not in it.
#[tauri::command]
pub async fn git_revision_text(path: String, revision: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let revision = commit_name(&revision)?;
        stored_text(&path, &format!("{revision}:"))
    })
    .await
    .map_err(|e| e.to_string())?
}
/// A file a commit changed, against its first parent, for the Source Control graph.
#[derive(Serialize, Debug, PartialEq)]
pub struct CommitFile {
    path: String,
    /// The name before a rename or copy.
    #[serde(rename = "oldPath")]
    old_path: Option<String>,
    /// `A` added, `M` modified, `D` deleted, `R` renamed, `C` copied, `T` type changed.
    status: char,
}
/// `git diff-tree -z --name-status` records: a status, then one path (two for a rename or
/// copy).
fn parse_name_status(top: &Path, output: &[u8]) -> Vec<CommitFile> {
    let text = String::from_utf8_lossy(output);
    let mut fields = text.split('\0').filter(|f| !f.is_empty());
    let mut files = Vec::new();
    while let Some(code) = fields.next() {
        let Some(status) = code.chars().next() else {
            break;
        };
        let Some(first) = fields.next() else { break };
        let (old_path, path) = if matches!(status, 'R' | 'C') {
            let Some(second) = fields.next() else { break };
            (Some(first), second)
        } else {
            (None, first)
        };
        files.push(CommitFile {
            path: crate::directory::display(&top.join(path)),
            old_path: old_path.map(|p| crate::directory::display(&top.join(p))),
            status,
        });
    }
    files
}
/// The files a commit changed against its first parent (all of them for a first commit),
/// as VS Code lists them under a commit of its graph. Reads only.
#[tauri::command]
pub async fn git_commit_files(root: String, revision: String) -> Result<Vec<CommitFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let revision = commit_name(&revision)?;
        let root = crate::project::root(&root)?;
        let top = toplevel(&root)?.ok_or("The project is not in a Git repository")?;
        let parent = format!("{revision}^1");
        let mut args = vec![
            "diff-tree",
            "-r",
            "-z",
            "--name-status",
            "-M",
            "--no-ext-diff",
            "--no-textconv",
        ];
        if git(&top, &["cat-file", "-e", &format!("{parent}^{{commit}}")]).is_ok() {
            args.extend([parent.as_str(), revision]);
        } else {
            args.extend(["--root", revision]);
        }
        Ok(parse_name_status(&top, &git(&top, &args)?))
    })
    .await
    .map_err(|e| e.to_string())?
}
/// The text of a file of the project's repository at a commit; `None` when the file is not
/// in it. Unlike `git_revision_text` the file need not exist any more: the path is only
/// checked lexically against the repository folder.
#[tauri::command]
pub async fn git_commit_text(
    root: String,
    revision: String,
    path: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let revision = commit_name(&revision)?;
        let (top, specs) = pathspecs(&root, std::slice::from_ref(&path))?;
        let relative = specs[0].trim_start_matches(":(literal)");
        let spec = format!("{revision}:{relative}");
        if git(&top, &["cat-file", "-e", &spec]).is_err() {
            return Ok(None);
        }
        let bytes = git(&top, &["cat-file", "blob", &spec])?;
        crate::files::decode(Path::new(&path), &bytes).map(|data| Some(data.text))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The tracked files whose working tree text differs from a commit's, as paths. The
/// repository's own clean filters are turned off as for `status`.
#[tauri::command]
pub async fn git_changed_since(root: String, revision: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let revision = commit_name(&revision)?;
        let root = crate::project::root(&root)?;
        let top = toplevel(&root)?.ok_or("The project is not in a Git repository")?;
        let overrides = status_filter_overrides(&top)?;
        let mut args: Vec<&str> = overrides.iter().map(String::as_str).collect();
        args.extend([
            "diff",
            "--name-only",
            "-z",
            "--no-renames",
            "--no-ext-diff",
            "--no-textconv",
            revision,
            "--",
        ]);
        let output = git(&top, &args)?;
        Ok(String::from_utf8_lossy(&output)
            .split('\0')
            .filter(|p| !p.is_empty())
            .map(|p| crate::directory::display(&top.join(p)))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
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
    fn name_status_records_become_commit_files() {
        let top = Path::new("/repo");
        let files = parse_name_status(top, b"M\0src/a.cpp\0R087\0old.h\0new.h\0D\0gone.txt\0");
        let shown: Vec<(String, Option<String>, char)> = files
            .into_iter()
            .map(|f| {
                (
                    f.path.replace('\\', "/"),
                    f.old_path.map(|p| p.replace('\\', "/")),
                    f.status,
                )
            })
            .collect();
        assert_eq!(
            shown,
            [
                ("/repo/src/a.cpp".into(), None, 'M'),
                ("/repo/new.h".into(), Some("/repo/old.h".into()), 'R'),
                ("/repo/gone.txt".into(), None, 'D'),
            ]
        );
    }

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
    fn status_starts_no_filter_of_the_repositorys_own_config() {
        let dir = tempfile::tempdir().unwrap();
        let top = dir.path().canonicalize().unwrap();
        let top = plain(&top);
        let run = |args: &[&str]| git(&top, args).unwrap();
        if git(&top, &["init", "-q", "-b", "main"]).is_err() {
            eprintln!("git is not installed; skipped");
            return;
        }
        run(&["config", "user.email", "t@example.invalid"]);
        run(&["config", "user.name", "Mozaik test"]);
        std::fs::write(top.join("a.txt"), "one\n").unwrap();
        std::fs::write(top.join(".gitattributes"), "*.txt filter=probe\n").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-qm", "one"]);
        let marker = top
            .join("filter-ran")
            .display()
            .to_string()
            .replace('\\', "/");
        let clean = format!("sh -c 'echo ran > \"{marker}\"; cat'");
        run(&["config", "filter.probe.clean", &clean]);
        // As git-crypt writes its filter: required, which must not turn into a failed status.
        run(&["config", "filter.probe.required", "true"]);
        // The same length at another time: only then does Git need the filter to compare.
        std::fs::write(top.join("a.txt"), "two\n").unwrap();
        std::fs::File::options()
            .write(true)
            .open(top.join("a.txt"))
            .unwrap()
            .set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(3600))
            .unwrap();

        let status = parse(&top, &status_output(&top).unwrap());
        assert!(!top.join("filter-ran").exists(), "the filter ran");
        assert_eq!(status.changes.len(), 1);
        // Matching a SonarQube analysis compares with a commit the same way.
        let head = String::from_utf8(run(&["rev-parse", "HEAD"])).unwrap();
        let changed = tauri::async_runtime::block_on(git_changed_since(
            crate::directory::display(&top),
            head.trim().to_owned(),
        ))
        .unwrap();
        assert!(!top.join("filter-ran").exists(), "the filter ran for diff");
        assert_eq!(changed.len(), 1);

        // The check is worth something only if plain Git would have run it.
        git(&top, &["status", "--porcelain=v2"]).unwrap();
        assert!(top.join("filter-ran").exists());

        run(&["config", "filter.a=b.clean", "x"]);
        assert!(status_output(&top).is_err());
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
    fn an_analyzed_commit_its_text_and_the_files_changed_since() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let run = |args: &[&str]| git(&root, args);
        if run(&["init", "-q", "-b", "main"]).is_err() {
            eprintln!("git is not installed; skipped");
            return;
        }
        run(&["config", "user.email", "t@example.invalid"]).unwrap();
        run(&["config", "user.name", "Mozaik test"]).unwrap();
        std::fs::write(root.join("a.cpp"), "int a;\n").unwrap();
        std::fs::write(root.join("b.cpp"), "int b;\n").unwrap();
        run(&["add", "-A"]).unwrap();
        run(&["commit", "-q", "-m", "analyzed"]).unwrap();
        let analyzed = String::from_utf8(run(&["rev-parse", "HEAD"]).unwrap())
            .unwrap()
            .trim()
            .to_owned();
        std::fs::write(root.join("a.cpp"), "// new\nint a;\n").unwrap();
        run(&["commit", "-q", "-am", "later"]).unwrap();
        std::fs::write(root.join("b.cpp"), "int c;\n").unwrap();

        let project = crate::directory::display(&root);
        use tauri::async_runtime::block_on as block;
        assert!(block(git_has_commit(project.clone(), analyzed.clone())).unwrap());
        assert!(block(git_has_commit(project.clone(), analyzed[..10].to_owned())).unwrap());
        assert!(!block(git_has_commit(project.clone(), "0123456789abcdef".into())).unwrap());
        // Only commit names: no options, ranges or other revision expressions.
        for bad in ["--all", "HEAD", "HEAD~1", "abc", "abcdef0..abcdef1"] {
            assert!(
                block(git_has_commit(project.clone(), bad.into())).is_err(),
                "{bad}"
            );
        }
        let a = crate::directory::display(&root.join("a.cpp"));
        assert_eq!(
            block(git_revision_text(a, analyzed.clone()))
                .unwrap()
                .as_deref(),
            Some("int a;\n")
        );
        // The graph's view of the later commit: its files and both sides of them.
        let later = String::from_utf8(run(&["rev-parse", "HEAD"]).unwrap())
            .unwrap()
            .trim()
            .to_owned();
        let a_path = crate::directory::display(&root.join("a.cpp"));
        let files = block(git_commit_files(project.clone(), later.clone())).unwrap();
        assert_eq!(
            files,
            [CommitFile {
                path: a_path.clone(),
                old_path: None,
                status: 'M'
            }]
        );
        assert_eq!(
            block(git_commit_files(project.clone(), analyzed.clone()))
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            block(git_commit_text(project.clone(), later, a_path.clone()))
                .unwrap()
                .as_deref(),
            Some("// new\nint a;\n")
        );
        let gone = crate::directory::display(&root.join("gone/x.cpp"));
        assert_eq!(
            block(git_commit_text(project.clone(), analyzed.clone(), gone)).unwrap(),
            None
        );
        let outside = crate::directory::display(&root.join("../x.cpp"));
        assert!(block(git_commit_text(project.clone(), analyzed.clone(), outside)).is_err());
        let mut changed = block(git_changed_since(project, analyzed)).unwrap();
        changed.sort();
        assert_eq!(
            changed,
            [
                crate::directory::display(&root.join("a.cpp")),
                crate::directory::display(&root.join("b.cpp"))
            ]
        );
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
