use crate::files::atomic_write;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex, MutexGuard, PoisonError,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::Duration,
};
use tauri::{Manager, State, WebviewWindow, ipc::Channel};

// Output waiting for xterm.js to process, in UTF-16 code units (the unit the renderer acks).
// Above this the PTY reader stops reading, so the child blocks instead of flooding the UI.
const HIGH_WATER: usize = 512 * 1024;
const READ_CHUNK: usize = 64 * 1024;
// Time a hung-up shell gets to exit before it is terminated forcefully.
const CLOSE_GRACE: Duration = Duration::from_millis(1500);

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TerminalEvent {
    Data {
        data: String,
    },
    Exit {
        code: Option<u32>,
        signal: Option<String>,
    },
}

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct Shell {
    pub id: String,
    pub name: String,
    #[serde(skip)]
    args: Vec<String>,
    /// Variables set for this program only (a CMake kit's environment).
    #[serde(skip)]
    env: Vec<(String, String)>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Incremental UTF-8 decoding: PTY reads can split a character across chunks.
#[derive(Default)]
struct Utf8Stream {
    pending: Vec<u8>,
}
impl Utf8Stream {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut text = String::new();
        let mut rest: &[u8] = &self.pending;
        loop {
            match std::str::from_utf8(rest) {
                Ok(valid) => {
                    text.push_str(valid);
                    rest = &[];
                    break;
                }
                Err(error) => {
                    let (valid, after) = rest.split_at(error.valid_up_to());
                    text.push_str(std::str::from_utf8(valid).unwrap_or_default());
                    match error.error_len() {
                        Some(length) => {
                            text.push(char::REPLACEMENT_CHARACTER);
                            rest = &after[length..];
                        }
                        None => {
                            rest = after;
                            break;
                        }
                    }
                }
            }
        }
        self.pending = rest.to_vec();
        text
    }
    fn finish(&mut self) -> String {
        if self.pending.is_empty() {
            String::new()
        } else {
            self.pending.clear();
            char::REPLACEMENT_CHARACTER.to_string()
        }
    }
}

#[derive(Default)]
struct Flow {
    pending: Mutex<usize>,
    ready: Condvar,
    closed: AtomicBool,
}
impl Flow {
    /// Blocks while the renderer is behind; returns false once the session is closing.
    fn reserve(&self, size: usize) -> bool {
        let mut pending = lock(&self.pending);
        while *pending >= HIGH_WATER && !self.closed.load(Ordering::SeqCst) {
            pending = self
                .ready
                .wait(pending)
                .unwrap_or_else(PoisonError::into_inner);
        }
        if self.closed.load(Ordering::SeqCst) {
            return false;
        }
        *pending += size;
        true
    }
    fn ack(&self, size: usize) {
        let mut pending = lock(&self.pending);
        *pending = pending.saturating_sub(size);
        self.ready.notify_all();
    }
    fn close(&self) {
        let _pending = lock(&self.pending);
        self.closed.store(true, Ordering::SeqCst);
        self.ready.notify_all();
    }
}

struct Session {
    window: String,
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    #[cfg_attr(windows, allow(dead_code))]
    pid: Option<u32>,
    exited: Arc<(Mutex<bool>, Condvar)>,
    flow: Arc<Flow>,
}
impl Session {
    fn wait_exit(&self, timeout: Duration) -> bool {
        let (exited, changed) = &*self.exited;
        let guard = lock(exited);
        let (guard, _) = changed
            .wait_timeout_while(guard, timeout, |done| !*done)
            .unwrap_or_else(PoisonError::into_inner);
        *guard
    }
    /// Hang up first so the shell and its job can exit normally, then terminate it.
    fn shutdown(&self) {
        self.flow.close();
        lock(&self.input).take();
        // Linux: closing the master sends SIGHUP to the terminal's foreground process group.
        // Windows: ClosePseudoConsole sends CTRL_CLOSE_EVENT to attached console clients.
        let master = lock(&self.master).take();
        drop(master);
        #[cfg(unix)]
        if !self.wait_exit(Duration::ZERO) {
            let _ = lock(&self.killer).kill();
        }
        if self.wait_exit(CLOSE_GRACE) {
            return;
        }
        #[cfg(unix)]
        if let Some(pid) = self.pid
            && !*lock(&self.exited.0)
        {
            // The waiter thread has not reaped the child, so the PID still belongs to it.
            unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        }
        #[cfg(windows)]
        let _ = lock(&self.killer).kill();
    }
}

