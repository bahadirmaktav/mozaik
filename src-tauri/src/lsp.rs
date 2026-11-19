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

/// The language servers Mozaik knows how to start. The renderer names one of these; it can
/// never pass a program path or arguments.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Server {
    Clangd,
    RustAnalyzer,
}
impl Server {
    const ALL: [Self; 2] = [Self::Clangd, Self::RustAnalyzer];
    fn parse(id: &str) -> Result<Self, String> {
        match id {
            "clangd" => Ok(Self::Clangd),
            "rust-analyzer" => Ok(Self::RustAnalyzer),
            _ => Err("Unknown language server".into()),
        }
    }
    fn id(self) -> &'static str {
        match self {
            Self::Clangd => "clangd",
            Self::RustAnalyzer => "rust-analyzer",
        }
    }
    fn languages(self) -> &'static str {
        match self {
            Self::Clangd => "C/C++",
            Self::RustAnalyzer => "Rust",
        }
    }
    fn program(self) -> &'static str {
        match self {
            Self::Clangd if cfg!(windows) => "clangd.exe",
            Self::Clangd => "clangd",
            Self::RustAnalyzer if cfg!(windows) => "rust-analyzer.exe",
            Self::RustAnalyzer => "rust-analyzer",
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
            // Found by `cargo::find_rust_analyzer`, which resolves rustup's proxy.
            Self::RustAnalyzer => Vec::new(),
        }
    }
}

pub fn executable(path: &Path) -> bool {
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
    /// Why a program that is there cannot run (rustup's proxy of a missing component).
    note: Option<String>,
}
/// The server's program; `cwd` is the project, whose toolchain rustup's proxy follows.
fn info_in(
    app: &tauri::AppHandle,
    server: Server,
    cwd: Option<&Path>,
) -> Result<ServerInfo, String> {
    let chosen = configured(app)?.remove(server.id());
    let configured = chosen.is_some();
    let mut note = None;
    let path = match chosen {
        Some(path) => executable(&path).then_some(path),
        None if server == Server::RustAnalyzer => {
            let found = crate::cargo::find_rust_analyzer(cwd);
            note = found.note;
            found.path
        }
        None => on_path(server.program())
            .or_else(|| server.fallbacks().into_iter().find(|p| executable(p))),
    };
    Ok(ServerInfo {
        id: server.id(),
        languages: server.languages(),
        path: path.map(|p| p.to_string_lossy().into_owned()),
        configured,
        note,
    })
}
fn info(app: &tauri::AppHandle, server: Server) -> Result<ServerInfo, String> {
    info_in(app, server, None)
}

