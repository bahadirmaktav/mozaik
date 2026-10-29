use crate::files::atomic_write;
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    env, fs,
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, ExitStatus, Stdio},
    sync::{Arc, Mutex, MutexGuard, PoisonError, mpsc},
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, State, WebviewWindow, ipc::Channel};

// Language servers send whole documents and symbol lists; this only guards allocations.
const MAX_MESSAGE: usize = 64 * 1024 * 1024;
// Time a server gets to exit after its input closes before it is terminated.
const CLOSE_GRACE: Duration = Duration::from_millis(1500);
const STDERR_LINES: usize = 20;

/// The language servers Tessera knows how to start. The renderer names one of these; it can
/// never pass a program path or arguments.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Server {
    Clangd,
}
impl Server {
    fn parse(id: &str) -> Result<Self, String> {
        match id {
            "clangd" => Ok(Self::Clangd),
            _ => Err("Unknown language server".into()),
        }
    }
    fn id(self) -> &'static str {
        match self {
            Self::Clangd => "clangd",
        }
    }
    fn languages(self) -> &'static str {
        match self {
            Self::Clangd => "C/C++",
        }
    }
    fn program(self) -> &'static str {
        match self {
            Self::Clangd if cfg!(windows) => "clangd.exe",
            Self::Clangd => "clangd",
        }
    }
    fn fallbacks(self) -> Vec<PathBuf> {
        match self {
            Self::Clangd if cfg!(windows) => ["ProgramFiles", "ProgramFiles(x86)"]
                .iter()
                .filter_map(env::var_os)
                .map(|dir| PathBuf::from(dir).join(r"LLVM\bin\clangd.exe"))
                .collect(),
            Self::Clangd => (12..=30)
                .rev()
                .flat_map(|v| {
                    [
                        PathBuf::from(format!("/usr/bin/clangd-{v}")),
                        PathBuf::from(format!("/usr/lib/llvm-{v}/bin/clangd")),
                    ]
                })
                .collect(),
        }
    }
}