#[derive(Clone, Default)]
pub struct TerminalSessions {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
}
impl TerminalSessions {
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &self,
        window: &str,
        id: &str,
        shell: &Shell,
        cwd: &Path,
        cols: u16,
        rows: u16,
        sink: impl Fn(TerminalEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid terminal session ID")?;
        let size = valid_size(cols, rows)?;
        if lock(&self.sessions).contains_key(id) {
            return Err("Terminal session already exists".into());
        }
        let pair = native_pty_system()
            .openpty(size)
            .map_err(|e| format!("Could not create a terminal: {e}"))?;
        let mut command = CommandBuilder::new(&shell.id);
        command.args(&shell.args);
        command.cwd(cwd);
        for (name, value) in &shell.env {
            command.env(name, value);
        }
        if cfg!(unix) {
            command.env("TERM", "xterm-256color");
            command.env("COLORTERM", "truecolor");
        }
        let mut child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| format!("Could not start {}: {e}", shell.name))?;
        // Only the child may hold the slave side, or the terminal never reports end of output.
        drop(pair.slave);
        let opened = (|| -> Result<_, String> {
            let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
            let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
            Ok((reader, writer))
        })();
        let (mut reader, mut writer) = match opened {
            Ok(io) => io,
            Err(error) => {
                let _ = child.kill();
                return Err(format!("Could not connect to the terminal: {error}"));
            }
        };
        let sink = Arc::new(sink);
        let flow = Arc::new(Flow::default());
        let exited = Arc::new((Mutex::new(false), Condvar::new()));
        let master = Arc::new(Mutex::new(Some(pair.master)));
        let (input, inbox) = mpsc::channel::<Vec<u8>>();
        let session = Arc::new(Session {
            window: window.to_owned(),
            input: Mutex::new(Some(input)),
            master: master.clone(),
            killer: Mutex::new(child.clone_killer()),
            pid: child.process_id(),
            exited: exited.clone(),
            flow: flow.clone(),
        });
        lock(&self.sessions).insert(id.to_owned(), session);