/// The clangd that would run, for finding clang-tidy beside it.
pub fn clangd_program(app: &tauri::AppHandle) -> Option<PathBuf> {
    info(app, Server::Clangd).ok()?.path.map(PathBuf::from)
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

/// Changes or refuses a message on its way to the server; `Ok(None)` sends it as it is.
pub type Rewrite = Arc<dyn Fn(&str) -> Result<Option<String>, String> + Send + Sync>;

struct Process {
    window: String,
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    child: Arc<Mutex<Child>>,
    rewrite: Option<Rewrite>,
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
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &self,
        window: &str,
        id: &str,
        program: &Path,
        args: &[String],
        env: &[(String, String)],
        root: &Path,
        sink: impl Fn(LspEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        self.start_with(window, id, program, args, env, root, None, sink)
    }
    /// `start`, with every message from the renderer passing `rewrite` first.
    #[allow(clippy::too_many_arguments)]
    pub fn start_with(
        &self,
        window: &str,
        id: &str,
        program: &Path,
        args: &[String],
        env: &[(String, String)],
        root: &Path,
        rewrite: Option<Rewrite>,
        sink: impl Fn(LspEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid language server ID")?;
        if lock(&self.processes).contains_key(id) {
            return Err("Language server already exists".into());
        }
        let mut command = Command::new(program);
        command
            .args(args)
            .envs(env.iter().map(|(k, v)| (k, v)))
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
            rewrite,
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
        let process = self.process(window, id)?;
        let rewritten = match &process.rewrite {
            Some(rewrite) => rewrite(message)?,
            None => None,
        };
        Self::write(&process, rewritten.as_deref().unwrap_or(message))
    }
    /// A message from Rust itself, past the rewrite.
    fn send_raw(&self, window: &str, id: &str, message: &str) -> Result<(), String> {
        Self::write(&*self.process(window, id)?, message)
    }
    fn process(&self, window: &str, id: &str) -> Result<Arc<Process>, String> {
        lock(&self.processes)
            .get(id)
            .filter(|p| p.window == window)
            .cloned()
            .ok_or_else(|| "The language server is not running".into())
    }
    fn write(process: &Process, message: &str) -> Result<(), String> {
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
    /// At application exit: wait so servers do not outlive Mozaik.
    pub fn close_all(&self) {
        for handle in self.stop_where(|_| false) {
            let _ = handle.join();
        }
    }
}

#[tauri::command]
pub fn lsp_servers(app: tauri::AppHandle) -> Result<Vec<ServerInfo>, String> {
    Server::ALL.iter().map(|&s| info(&app, s)).collect()
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
    let servers = servers.inner().clone();
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let program = info_in(&app, server, Some(&root))?.path.ok_or_else(|| {
            format!(
                "{} was not found. Install it or choose it in settings.",
                server.id()
            )
        })?;
        match server {
            Server::Clangd => {
                // A CMake project gives clangd its build folder and the kit's compiler
                // environment.
                let (mut args, env) = crate::cmake::clangd_launch(&app, &root);
                // clangd runs the checks of the project's .clang-tidy while editing, unless
                // turned off.
                args.push(
                    if crate::analysis::live_clang_tidy(&app) {
                        "--clang-tidy"
                    } else {
                        "--clang-tidy=false"
                    }
                    .into(),
                );
                servers.start(
                    &label,
                    &id,
                    Path::new(&program),
                    &args,
                    &env,
                    &root,
                    move |event| {
                        let _ = events.send(event);
                    },
                )?;
            }
            Server::RustAnalyzer => {
                let config = Arc::new(crate::cargo::analyzer_config(&crate::cargo::settings(&app)));
                let outgoing = config.clone();
                let rewrite: Rewrite =
                    Arc::new(move |message| crate::cargo::outgoing(message, &outgoing));
                // Its settings requests are answered here, never by the renderer.
                let answers = servers.clone();
                let (window, key) = (label.clone(), id.clone());
                servers.start_with(
                    &label,
                    &id,
                    Path::new(&program),
                    &[],
                    &crate::cargo::analyzer_env(),
                    &root,
                    Some(rewrite),
                    move |event| {
                        if let LspEvent::Message { data } = &event
                            && let Some(answer) = crate::cargo::configuration_answer(data, &config)
                        {
                            let _ = answers.send_raw(&window, &key, &answer);
                            return;
                        }
                        let _ = events.send(event);
                    },
                )?;
            }
        }
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
                    &[],
                    &[],
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
            .start("main", &id, &program, &[], &[], dir.path(), move |event| {
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
        // A cold CI machine can be slow to start clangd; without a reply, show which clangd
        // ran and the end of its log.
        let reply = receiver
            .recv_timeout(Duration::from_secs(60))
            .unwrap_or_else(|e| {
                servers.close_all();
                let exit = receiver.recv_timeout(Duration::from_secs(10));
                panic!("{} did not answer ({e}): {exit:?}", program.display())
            });
        let LspEvent::Message { data } = reply else {
            panic!("{reply:?}")
        };
        assert!(data.contains(r#""id":1"#) && data.contains("capabilities"));
        servers.close_all();
        let exit = receiver.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(matches!(exit, LspEvent::Exit { .. }));
    }

    /// Runs the real rust-analyzer when one is found: the renderer's initialize gets Rust's
    /// settings, and a settings change from the renderer never reaches the server.
    #[test]
    fn rust_analyzer_answers_initialize_when_installed() {
        let Some(program) = crate::cargo::find_rust_analyzer(None).path else {
            eprintln!("rust-analyzer is not installed; skipped");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let servers = LanguageServers::default();
        let (sender, receiver) = mpsc::channel();
        let id = uuid::Uuid::new_v4().to_string();
        let config = crate::cargo::analyzer_config(&Default::default());
        let rewrite: Rewrite = Arc::new(move |m| crate::cargo::outgoing(m, &config));
        servers
            .start_with(
                "main",
                &id,
                &program,
                &[],
                &crate::cargo::analyzer_env(),
                dir.path(),
                Some(rewrite),
                move |event| {
                    let _ = sender.send(event);
                },
            )
            .unwrap();
        assert!(
            servers
                .send(
                    "main",
                    &id,
                    r#"{"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{"settings":{}}}"#,
                )
                .is_err()
        );
        servers
            .send(
                "main",
                &id,
                r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":null,"capabilities":{}}}"#,
            )
            .unwrap();
        let reply = loop {
            let event = receiver
                .recv_timeout(Duration::from_secs(60))
                .unwrap_or_else(|e| {
                    servers.close_all();
                    panic!("{} did not answer ({e})", program.display())
                });
            match &event {
                LspEvent::Message { data } if data.contains(r#""id":1"#) => break data.clone(),
                LspEvent::Message { .. } => continue,
                LspEvent::Exit { .. } => panic!("{event:?}"),
            }
        };
        assert!(reply.contains("capabilities"));
        servers.close_all();
    }
}