fn executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.is_absolute()
            && fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(windows)]
    {
        path.is_absolute() && fs::metadata(path).is_ok_and(|m| m.is_file())
    }
}
fn on_path(program: &str) -> Option<PathBuf> {
    env::split_paths(&env::var_os("PATH")?)
        .map(|dir| dir.join(program))
        .find(|path| executable(path))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("language-servers.json"))
}
fn configured(app: &tauri::AppHandle) -> Result<BTreeMap<String, PathBuf>, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|_| "The language server settings are damaged".into())
}
fn store(app: &tauri::AppHandle, all: &BTreeMap<String, PathBuf>) -> Result<(), String> {
    let path = settings_path(app)?;
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(all).map_err(|e| e.to_string())?,
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    id: &'static str,
    languages: &'static str,
    /// The program that will run, or `None` when none was found.
    path: Option<String>,
    /// Chosen in settings rather than found on `PATH`.
    configured: bool,
}
fn info(app: &tauri::AppHandle, server: Server) -> Result<ServerInfo, String> {
    let chosen = configured(app)?.remove(server.id());
    let configured = chosen.is_some();
    let path = match chosen {
        Some(path) => executable(&path).then_some(path),
        None => on_path(server.program())
            .or_else(|| server.fallbacks().into_iter().find(|p| executable(p))),
    };
    Ok(ServerInfo {
        id: server.id(),
        languages: server.languages(),
        path: path.map(|p| p.to_string_lossy().into_owned()),
        configured,
    })
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LspEvent {
    Message { data: String },
    Exit { code: Option<i32>, log: String },
}

/// Reads one `Content-Length` framed message; `None` at a clean end of the stream.
pub fn read_message(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut length = None;
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return if length.is_none() {
                Ok(None)
            } else {
                Err(io::ErrorKind::UnexpectedEof.into())
            };
        }
        let header = line.trim_end_matches(['\r', '\n']);
        if header.is_empty() {
            if length.is_some() {
                break;
            }
            continue;
        }
        if let Some((name, value)) = header.split_once(':')
            && name.eq_ignore_ascii_case("content-length")
        {
            let value: usize = value
                .trim()
                .parse()
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Bad Content-Length"))?;
            if value > MAX_MESSAGE {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Message too large",
                ));
            }
            length = Some(value);
        }
    }
    let mut body = vec![0; length.unwrap_or(0)];
    reader.read_exact(&mut body)?;
    String::from_utf8(body)
        .map(Some)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Message is not UTF-8"))
}
pub fn frame(message: &str) -> Vec<u8> {
    let mut bytes = format!("Content-Length: {}\r\n\r\n", message.len()).into_bytes();
    bytes.extend_from_slice(message.as_bytes());
    bytes
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
fn wait(child: &Mutex<Child>, timeout: Duration) -> Option<ExitStatus> {
    let start = Instant::now();
    loop {
        if let Ok(Some(status)) = lock(child).try_wait() {
            return Some(status);
        }
        if start.elapsed() >= timeout {
            return None;
        }
        thread::sleep(Duration::from_millis(25));
    }
}

struct Process {
    window: String,
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    child: Arc<Mutex<Child>>,
}
impl Process {
    /// Closing the input asks the server to exit; one that does not is terminated.
    fn shutdown(&self) {
        lock(&self.input).take();
        if wait(&self.child, CLOSE_GRACE).is_none() {
            let _ = lock(&self.child).kill();
            let _ = lock(&self.child).wait();
        }
    }
}

/// Language server processes, each owned by one window like terminal sessions.
#[derive(Clone, Default)]
pub struct LanguageServers {
    processes: Arc<Mutex<HashMap<String, Arc<Process>>>>,
}
impl LanguageServers {
    pub fn start(
        &self,
        window: &str,
        id: &str,
        program: &Path,
        root: &Path,
        sink: impl Fn(LspEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid language server ID")?;
        if lock(&self.processes).contains_key(id) {
            return Err("Language server already exists".into());
        }
        let mut command = Command::new(program);
        command
            .current_dir(crate::git::plain(root))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Could not start {}: {e}", program.display()))?;
        let stdin: ChildStdin = child.stdin.take().ok_or("No server input")?;
        let stdout = child.stdout.take().ok_or("No server output")?;
        let stderr = child.stderr.take().ok_or("No server log")?;
        let child = Arc::new(Mutex::new(child));
        let (sender, receiver) = mpsc::channel::<Vec<u8>>();
        thread::Builder::new()
            .name("lsp-input".into())
            .spawn(move || {
                let mut stdin = stdin;
                for bytes in receiver {
                    if stdin.write_all(&bytes).and_then(|_| stdin.flush()).is_err() {
                        break;
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        // Servers log freely to stderr; it must be drained or they block. The tail explains
        // an unexpected exit.
        let log = Arc::new(Mutex::new(VecDeque::new()));
        let tail = log.clone();
        thread::Builder::new()
            .name("lsp-log".into())
            .spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    let mut tail = lock(&tail);
                    if tail.len() == STDERR_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
            })
            .map_err(|e| e.to_string())?;
        let process = Arc::new(Process {
            window: window.to_owned(),
            input: Mutex::new(Some(sender)),
            child: child.clone(),
        });
        lock(&self.processes).insert(id.to_owned(), process);
        let processes = self.processes.clone();
        let key = id.to_owned();
        thread::Builder::new()
            .name("lsp-output".into())
            .spawn(move || {
                let mut reader = BufReader::new(stdout);
                while let Ok(Some(data)) = read_message(&mut reader) {
                    sink(LspEvent::Message { data });
                }
                let status = wait(&child, CLOSE_GRACE);
                lock(&processes).remove(&key);
                let log = lock(&log).iter().cloned().collect::<Vec<_>>().join("\n");
                sink(LspEvent::Exit {
                    code: status.and_then(|s| s.code()),
                    log,
                });
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn send(&self, window: &str, id: &str, message: &str) -> Result<(), String> {
        let process = lock(&self.processes)
            .get(id)
            .filter(|p| p.window == window)
            .cloned()
            .ok_or("The language server is not running")?;
        let input = lock(&process.input);
        input
            .as_ref()
            .and_then(|input| input.send(frame(message)).ok())
            .ok_or_else(|| "The language server is not running".into())
    }
    pub fn stop(&self, window: &str, id: &str) {
        let process = {
            let mut processes = lock(&self.processes);
            match processes.get(id) {
                Some(p) if p.window == window => processes.remove(id),
                _ => None,
            }
        };
        if let Some(process) = process {
            thread::spawn(move || process.shutdown());
        }
    }
    fn stop_where(&self, keep: impl Fn(&Process) -> bool) -> Vec<thread::JoinHandle<()>> {
        let mut stopping = Vec::new();
        lock(&self.processes).retain(|_, p| {
            keep(p) || {
                stopping.push(p.clone());
                false
            }
        });
        stopping
            .into_iter()
            .map(|p| thread::spawn(move || p.shutdown()))
            .collect()
    }
    pub fn close_window(&self, window: &str) {
        self.stop_where(|p| p.window != window);
    }
    /// At application exit: wait so servers do not outlive Tessera.
    pub fn close_all(&self) {
        for handle in self.stop_where(|_| false) {
            let _ = handle.join();
        }
    }
}

#[tauri::command]
pub fn lsp_servers(app: tauri::AppHandle) -> Result<Vec<ServerInfo>, String> {
    Ok(vec![info(&app, Server::Clangd)?])
}
/// Lets the user pick the server program in a native dialog; the path never comes from the
/// renderer.
#[tauri::command]
pub async fn lsp_choose_server(
    app: tauri::AppHandle,
    server: String,
) -> Result<Option<ServerInfo>, String> {
    let server = Server::parse(&server)?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title(format!("Choose the {} program", server.id()))
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().canonicalize().map_err(|e| e.to_string())?;
    if !executable(&path) {
        return Err("That file is not an executable program".into());
    }
    let mut all = configured(&app)?;
    all.insert(server.id().into(), path);
    store(&app, &all)?;
    info(&app, server).map(Some)
}
#[tauri::command]
pub fn lsp_reset_server(app: tauri::AppHandle, server: String) -> Result<ServerInfo, String> {
    let server = Server::parse(&server)?;
    let mut all = configured(&app)?;
    if all.remove(server.id()).is_some() {
        store(&app, &all)?;
    }
    info(&app, server)
}
#[tauri::command]
pub async fn lsp_start(
    app: tauri::AppHandle,
    window: WebviewWindow,
    servers: State<'_, LanguageServers>,
    id: String,
    server: String,
    root: String,
    events: Channel<LspEvent>,
) -> Result<String, String> {
    let server = Server::parse(&server)?;
    let root = crate::project::root(&root)?;
    let program = info(&app, server)?.path.ok_or_else(|| {
        format!(
            "{} was not found. Install it or choose it in settings.",
            server.id()
        )
    })?;
    let servers = servers.inner().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        servers.start(&label, &id, Path::new(&program), &root, move |event| {
            let _ = events.send(event);
        })?;
        Ok(program)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn lsp_send(
    window: WebviewWindow,
    servers: State<LanguageServers>,
    id: String,
    message: String,
) -> Result<(), String> {
    servers.send(window.label(), &id, &message)
}
#[tauri::command]
pub fn lsp_stop(window: WebviewWindow, servers: State<LanguageServers>, id: String) {
    servers.stop(window.label(), &id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn messages_are_framed_and_read_back() {
        let mut stream = frame(r#"{"id":1}"#);
        stream.extend(b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n");
        stream.extend(frame(r#"{"text":"ğ"}"#));
        let mut reader = BufReader::new(stream.as_slice());
        assert_eq!(read_message(&mut reader).unwrap().unwrap(), r#"{"id":1}"#);
        assert_eq!(
            read_message(&mut reader).unwrap().unwrap(),
            r#"{"text":"ğ"}"#
        );
        assert_eq!(read_message(&mut reader).unwrap(), None);
        let mut cut = BufReader::new(b"Content-Length: 10\r\n\r\n{}".as_slice());
        assert!(read_message(&mut cut).is_err());
        let mut huge = BufReader::new(b"Content-Length: 999999999999\r\n\r\n".as_slice());
        assert!(read_message(&mut huge).is_err());
    }

    #[test]
    fn unknown_servers_and_foreign_windows_are_rejected() {
        assert!(Server::parse("bash").is_err());
        let servers = LanguageServers::default();
        assert!(servers.send("main", "missing", "{}").is_err());
        let dir = tempfile::tempdir().unwrap();
        assert!(
            servers
                .start(
                    "main",
                    "not-a-uuid",
                    Path::new("clangd"),
                    dir.path(),
                    |_| ()
                )
                .is_err()
        );
    }

    /// Runs the real clangd when it is installed: initialize, then shut down on closing input.
    #[test]
    fn clangd_answers_initialize_when_installed() {
        let Some(program) = on_path(Server::Clangd.program()) else {
            eprintln!("clangd is not installed; skipped");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let servers = LanguageServers::default();
        let (sender, receiver) = mpsc::channel();
        let id = uuid::Uuid::new_v4().to_string();
        servers
            .start("main", &id, &program, dir.path(), move |event| {
                let _ = sender.send(event);
            })
            .unwrap();
        assert!(servers.send("other", &id, "{}").is_err());
        servers
            .send(
                "main",
                &id,
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}"#,
            )
            .unwrap();
        let reply = receiver.recv_timeout(Duration::from_secs(20)).unwrap();
        let LspEvent::Message { data } = reply else {
            panic!("{reply:?}")
        };
        assert!(data.contains(r#""id":1"#) && data.contains("capabilities"));
        servers.close_all();
        let exit = receiver.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(matches!(exit, LspEvent::Exit { .. }));
    }
}