        thread::Builder::new()
            .name("terminal-input".into())
            .spawn(move || {
                for data in inbox {
                    if writer
                        .write_all(&data)
                        .and_then(|_| writer.flush())
                        .is_err()
                    {
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;

        let (finished, reader_done) = mpsc::channel::<()>();
        let output = sink.clone();
        thread::Builder::new()
            .name("terminal-output".into())
            .spawn(move || {
                let mut buffer = vec![0; READ_CHUNK];
                let mut decoder = Utf8Stream::default();
                loop {
                    let read = match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read) => read,
                        Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                        Err(_) => break,
                    };
                    let data = decoder.push(&buffer[..read]);
                    // Keep draining after close so ConPTY teardown is never blocked on output.
                    if !data.is_empty() && flow.reserve(data.encode_utf16().count()) {
                        output(TerminalEvent::Data { data });
                    }
                }
                let data = decoder.finish();
                if !data.is_empty() && !flow.closed.load(Ordering::SeqCst) {
                    output(TerminalEvent::Data { data });
                }
                let _ = finished.send(());
            })
            .map_err(|e| e.to_string())?;

        thread::Builder::new()
            .name("terminal-wait".into())
            .spawn(move || {
                let status = child.wait();
                {
                    let (done, changed) = &*exited;
                    *lock(done) = true;
                    changed.notify_all();
                }
                // ConPTY keeps the output pipe open after the shell exits until it is closed.
                let closed = lock(&master).take();
                drop(closed);
                // A background job can keep the terminal open; do not wait for it forever.
                let _ = reader_done.recv_timeout(Duration::from_secs(2));
                sink(match status {
                    Ok(status) => TerminalEvent::Exit {
                        code: status.signal().is_none().then(|| status.exit_code()),
                        signal: status.signal().map(str::to_owned),
                    },
                    Err(_) => TerminalEvent::Exit {
                        code: None,
                        signal: None,
                    },
                });
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    fn get(&self, window: &str, id: &str) -> Result<Arc<Session>, String> {
        lock(&self.sessions)
            .get(id)
            .filter(|session| session.window == window)
            .cloned()
            .ok_or_else(|| "Unknown terminal session".into())
    }
    pub fn write(&self, window: &str, id: &str, data: &str) -> Result<(), String> {
        let session = self.get(window, id)?;
        if let Some(input) = &*lock(&session.input) {
            // A send error means the shell has exited; the renderer shows that state separately.
            let _ = input.send(data.as_bytes().to_vec());
        }
        Ok(())
    }
    pub fn resize(&self, window: &str, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let size = valid_size(cols, rows)?;
        let session = self.get(window, id)?;
        if let Some(master) = &*lock(&session.master) {
            master.resize(size).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn ack(&self, window: &str, id: &str, size: usize) -> Result<(), String> {
        self.get(window, id)?.flow.ack(size);
        Ok(())
    }
    /// Idempotent: closing an unknown or already closed session succeeds.
    pub fn close(&self, window: &str, id: &str) -> thread::JoinHandle<()> {
        let session = {
            let mut sessions = lock(&self.sessions);
            match sessions.get(id) {
                Some(session) if session.window == window => sessions.remove(id),
                _ => None,
            }
        };
        thread::spawn(move || {
            if let Some(session) = session {
                session.shutdown();
            }
        })
    }
    fn close_where(&self, keep: impl Fn(&Session) -> bool) -> Vec<thread::JoinHandle<()>> {
        let mut closing = Vec::new();
        lock(&self.sessions).retain(|_, session| {
            keep(session) || {
                closing.push(session.clone());
                false
            }
        });
        closing
            .into_iter()
            .map(|session| thread::spawn(move || session.shutdown()))
            .collect()
    }
    pub fn close_window(&self, window: &str) {
        self.close_where(|session| session.window != window);
    }
    /// Used at application exit: wait so child processes do not outlive Mozaik.
    pub fn close_all(&self) {
        for handle in self.close_where(|_| false) {
            let _ = handle.join();
        }
    }
}

fn valid_size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if !(2..=1000).contains(&cols) || !(1..=500).contains(&rows) {
        return Err("Invalid terminal size".into());
    }
    Ok(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
}

fn shell(path: &Path) -> Shell {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let (name, args): (&str, Vec<&'static str>) = match stem.as_str() {
        "bash" if cfg!(windows) => ("Git Bash", vec!["--login", "-i"]),
        "bash" => ("Bash", vec![]),
        "zsh" => ("Zsh", vec![]),
        "fish" => ("Fish", vec![]),
        "pwsh" => ("PowerShell", vec!["-NoLogo"]),
        "powershell" => ("Windows PowerShell", vec!["-NoLogo"]),
        "cmd" => ("Command Prompt", vec![]),
        other => (other, vec![]),
    };
    Shell {
        id: path.to_string_lossy().into_owned(),
        name: name.to_owned(),
        args: args.into_iter().map(str::to_owned).collect(),
        env: Vec::new(),
    }
}

fn unique(paths: impl IntoIterator<Item = PathBuf>) -> Vec<Shell> {
    let mut seen = Vec::new();
    let mut shells = Vec::new();
    for path in paths {
        if !executable(&path) {
            continue;
        }
        let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen.contains(&canonical) {
            seen.push(canonical);
            shells.push(shell(&path));
        }
    }
    shells
}

#[cfg(unix)]
fn executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.is_absolute()
        && fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        && !matches!(
            path.file_name().and_then(|n| n.to_str()),
            Some("nologin" | "false" | "true")
        )
}
#[cfg(windows)]
fn executable(path: &Path) -> bool {
    path.is_absolute() && fs::metadata(path).is_ok_and(|m| m.is_file())
}

/// The login shell from the user database; `SHELL` alone can be stale or inherited.
#[cfg(unix)]
fn login_shell() -> Option<PathBuf> {
    use std::{ffi::CStr, os::unix::ffi::OsStrExt};
    let mut entry: libc::passwd = unsafe { std::mem::zeroed() };
    let mut buffer = vec![0 as libc::c_char; 16 * 1024];
    let mut result = std::ptr::null_mut();
    let status = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            &mut entry,
            buffer.as_mut_ptr(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() || entry.pw_shell.is_null() {
        return None;
    }
    let shell = unsafe { CStr::from_ptr(entry.pw_shell) };
    Some(PathBuf::from(std::ffi::OsStr::from_bytes(shell.to_bytes())))
}

#[cfg(unix)]
fn candidates() -> (Vec<PathBuf>, Vec<PathBuf>) {
    let listed: Vec<PathBuf> = fs::read_to_string("/etc/shells")
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('/'))
        .map(PathBuf::from)
        .collect();
    let mut preferred: Vec<PathBuf> = login_shell().into_iter().collect();
    if let Some(shell) = std::env::var_os("SHELL").map(PathBuf::from)
        && listed.contains(&shell)
    {
        preferred.push(shell);
    }
    preferred.extend(["/bin/bash", "/usr/bin/bash", "/bin/sh"].map(PathBuf::from));
    let mut all = listed;
    all.extend(preferred.iter().cloned());
    (all, preferred)
}

#[cfg(windows)]
fn candidates() -> (Vec<PathBuf>, Vec<PathBuf>) {
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let system = env("SystemRoot")
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    let program_files = env("ProgramFiles").unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let mut all: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .map(|dir| dir.join("pwsh.exe"))
                .collect()
        })
        .unwrap_or_default();
    all.push(program_files.join(r"PowerShell\7\pwsh.exe"));
    all.push(system.join(r"WindowsPowerShell\v1.0\powershell.exe"));
    all.push(system.join("cmd.exe"));
    all.push(program_files.join(r"Git\bin\bash.exe"));
    // Windows has no per-user login shell; prefer PowerShell 7, then the built-in shells.
    let preferred = all.clone();
    (all, preferred)
}

pub fn available_shells() -> (Vec<Shell>, Option<String>) {
    let (all, preferred) = candidates();
    let shells = unique(all);
    let canonical = |path: &Path| fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let system = preferred
        .iter()
        .filter(|path| executable(path))
        .find_map(|path| {
            shells
                .iter()
                .find(|shell| canonical(Path::new(&shell.id)) == canonical(path))
        })
        .or(shells.first())
        .map(|shell| shell.id.clone());
    (shells, system)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("shell.json"))
}
fn stored_shell(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map(Some)
        .map_err(|_| "The stored default shell setting is damaged".into())
}

#[derive(Serialize)]
pub struct ShellChoices {
    shells: Vec<Shell>,
    selected: Option<String>,
    system: Option<String>,
}
#[tauri::command]
pub fn terminal_shells(app: tauri::AppHandle) -> Result<ShellChoices, String> {
    let (shells, system) = available_shells();
    Ok(ShellChoices {
        shells,
        selected: stored_shell(&app)?,
        system,
    })
}
#[tauri::command]
pub fn set_default_shell(app: tauri::AppHandle, shell: String) -> Result<(), String> {
    if !available_shells().0.iter().any(|s| s.id == shell) {
        return Err("That shell is not available on this system".into());
    }
    let path = settings_path(&app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec(&shell).map_err(|e| e.to_string())?,
    )
}

/// An explicit `shell` must be one Mozaik detected: the renderer cannot run arbitrary programs.
fn resolve_shell(app: &tauri::AppHandle, requested: Option<String>) -> Result<Shell, String> {
    let (shells, system) = available_shells();
    let find = |id: &str| shells.iter().find(|s| s.id == id).cloned();
    if let Some(id) = requested {
        return find(&id).ok_or_else(|| "That shell is not available on this system".into());
    }
    match stored_shell(app)? {
        Some(id) => find(&id).ok_or_else(|| {
            format!(
                "The default shell {id} is no longer available. Choose another shell in Settings (Ctrl+,)."
            )
        }),
        None => system
            .and_then(|id| find(&id))
            .ok_or_else(|| "No supported shell was found on this system".into()),
    }
}

fn project_directory(directory: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(directory);
    if !path.is_absolute() || !path.is_dir() {
        return Err(format!("The folder {directory} is not accessible"));
    }
    Ok(path)
}

/// Terminals start in the home directory; an IDE terminal starts in its project folder,
/// which must be an existing absolute directory (it is only a working directory, never run).
fn start_directory(app: &tauri::AppHandle, directory: Option<String>) -> Result<PathBuf, String> {
    if let Some(directory) = directory {
        return project_directory(&directory);
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "Could not determine the home directory")?;
    if !home.is_dir() {
        return Err(format!(
            "The home directory {} is not accessible",
            home.display()
        ));
    }
    Ok(home)
}

#[derive(serde::Deserialize)]
pub struct RunTarget {
    root: String,
    target: String,
}
#[derive(Serialize)]
pub struct Started {
    shell: String,
    cwd: String,
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_terminal(
    app: tauri::AppHandle,
    window: WebviewWindow,
    sessions: State<'_, TerminalSessions>,
    id: String,
    shell: Option<String>,
    directory: Option<String>,
    run: Option<RunTarget>,
    cols: u16,
    rows: u16,
    events: Channel<TerminalEvent>,
) -> Result<Started, String> {
    let sessions = sessions.inner().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let (shell, cwd) = match run {
            // A program CMake built: Rust finds it from the target name, never a path.
            Some(run) => {
                let launch = crate::cmake::run_launch(&app, &run.root, &run.target)?;
                let shell = Shell {
                    id: launch.program.to_string_lossy().into_owned(),
                    name: run.target,
                    args: launch.args,
                    env: launch.env,
                };
                (shell, launch.cwd)
            }
            None => (
                resolve_shell(&app, shell)?,
                start_directory(&app, directory)?,
            ),
        };
        // A canonical `\\?\C:\…` folder makes Command Prompt fall back to the Windows
        // folder and PowerShell show a provider path: shells get the plain one.
        let cwd = crate::git::plain(&cwd);
        sessions.start(&label, &id, &shell, &cwd, cols, rows, move |event| {
            // The renderer may already be gone; the session is closed through its own path.
            let _ = events.send(event);
        })?;
        Ok(Started {
            shell: shell.name,
            cwd: cwd.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn write_terminal(
    window: WebviewWindow,
    sessions: State<TerminalSessions>,
    id: String,
    data: String,
) -> Result<(), String> {
    sessions.write(window.label(), &id, &data)
}
#[tauri::command]
pub fn resize_terminal(
    window: WebviewWindow,
    sessions: State<TerminalSessions>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    sessions.resize(window.label(), &id, cols, rows)
}
#[tauri::command]
pub fn ack_terminal(
    window: WebviewWindow,
    sessions: State<TerminalSessions>,
    id: String,
    size: usize,
) -> Result<(), String> {
    sessions.ack(window.label(), &id, size)
}
#[tauri::command]
pub fn close_terminal(window: WebviewWindow, sessions: State<TerminalSessions>, id: String) {
    sessions.close(window.label(), &id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;

    #[test]
    fn project_terminals_start_only_in_existing_absolute_folders() {
        let folder = std::env::temp_dir();
        assert_eq!(project_directory(folder.to_str().unwrap()).unwrap(), folder);
        assert!(project_directory("relative/folder").is_err());
        assert!(project_directory(folder.join("mozaik-missing-folder").to_str().unwrap()).is_err());
        let file = folder.join("mozaik-terminal-file.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(project_directory(file.to_str().unwrap()).is_err());
        std::fs::remove_file(file).unwrap();
    }

    #[test]
    fn utf8_stream_joins_split_characters_and_replaces_invalid_bytes() {
        let mut stream = Utf8Stream::default();
        let bytes = "aé€😀".as_bytes();
        let mut text = String::new();
        for byte in bytes {
            text.push_str(&stream.push(&[*byte]));
        }
        assert_eq!(text, "aé€😀");
        assert_eq!(stream.push(b"x\xffy"), "x\u{fffd}y");
        assert_eq!(stream.push(&"€".as_bytes()[..2]), "");
        assert_eq!(stream.finish(), "\u{fffd}");
        assert_eq!(stream.finish(), "");
    }

    #[test]
    fn flow_blocks_until_acknowledged_and_releases_on_close() {
        let flow = Arc::new(Flow::default());
        assert!(flow.reserve(HIGH_WATER));
        let waiting = flow.clone();
        let blocked = thread::spawn(move || waiting.reserve(10));
        thread::sleep(Duration::from_millis(50));
        assert!(!blocked.is_finished());
        flow.ack(HIGH_WATER);
        assert!(blocked.join().unwrap());

        assert!(flow.reserve(HIGH_WATER));
        let waiting = flow.clone();
        let blocked = thread::spawn(move || waiting.reserve(10));
        thread::sleep(Duration::from_millis(50));
        flow.close();
        assert!(!blocked.join().unwrap());
    }

    #[test]
    fn invalid_ids_sizes_and_foreign_windows_are_rejected() {
        let sessions = TerminalSessions::default();
        let (shells, _) = available_shells();
        let shell = &shells[0];
        let home = std::env::temp_dir();
        assert!(
            sessions
                .start("main", "../x", shell, &home, 80, 24, |_| {})
                .is_err()
        );
        let id = uuid::Uuid::new_v4().to_string();
        assert!(
            sessions
                .start("main", &id, shell, &home, 0, 24, |_| {})
                .is_err()
        );
        assert!(sessions.write("main", &id, "x").is_err());
        assert!(sessions.resize("main", &id, 80, 24).is_err());
        sessions.close("main", &id).join().unwrap();
    }

    #[test]
    fn shells_are_detected_with_a_system_default() {
        let (shells, system) = available_shells();
        assert!(!shells.is_empty());
        let system = system.expect("a default shell");
        assert!(shells.iter().any(|s| s.id == system));
        assert_eq!(shell(Path::new("/usr/bin/zsh")).name, "Zsh");
        assert_eq!(shell(Path::new(r"C:\x\pwsh.exe")).args, vec!["-NoLogo"]);
    }

    fn quick_shell() -> Shell {
        let (shells, _) = available_shells();
        let name = if cfg!(windows) { "cmd" } else { "sh" };
        shells
            .into_iter()
            .find(|s| {
                Path::new(&s.id)
                    .file_stem()
                    .is_some_and(|stem| stem.eq_ignore_ascii_case(name))
            })
            .expect("a basic shell")
    }
    fn collect(
        events: &mpsc::Receiver<TerminalEvent>,
        until: impl Fn(&str, bool) -> bool,
    ) -> (String, bool) {
        let deadline = Instant::now() + Duration::from_secs(20);
        let (mut text, mut exited) = (String::new(), false);
        while !until(&text, exited) && Instant::now() < deadline {
            match events.recv_timeout(Duration::from_millis(200)) {
                Ok(TerminalEvent::Data { data }) => text.push_str(&data),
                Ok(TerminalEvent::Exit { .. }) => exited = true,
                Err(_) => (),
            }
        }
        (text, exited)
    }

    #[test]
    fn interactive_shell_runs_commands_and_reports_exit() {
        let sessions = TerminalSessions::default();
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, events) = mpsc::channel();
        let sender = Mutex::new(sender);
        sessions
            .start(
                "main",
                &id,
                &quick_shell(),
                &std::env::temp_dir(),
                80,
                24,
                move |event| {
                    let _ = lock(&sender).send(event);
                },
            )
            .unwrap();
        assert!(sessions.write("other", &id, "x").is_err());
        sessions.resize("main", &id, 100, 30).unwrap();
        if cfg!(windows) {
            // ConPTY asks for the cursor position at startup; xterm.js answers it in the app.
            collect(&events, |text, _| text.contains("\x1b[6n"));
            sessions.write("main", &id, "\x1b[1;1R").unwrap();
        }
        // The expected text differs from the echoed input, so it proves the shell ran it.
        let (command, expected) = if cfg!(windows) {
            ("set /a 6*7+1000\r", "1042")
        } else {
            ("echo mozaik-$((6*7))\r", "mozaik-42")
        };
        sessions.write("main", &id, command).unwrap();
        let (text, _) = collect(&events, |text, _| text.contains(expected));
        assert!(text.contains(expected), "missing command output: {text:?}");
        sessions.write("main", &id, "exit 3\r").unwrap();
        let (_, exited) = collect(&events, |_, exited| exited);
        assert!(exited, "shell exit was not reported");
        sessions.close("main", &id).join().unwrap();
        sessions.close("main", &id).join().unwrap();
        assert!(sessions.write("main", &id, "x").is_err());
    }

    #[test]
    fn closing_terminates_a_running_shell_and_window_cleanup_closes_all() {
        let sessions = TerminalSessions::default();
        let (sender, events) = mpsc::channel();
        let sender = Arc::new(Mutex::new(sender));
        let ids: Vec<_> = (0..3).map(|_| uuid::Uuid::new_v4().to_string()).collect();
        for (index, id) in ids.iter().enumerate() {
            let sender = sender.clone();
            let window = if index == 2 { "other" } else { "main" };
            sessions
                .start(
                    window,
                    id,
                    &quick_shell(),
                    &std::env::temp_dir(),
                    80,
                    24,
                    move |event| {
                        if matches!(event, TerminalEvent::Exit { .. }) {
                            let _ = lock(&sender).send(event);
                        }
                    },
                )
                .unwrap();
        }
        sessions.close("main", &ids[0]).join().unwrap();
        assert!(events.recv_timeout(Duration::from_secs(10)).is_ok());
        sessions.close_window("main");
        assert!(events.recv_timeout(Duration::from_secs(10)).is_ok());
        assert!(sessions.write("other", &ids[2], "x").is_ok());
        sessions.close_all();
        assert!(events.recv_timeout(Duration::from_secs(10)).is_ok());
        assert!(lock(&sessions.sessions).is_empty());
    }
}
