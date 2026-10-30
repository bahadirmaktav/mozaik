//! Debugging (V0.8) through the Debug Adapter Protocol, after VS Code's Run and Debug: GDB's
//! own DAP interpreter (GDB 14 or newer, built with Python) or LLVM's `lldb-dap`. Rust finds
//! and starts the adapter, builds the launch request from the CMake run target and the
//! project's `.tessera/debug.json`, and passes on only the requests a debugging UI needs: the
//! renderer never names a program, a debugger command or a launch configuration.
use crate::cmake::{self, kits};
use crate::files::atomic_write;
use crate::lsp::{LanguageServers, LspEvent, executable};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    env, fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex, PoisonError},
    time::{Duration, SystemTime},
};
use tauri::{Manager, State, WebviewWindow, ipc::Channel};

const MSVC: &str = "Debugging programs built with MSVC is not supported. Build with a GCC or \
                    Clang (GNU) kit to debug; MSVC builds still work.";

/// The adapters Tessera can start. Their programs come from detection or a native dialog.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Adapter {
    Gdb,
    Lldb,
}
impl Adapter {
    fn label(self) -> &'static str {
        match self {
            Self::Gdb => "GDB",
            Self::Lldb => "LLDB",
        }
    }
    fn programs(self) -> &'static [&'static str] {
        match self {
            Self::Gdb => &["gdb"],
            // lldb-vscode is the adapter's name before LLVM 18.
            Self::Lldb => &["lldb-dap", "lldb-vscode"],
        }
    }
    /// Fixed arguments. GDB loads its system init file (libstdc++ pretty-printers) and never
    /// asks a debuginfod server for symbols: Tessera makes no network requests.
    fn args(self) -> Vec<String> {
        match self {
            Self::Gdb => [
                "--interpreter=dap",
                "-q",
                "-iex",
                "set debuginfod enabled off",
            ]
            .map(String::from)
            .to_vec(),
            Self::Lldb => Vec::new(),
        }
    }
    fn fallbacks(self) -> Vec<PathBuf> {
        match self {
            Self::Gdb if cfg!(windows) => Vec::new(),
            Self::Gdb => vec![PathBuf::from("/usr/bin/gdb")],
            Self::Lldb if cfg!(windows) => ["ProgramFiles", "ProgramFiles(x86)"]
                .iter()
                .filter_map(env::var_os)
                .map(|dir| PathBuf::from(dir).join(r"LLVM\bin\lldb-dap.exe"))
                .collect(),
            Self::Lldb => (14..=30)
                .rev()
                .flat_map(|v| {
                    [
                        PathBuf::from(format!("/usr/bin/lldb-dap-{v}")),
                        PathBuf::from(format!("/usr/lib/llvm-{v}/bin/lldb-dap")),
                        PathBuf::from(format!("/usr/bin/lldb-vscode-{v}")),
                    ]
                })
                .collect(),
        }
    }
}

/// The project's choice: the adapter that suits the compiler, or a fixed one.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Choice {
    #[default]
    Auto,
    Gdb,
    Lldb,
}

/// The compiler of the last configure, from CMake's own record in the build folder.
#[derive(Debug, Default, PartialEq, Clone)]
pub struct Toolchain {
    /// `GNU`, `Clang`, `MSVC`, …
    pub id: String,
    /// `MSVC` for clang-cl and MSVC-targeting Clang.
    pub simulate: String,
    pub version: String,
    pub compiler: Option<PathBuf>,
}
fn cmake_set(text: &str, name: &str) -> Option<String> {
    let prefix = format!("set({name} \"");
    text.lines()
        .find_map(|line| line.trim().strip_prefix(&prefix)?.strip_suffix("\")"))
        .map(str::to_owned)
}
pub fn toolchain(build: &Path) -> Option<Toolchain> {
    let mut found = None;
    for dir in fs::read_dir(build.join("CMakeFiles")).ok()?.flatten() {
        for (file, lang) in [
            ("CMakeCXXCompiler.cmake", "CXX"),
            ("CMakeCCompiler.cmake", "C"),
        ] {
            let Ok(text) = fs::read_to_string(dir.path().join(file)) else {
                continue;
            };
            let read = |name: &str| cmake_set(&text, &format!("CMAKE_{lang}_{name}"));
            let chain = Toolchain {
                id: read("COMPILER_ID").unwrap_or_default(),
                simulate: read("SIMULATE_ID").unwrap_or_default(),
                version: read("COMPILER_VERSION").unwrap_or_default(),
                compiler: read("COMPILER")
                    .filter(|c| !c.is_empty())
                    .map(PathBuf::from),
            };
            // C++ wins over C; one CMake version folder is enough.
            if lang == "CXX" {
                return Some(chain);
            }
            found.get_or_insert(chain);
        }
    }
    found
}
/// The adapters that can debug what this compiler builds, preferred first.
pub fn suitable(chain: &Toolchain) -> Result<Vec<Adapter>, String> {
    if chain.id == "MSVC" {
        return Err(MSVC.into());
    }
    if chain.simulate == "MSVC" {
        // Programs for the MSVC ABI carry PDB debug information GDB cannot read.
        return Ok(vec![Adapter::Lldb]);
    }
    Ok(match chain.id.as_str() {
        "Clang" | "AppleClang" => vec![Adapter::Lldb, Adapter::Gdb],
        _ => vec![Adapter::Gdb, Adapter::Lldb],
    })
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}
type Checked = HashMap<PathBuf, (Option<SystemTime>, Result<(), String>)>;
static CHECKED: Mutex<Option<Checked>> = Mutex::new(None);
/// Whether the program is an adapter that speaks DAP: GDB must import its `gdb.dap` module
/// (GDB 14+ with Python). Remembered per file and modification time.
fn check(adapter: Adapter, program: &Path) -> Result<(), String> {
    if !executable(program) {
        return Err(format!(
            "{} is not an executable program",
            program.display()
        ));
    }
    if adapter == Adapter::Lldb {
        return Ok(());
    }
    let modified = fs::metadata(program).and_then(|m| m.modified()).ok();
    if let Some((time, result)) = lock(&CHECKED).get_or_insert_default().get(program)
        && *time == modified
    {
        return result.clone();
    }
    let output = kits::query(
        Command::new(program).args([
            "-nx",
            "-batch",
            "-ex",
            "python import gdb.dap; print('tessera-dap')",
        ]),
        Duration::from_secs(15),
    );
    let result = match output {
        Some(out) if String::from_utf8_lossy(&out).contains("tessera-dap") => Ok(()),
        Some(_) => Err(format!(
            "{} has no DAP support. GDB 14 or newer built with Python is needed.",
            program.display()
        )),
        None => Err(format!("{} did not run", program.display())),
    };
    lock(&CHECKED)
        .get_or_insert_default()
        .insert(program.to_owned(), (modified, result.clone()));
    result
}
/// Where an adapter is looked for: next to the compiler (MinGW ships gdb.exe beside g++),
/// on the kit's and Tessera's PATH, then known install folders.
fn candidates(adapter: Adapter, chain: &Toolchain, env: &[(String, String)]) -> Vec<PathBuf> {
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut list = Vec::new();
    for name in adapter.programs() {
        if let Some(dir) = chain.compiler.as_deref().and_then(Path::parent) {
            list.push(dir.join(format!("{name}{suffix}")));
        }
        list.extend(kits::find_on(&kits::path_of(env), name));
    }
    list.extend(adapter.fallbacks());
    list.dedup();
    list
}

/// Personal debugging state of one project, kept in Tessera's app data, never in the
/// repository.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Breakpoint {
    pub path: String,
    /// 1-based.
    pub line: u32,
    pub enabled: bool,
    pub condition: String,
    pub hit_condition: String,
    pub log_message: String,
}
impl Default for Breakpoint {
    fn default() -> Self {
        Self {
            path: String::new(),
            line: 1,
            enabled: true,
            condition: String::new(),
            hit_condition: String::new(),
            log_message: String::new(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DebugState {
    pub breakpoints: Vec<Breakpoint>,
    /// "Deactivate Breakpoints": kept, but none is set.
    pub breakpoints_active: bool,
    pub watches: Vec<String>,
    pub adapter: Choice,
    /// Programs chosen in a native dialog, by adapter; never set by the renderer.
    pub programs: BTreeMap<Adapter, PathBuf>,
}
impl Default for DebugState {
    fn default() -> Self {
        Self {
            breakpoints: Vec::new(),
            breakpoints_active: true,
            watches: Vec::new(),
            adapter: Choice::Auto,
            programs: BTreeMap::new(),
        }
    }
}
fn one_line(text: &str, limit: usize) -> bool {
    text.len() <= limit && !text.contains(['\0', '\n', '\r'])
}
impl DebugState {
    fn validate(&self) -> Result<(), String> {
        if self.breakpoints.len() > 10_000 {
            return Err("At most 10000 breakpoints".into());
        }
        if self.breakpoints.iter().any(|b| {
            b.path.is_empty()
                || !one_line(&b.path, 2000)
                || b.line == 0
                || [&b.condition, &b.hit_condition, &b.log_message]
                    .iter()
                    .any(|t| !one_line(t, 2000))
        }) {
            return Err("A breakpoint is invalid".into());
        }
        if self.watches.len() > 200 || self.watches.iter().any(|w| !one_line(w, 2000)) {
            return Err("At most 200 watch expressions of one line".into());
        }
        Ok(())
    }
}
static STATE: Mutex<()> = Mutex::new(());
fn state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("debug-state.json"))
}
fn read_states(path: &Path) -> Result<BTreeMap<String, DebugState>, String> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|_| {
        format!(
            "The debugging state file is damaged and was left unchanged: {}",
            path.display()
        )
    })
}
fn state_for(app: &tauri::AppHandle, root: &Path) -> Result<DebugState, String> {
    let _guard = lock(&STATE);
    Ok(read_states(&state_path(app)?)?
        .remove(&crate::project::display(root))
        .unwrap_or_default())
}
fn update_state(
    app: &tauri::AppHandle,
    root: &Path,
    change: impl FnOnce(&mut DebugState),
) -> Result<DebugState, String> {
    let _guard = lock(&STATE);
    let path = state_path(app)?;
    let mut all = read_states(&path)?;
    let state = all.entry(crate::project::display(root)).or_default();
    change(state);
    state.validate()?;
    let result = state.clone();
    fs::create_dir_all(path.parent().ok_or("Invalid app data directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(&all).map_err(|e| e.to_string())?,
    )?;
    Ok(result)
}

/// `.tessera/debug.json`: per target arguments, working folder and environment, meant to be
/// shared through the repository (no executable path; that comes from CMake).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DebugFile {
    pub version: u32,
    #[serde(default)]
    pub targets: BTreeMap<String, TargetConfig>,
}
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields, default)]
pub struct TargetConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env: Option<BTreeMap<String, String>>,
}
impl TargetConfig {
    fn validate(&self) -> Result<(), String> {
        let args = self.args.as_deref().unwrap_or_default();
        let env = self.env.as_ref().map_or(0, BTreeMap::len);
        if args.len() > 200 || args.iter().any(|a| a.len() > 4000 || a.contains('\0')) {
            return Err("At most 200 arguments of 4000 characters".into());
        }
        if self.cwd.as_ref().is_some_and(|c| !one_line(c, 1000)) {
            return Err("The working folder must be one line".into());
        }
        if env > 200
            || self.env.iter().flatten().any(|(k, v)| {
                k.is_empty() || k.contains(['=', '\0']) || !one_line(k, 200) || v.contains('\0')
            })
        {
            return Err("Environment names must be non-empty, without = (at most 200)".into());
        }
        Ok(())
    }
    fn is_empty(&self) -> bool {
        self.args.is_none() && self.cwd.is_none() && self.env.is_none()
    }
}
pub const CONFIG: &str = ".tessera/debug.json";
pub fn parse_config(text: &str) -> Result<DebugFile, String> {
    let file: DebugFile =
        serde_json::from_str(text).map_err(|e| format!("{CONFIG} is not valid: {e}"))?;
    if file.version != 1 {
        return Err(format!(
            "{CONFIG} has version {}; Tessera reads version 1",
            file.version
        ));
    }
    for (name, target) in &file.targets {
        target
            .validate()
            .map_err(|e| format!("{CONFIG}, target {name}: {e}"))?;
    }
    Ok(file)
}
fn read_config(root: &Path) -> Result<Option<DebugFile>, String> {
    let path = root.join(CONFIG);
    match fs::read_to_string(&path) {
        Ok(text) => parse_config(&text).map(Some),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{CONFIG}: {e}")),
    }
}

/// Folders `${…}` variables in debug.json stand for.
pub struct Folders<'a> {
    pub workspace: &'a Path,
    pub source: &'a Path,
    pub build: &'a Path,
}
/// Replaces `${workspaceFolder}`, `${sourceDir}`, `${buildDir}` and `${env:NAME}`; anything
/// else is an error, never left in place.
pub fn expand(text: &str, folders: &Folders) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let end = rest[start..]
            .find('}')
            .ok_or_else(|| format!("{CONFIG}: unclosed variable in {text}"))?
            + start;
        let name = &rest[start + 2..end];
        let value = match name {
            "workspaceFolder" => folders.workspace.display().to_string(),
            "sourceDir" => folders.source.display().to_string(),
            "buildDir" => folders.build.display().to_string(),
            _ => match name.strip_prefix("env:") {
                Some(var) if !var.is_empty() => env::var(var).unwrap_or_default(),
                _ => return Err(format!("{CONFIG}: unknown variable ${{{name}}}")),
            },
        };
        out.push_str(&value);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}
fn same_name(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.eq_ignore_ascii_case(b)
    } else {
        a == b
    }
}
/// Sets variables over a base environment (names compare without case on Windows).
fn overlay(base: &mut Vec<(String, String)>, layer: impl IntoIterator<Item = (String, String)>) {
    for (name, value) in layer {
        base.retain(|(n, _)| !same_name(n, &name));
        base.push((name, value));
    }
}

/// What the debugged program gets.
#[derive(Debug, PartialEq)]
pub struct Plan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// The whole environment: GDB replaces the program's environment with it.
    pub env: Vec<(String, String)>,
}
/// The run target's launch (Run's arguments and folder) with the target's debug.json entry
/// over it, field by field.
pub fn plan(
    launch: cmake::RunLaunch,
    config: Option<&TargetConfig>,
    workspace: &Path,
) -> Result<Plan, String> {
    let folders = Folders {
        workspace,
        source: &launch.source,
        build: &launch.build,
    };
    let mut env: Vec<(String, String)> = env::vars().collect();
    overlay(&mut env, launch.env);
    let mut result = Plan {
        program: launch.program,
        args: launch.args,
        cwd: launch.cwd,
        env,
    };
    let Some(config) = config else {
        return Ok(result);
    };
    if let Some(args) = &config.args {
        result.args = args
            .iter()
            .map(|a| expand(a, &folders))
            .collect::<Result<_, _>>()?;
    }
    if let Some(cwd) = config.cwd.as_deref().filter(|c| !c.trim().is_empty()) {
        let cwd = PathBuf::from(expand(cwd.trim(), &folders)?);
        result.cwd = if cwd.is_relative() {
            workspace.join(cwd)
        } else {
            cwd
        };
        if !result.cwd.is_dir() {
            return Err(format!(
                "{CONFIG}: the working folder {} does not exist",
                result.cwd.display()
            ));
        }
    }
    if let Some(vars) = &config.env {
        let layer = vars
            .iter()
            .map(|(k, v)| Ok((k.clone(), expand(v, &folders)?)))
            .collect::<Result<Vec<_>, String>>()?;
        overlay(&mut result.env, layer);
    }
    Ok(result)
}
/// The launch request: GDB's and lldb-dap's own launch arguments.
pub fn launch_request(adapter: Adapter, seq: u64, plan: &Plan) -> Value {
    let program = plan.program.display().to_string();
    let cwd = plan.cwd.display().to_string();
    let arguments = match adapter {
        Adapter::Gdb => json!({
            "program": program,
            "args": plan.args,
            "cwd": cwd,
            "env": plan.env.iter().cloned().collect::<BTreeMap<_, _>>(),
        }),
        Adapter::Lldb => json!({
            "program": program,
            "args": plan.args,
            "cwd": cwd,
            "env": plan.env.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>(),
        }),
    };
    json!({ "seq": seq, "type": "request", "command": "launch", "arguments": arguments })
}

/// Requests the renderer may send. Launch and attach are built here; console evaluation is
/// an expression (never `repl`, which runs debugger commands such as `shell`).
const REQUESTS: [&str; 18] = [
    "initialize",
    "setBreakpoints",
    "setExceptionBreakpoints",
    "configurationDone",
    "threads",
    "stackTrace",
    "scopes",
    "variables",
    "setVariable",
    "evaluate",
    "continue",
    "next",
    "stepIn",
    "stepOut",
    "pause",
    "disconnect",
    "terminate",
    "cancel",
];
const CONTEXTS: [&str; 3] = ["watch", "hover", "variables"];
pub fn allowed(message: &str) -> Result<(), String> {
    let value: Value = serde_json::from_str(message).map_err(|_| "Invalid debug message")?;
    let command = value["command"].as_str().unwrap_or_default();
    if value["type"] != "request" || !REQUESTS.contains(&command) {
        return Err(format!("The debug request {command} is not allowed"));
    }
    if command == "evaluate"
        && !CONTEXTS.contains(&value["arguments"]["context"].as_str().unwrap_or_default())
    {
        return Err("Expressions are evaluated in the watch, hover or variables context".into());
    }
    Ok(())
}

/// Debug adapter processes: one session in the whole application, as the plan asks.
#[derive(Clone, Default)]
pub struct DebugAdapters {
    processes: LanguageServers,
    sessions: Arc<Mutex<HashMap<String, Adapter>>>,
}
impl DebugAdapters {
    #[allow(clippy::too_many_arguments)]
    pub fn start(
        &self,
        window: &str,
        id: &str,
        adapter: Adapter,
        program: &Path,
        env: &[(String, String)],
        cwd: &Path,
        sink: impl Fn(LspEvent) + Send + Sync + 'static,
    ) -> Result<(), String> {
        let mut sessions = lock(&self.sessions);
        if !sessions.is_empty() {
            return Err("A debug session is already running. Stop it first.".into());
        }
        let ended = self.sessions.clone();
        let key = id.to_owned();
        self.processes.start(
            window,
            id,
            program,
            &adapter.args(),
            env,
            cwd,
            move |event| {
                if matches!(event, LspEvent::Exit { .. }) {
                    lock(&ended).remove(&key);
                }
                sink(event);
            },
        )?;
        sessions.insert(id.to_owned(), adapter);
        Ok(())
    }
    fn adapter(&self, id: &str) -> Result<Adapter, String> {
        lock(&self.sessions)
            .get(id)
            .copied()
            .ok_or_else(|| "The debugger is not running".into())
    }
    pub fn send(&self, window: &str, id: &str, message: &str) -> Result<(), String> {
        allowed(message)?;
        self.processes.send(window, id, message)
    }
    fn launch(&self, window: &str, id: &str, request: &Value) -> Result<(), String> {
        self.processes.send(window, id, &request.to_string())
    }
    pub fn stop(&self, window: &str, id: &str) {
        self.processes.stop(window, id);
    }
    pub fn close_window(&self, window: &str) {
        self.processes.close_window(window);
    }
    pub fn close_all(&self) {
        self.processes.close_all();
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    adapter: Adapter,
    label: &'static str,
    /// The program that would run, or `None` when none was found.
    path: Option<String>,
    /// Chosen in a dialog rather than found.
    chosen: bool,
    /// Why it cannot be used (not found, no DAP support, wrong compiler).
    problem: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebuggersInfo {
    choice: Choice,
    /// `GNU 15.2.0` from the last configure; `None` before it.
    compiler: Option<String>,
    adapters: Vec<AdapterInfo>,
    /// What Debug starts, or why it cannot start.
    selected: Option<Adapter>,
    error: Option<String>,
}
struct Resolved {
    info: DebuggersInfo,
    program: Option<PathBuf>,
    env: Vec<(String, String)>,
}
/// The compiler, environment and adapter of a project, from its active CMake choices.
fn resolve(app: &tauri::AppHandle, root: &Path) -> Result<Resolved, String> {
    let settings = crate::project::settings_for(app, root)?;
    let active = cmake::resolve(app, root, &settings.cmake)?;
    let state = state_for(app, root)?;
    let chain = toolchain(&active.build).or_else(|| {
        // Before a configure, the kit tells what will be built.
        active.kit.as_ref().map(|kit| Toolchain {
            id: match kit.kind {
                kits::KitKind::Msvc => "MSVC",
                kits::KitKind::Gcc => "GNU",
                kits::KitKind::Clang | kits::KitKind::ClangCl => "Clang",
            }
            .into(),
            simulate: if kit.kind == kits::KitKind::ClangCl {
                "MSVC".into()
            } else {
                String::new()
            },
            version: kit.version.clone(),
            compiler: Some(kit.cxx.clone()),
        })
    });
    let env = active.environment(app).unwrap_or_default();
    let chain_or_default = chain.clone().unwrap_or_default();
    let order = suitable(&chain_or_default);
    let mut adapters = Vec::new();
    let mut programs = HashMap::new();
    for adapter in [Adapter::Gdb, Adapter::Lldb] {
        let chosen = state.programs.get(&adapter).cloned();
        let path = match &chosen {
            Some(path) => Some(path.clone()),
            None => candidates(adapter, &chain_or_default, &env)
                .into_iter()
                .find(|p| executable(p)),
        };
        let mut problem = match &path {
            None => Some(format!(
                "{} was not found. Install it or choose its program.",
                adapter.programs()[0]
            )),
            Some(path) => check(adapter, path).err(),
        };
        if let Ok(order) = &order
            && !order.contains(&adapter)
        {
            problem = Some(format!(
                "{} cannot debug programs built for the MSVC ABI",
                adapter.label()
            ));
        }
        if problem.is_none()
            && let Some(path) = &path
        {
            programs.insert(adapter, path.clone());
        }
        adapters.push(AdapterInfo {
            adapter,
            label: adapter.label(),
            path: path.map(|p| p.display().to_string()),
            chosen: chosen.is_some(),
            problem,
        });
    }
    let (selected, error) = match (&order, state.adapter) {
        (Err(e), _) => (None, Some(e.clone())),
        (Ok(order), Choice::Auto) => match order.iter().find(|a| programs.contains_key(a)) {
            Some(a) => (Some(*a), None),
            None => (
                None,
                Some(
                    "No debugger was found: install GDB 14+ (with Python) or lldb-dap, or \
                     choose its program."
                        .into(),
                ),
            ),
        },
        (Ok(_), choice) => {
            let adapter = if choice == Choice::Gdb {
                Adapter::Gdb
            } else {
                Adapter::Lldb
            };
            let problem = adapters
                .iter()
                .find(|a| a.adapter == adapter)
                .and_then(|a| a.problem.clone());
            match problem {
                None => (Some(adapter), None),
                Some(problem) => (None, Some(problem)),
            }
        }
    };
    Ok(Resolved {
        program: selected.and_then(|a| programs.get(&a).cloned()),
        info: DebuggersInfo {
            choice: state.adapter,
            compiler: chain.map(|c| format!("{} {}", c.id, c.version).trim().to_owned()),
            adapters,
            selected,
            error,
        },
        env,
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
pub async fn debug_debuggers(app: tauri::AppHandle, root: String) -> Result<DebuggersInfo, String> {
    blocking(move || Ok(resolve(&app, &crate::project::root(&root)?)?.info)).await
}
#[tauri::command]
pub async fn debug_set_choice(
    app: tauri::AppHandle,
    root: String,
    choice: Choice,
) -> Result<DebuggersInfo, String> {
    blocking(move || {
        let root = crate::project::root(&root)?;
        update_state(&app, &root, |state| state.adapter = choice)?;
        Ok(resolve(&app, &root)?.info)
    })
    .await
}
/// Lets the user pick an adapter program in a native dialog; the path never comes from the
/// renderer. Choosing makes that adapter the project's choice.
#[tauri::command]
pub async fn debug_choose_debugger(
    app: tauri::AppHandle,
    root: String,
    adapter: Adapter,
) -> Result<Option<DebuggersInfo>, String> {
    let root = crate::project::root(&root)?;
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title(format!("Choose the {} program", adapter.programs()[0]))
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = crate::git::plain(&file.path().canonicalize().map_err(|e| e.to_string())?);
    blocking(move || {
        check(adapter, &path)?;
        update_state(&app, &root, |state| {
            state.programs.insert(adapter, path);
            state.adapter = if adapter == Adapter::Gdb {
                Choice::Gdb
            } else {
                Choice::Lldb
            };
        })?;
        Ok(Some(resolve(&app, &root)?.info))
    })
    .await
}
/// Forgets a chosen adapter program; detection applies again.
#[tauri::command]
pub async fn debug_reset_debugger(
    app: tauri::AppHandle,
    root: String,
    adapter: Adapter,
) -> Result<DebuggersInfo, String> {
    blocking(move || {
        let root = crate::project::root(&root)?;
        update_state(&app, &root, |state| {
            state.programs.remove(&adapter);
        })?;
        Ok(resolve(&app, &root)?.info)
    })
    .await
}

/// Breakpoints and watch expressions, as the renderer sees them (programs stay in Rust).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedState {
    breakpoints: Vec<Breakpoint>,
    breakpoints_active: bool,
    watches: Vec<String>,
}
#[tauri::command]
pub async fn debug_state(app: tauri::AppHandle, root: String) -> Result<SharedState, String> {
    blocking(move || {
        let state = state_for(&app, &crate::project::root(&root)?)?;
        Ok(SharedState {
            breakpoints: state.breakpoints,
            breakpoints_active: state.breakpoints_active,
            watches: state.watches,
        })
    })
    .await
}
#[tauri::command]
pub async fn debug_set_state(
    app: tauri::AppHandle,
    root: String,
    state: SharedState,
) -> Result<(), String> {
    blocking(move || {
        update_state(&app, &crate::project::root(&root)?, |stored| {
            stored.breakpoints = state.breakpoints;
            stored.breakpoints_active = state.breakpoints_active;
            stored.watches = state.watches;
        })
        .map(|_| ())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigInfo {
    path: String,
    exists: bool,
    file: Option<DebugFile>,
    /// Why the file cannot be read; it is then never rewritten.
    error: Option<String>,
}
fn config_info(root: &Path) -> ConfigInfo {
    let path = crate::project::display(&root.join(CONFIG));
    match read_config(root) {
        Ok(file) => ConfigInfo {
            path,
            exists: file.is_some(),
            file,
            error: None,
        },
        Err(error) => ConfigInfo {
            path,
            exists: true,
            file: None,
            error: Some(error),
        },
    }
}
#[tauri::command]
pub async fn debug_config(root: String) -> Result<ConfigInfo, String> {
    blocking(move || Ok(config_info(&crate::project::root(&root)?))).await
}
/// Replaces one target's entry (an empty one removes it); the file is created on the first
/// save and other targets are kept. A file that does not parse is never overwritten.
#[tauri::command]
pub async fn debug_set_config(
    root: String,
    target: String,
    config: TargetConfig,
) -> Result<ConfigInfo, String> {
    blocking(move || {
        let root = crate::project::root(&root)?;
        if target.is_empty() || !one_line(&target, 300) {
            return Err("Invalid target name".into());
        }
        config.validate()?;
        let mut file = read_config(&root)?.unwrap_or(DebugFile {
            version: 1,
            targets: BTreeMap::new(),
        });
        if config.is_empty() {
            file.targets.remove(&target);
        } else {
            file.targets.insert(target, config);
        }
        let path = root.join(CONFIG);
        fs::create_dir_all(path.parent().ok_or("Invalid folder")?).map_err(|e| e.to_string())?;
        let mut text = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
        text.push('\n');
        atomic_write(&path, text.as_bytes())?;
        Ok(config_info(&root))
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    adapter: Adapter,
    label: &'static str,
    program: String,
}
/// Starts the project's debug adapter for this window; DAP messages come back on `events`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn debug_start(
    app: tauri::AppHandle,
    window: WebviewWindow,
    adapters: State<'_, DebugAdapters>,
    id: String,
    root: String,
    events: Channel<LspEvent>,
) -> Result<Started, String> {
    let adapters = adapters.inner().clone();
    let label = window.label().to_owned();
    blocking(move || {
        let root = crate::project::root(&root)?;
        let resolved = resolve(&app, &root)?;
        let (Some(adapter), Some(program)) = (resolved.info.selected, resolved.program) else {
            return Err(resolved
                .info
                .error
                .unwrap_or_else(|| "No debugger is available".into()));
        };
        adapters.start(
            &label,
            &id,
            adapter,
            &program,
            &resolved.env,
            &crate::git::plain(&root),
            move |event| {
                let _ = events.send(event);
            },
        )?;
        Ok(Started {
            adapter,
            label: adapter.label(),
            program: program.display().to_string(),
        })
    })
    .await
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Launched {
    program: String,
    args: Vec<String>,
    cwd: String,
}
/// Sends the launch request for a run target: CMake's program, Run's arguments and folder,
/// and the target's debug.json entry.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn debug_launch(
    app: tauri::AppHandle,
    window: WebviewWindow,
    adapters: State<'_, DebugAdapters>,
    id: String,
    seq: u64,
    root: String,
    target: String,
) -> Result<Launched, String> {
    let adapters = adapters.inner().clone();
    let label = window.label().to_owned();
    blocking(move || {
        let adapter = adapters.adapter(&id)?;
        let launch = cmake::run_launch(&app, &root, &target)?;
        let workspace = crate::git::plain(&crate::project::root(&root)?);
        let file = read_config(&workspace)?;
        let plan = plan(
            launch,
            file.as_ref().and_then(|f| f.targets.get(&target)),
            &workspace,
        )?;
        adapters.launch(&label, &id, &launch_request(adapter, seq, &plan))?;
        Ok(Launched {
            program: plan.program.display().to_string(),
            args: plan.args,
            cwd: plan.cwd.display().to_string(),
        })
    })
    .await
}
#[tauri::command]
pub fn debug_send(
    window: WebviewWindow,
    adapters: State<DebugAdapters>,
    id: String,
    message: String,
) -> Result<(), String> {
    adapters.send(window.label(), &id, &message)
}
#[tauri::command]
pub fn debug_stop(window: WebviewWindow, adapters: State<DebugAdapters>, id: String) {
    adapters.stop(window.label(), &id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn only_ui_requests_and_expression_contexts_pass() {
        assert!(allowed(r#"{"type":"request","command":"continue","arguments":{}}"#).is_ok());
        for bad in [
            r#"{"type":"request","command":"launch","arguments":{"program":"/bin/sh"}}"#,
            r#"{"type":"request","command":"attach","arguments":{}}"#,
            r#"{"type":"response","command":"runInTerminal"}"#,
            r#"{"type":"request","command":"evaluate","arguments":{"expression":"shell ls","context":"repl"}}"#,
            r#"{"type":"request","command":"evaluate","arguments":{"expression":"x"}}"#,
            "not json",
        ] {
            assert!(allowed(bad).is_err(), "{bad}");
        }
        assert!(
            allowed(r#"{"type":"request","command":"evaluate","arguments":{"expression":"x","context":"hover"}}"#)
                .is_ok()
        );
    }

    #[test]
    fn variables_expand_and_unknown_ones_are_errors() {
        let folders = Folders {
            workspace: Path::new("/w"),
            source: Path::new("/w/src"),
            build: Path::new("/w/build"),
        };
        assert_eq!(
            expand("${workspaceFolder}/a ${sourceDir} ${buildDir}", &folders).unwrap(),
            format!(
                "{}/a {} {}",
                Path::new("/w").display(),
                Path::new("/w/src").display(),
                Path::new("/w/build").display()
            )
        );
        assert_eq!(expand("plain", &folders).unwrap(), "plain");
        assert!(expand("${cwd}", &folders).unwrap_err().contains("${cwd}"));
        assert!(expand("${env:}", &folders).is_err());
        assert!(expand("${workspaceFolder", &folders).is_err());
    }

    #[test]
    fn debug_json_is_strict_and_versioned() {
        let file = parse_config(
            r#"{"version":1,"targets":{"app":{"args":["--config","c.json"],"cwd":"${workspaceFolder}","env":{"MODE":"dev"}}}}"#,
        )
        .unwrap();
        assert_eq!(file.targets["app"].args.as_ref().unwrap().len(), 2);
        assert!(
            parse_config(r#"{"version":2}"#)
                .unwrap_err()
                .contains("version 2")
        );
        assert!(parse_config(r#"{"version":1,"targets":{"app":{"program":"x"}}}"#).is_err());
        assert!(parse_config(r#"{"version":1,"targets":{"app":{"env":{"A=B":"c"}}}}"#).is_err());
        assert!(parse_config("{").unwrap_err().contains(CONFIG));
        // Written back without the fields a target leaves to Run.
        let text = serde_json::to_string(&TargetConfig {
            args: Some(vec!["a".into()]),
            ..Default::default()
        })
        .unwrap();
        assert_eq!(text, r#"{"args":["a"]}"#);
    }

    #[test]
    fn the_compiler_comes_from_cmakes_record() {
        let dir = tempfile::tempdir().unwrap();
        let files = dir.path().join("CMakeFiles").join("3.31.0");
        fs::create_dir_all(&files).unwrap();
        assert_eq!(toolchain(dir.path()), None);
        fs::write(
            files.join("CMakeCCompiler.cmake"),
            "set(CMAKE_C_COMPILER \"/usr/bin/cc\")\nset(CMAKE_C_COMPILER_ID \"GNU\")\n",
        )
        .unwrap();
        assert_eq!(toolchain(dir.path()).unwrap().id, "GNU");
        fs::write(
            files.join("CMakeCXXCompiler.cmake"),
            "set(CMAKE_CXX_COMPILER \"C:/LLVM/bin/clang++.exe\")\nset(CMAKE_CXX_COMPILER_ID \"Clang\")\nset(CMAKE_CXX_COMPILER_VERSION \"19.1.0\")\nset(CMAKE_CXX_SIMULATE_ID \"\")\n",
        )
        .unwrap();
        let chain = toolchain(dir.path()).unwrap();
        assert_eq!(
            (chain.id.as_str(), chain.version.as_str()),
            ("Clang", "19.1.0")
        );
        assert_eq!(suitable(&chain).unwrap(), [Adapter::Lldb, Adapter::Gdb]);
        let gnu = Toolchain {
            id: "GNU".into(),
            ..Default::default()
        };
        assert_eq!(suitable(&gnu).unwrap()[0], Adapter::Gdb);
        let msvc = Toolchain {
            id: "MSVC".into(),
            ..Default::default()
        };
        assert!(suitable(&msvc).unwrap_err().contains("MSVC"));
        let clang_cl = Toolchain {
            id: "Clang".into(),
            simulate: "MSVC".into(),
            ..Default::default()
        };
        assert_eq!(suitable(&clang_cl).unwrap(), [Adapter::Lldb]);
    }

    fn launch(dir: &Path) -> cmake::RunLaunch {
        cmake::RunLaunch {
            program: dir.join("app"),
            args: vec!["run-arg".into()],
            cwd: dir.to_owned(),
            env: vec![("KIT".into(), "1".into())],
            source: dir.to_owned(),
            build: dir.join("build"),
        }
    }
    #[test]
    fn debug_json_overrides_run_field_by_field() {
        let dir = tempfile::tempdir().unwrap();
        let none = plan(launch(dir.path()), None, dir.path()).unwrap();
        assert_eq!(none.args, ["run-arg"]);
        assert!(none.env.iter().any(|(k, v)| k == "KIT" && v == "1"));
        // The program inherits Tessera's environment (GDB replaces it with this list).
        assert!(none.env.iter().any(|(k, _)| same_name(k, "PATH")));
        fs::create_dir(dir.path().join("data")).unwrap();
        let config = TargetConfig {
            args: Some(vec!["${buildDir}".into()]),
            cwd: Some("data".into()),
            env: Some(BTreeMap::from([("KIT".into(), "2".into())])),
        };
        let both = plan(launch(dir.path()), Some(&config), dir.path()).unwrap();
        assert_eq!(both.args, [dir.path().join("build").display().to_string()]);
        assert_eq!(both.cwd, dir.path().join("data"));
        assert_eq!(both.env.iter().filter(|(k, _)| k == "KIT").count(), 1);
        assert!(both.env.iter().any(|(k, v)| k == "KIT" && v == "2"));
        let missing = TargetConfig {
            cwd: Some("nowhere".into()),
            ..Default::default()
        };
        assert!(plan(launch(dir.path()), Some(&missing), dir.path()).is_err());
        let request = launch_request(Adapter::Lldb, 7, &both);
        assert_eq!(request["seq"], 7);
        assert!(
            request["arguments"]["env"][0]
                .as_str()
                .unwrap()
                .contains('=')
        );
        assert!(launch_request(Adapter::Gdb, 7, &both)["arguments"]["env"]["KIT"] == "2");
    }

    #[test]
    fn one_session_at_a_time_and_foreign_windows_are_rejected() {
        let adapters = DebugAdapters::default();
        let dir = tempfile::tempdir().unwrap();
        assert!(
            adapters
                .send(
                    "main",
                    "missing",
                    r#"{"type":"request","command":"threads"}"#
                )
                .is_err()
        );
        lock(&adapters.sessions).insert("other".into(), Adapter::Gdb);
        let error = adapters
            .start(
                "main",
                &uuid::Uuid::new_v4().to_string(),
                Adapter::Gdb,
                Path::new("gdb"),
                &[],
                dir.path(),
                |_| (),
            )
            .unwrap_err();
        assert!(error.contains("already running"));
    }

    /// Debugs a real program with this machine's GDB when it has DAP support: line,
    /// conditional, hit count breakpoints and a logpoint, a pretty-printed vector, the
    /// program's output and its exit.
    #[test]
    fn gdb_debugs_a_program_when_installed() {
        let Some(gdb) = kits::find_on(&kits::path_of(&[]), "gdb") else {
            eprintln!("gdb is not installed; skipped");
            return;
        };
        let Some(gxx) = kits::find_on(&kits::path_of(&[]), "g++") else {
            eprintln!("g++ is not installed; skipped");
            return;
        };
        if check(Adapter::Gdb, &gdb).is_err() {
            eprintln!("gdb has no DAP support; skipped");
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let dir = crate::git::plain(&dir.path().canonicalize().unwrap());
        let source = dir.join("main.cpp");
        fs::write(
            &source,
            "#include <cstdio>\n#include <vector>\nint add(int a, int b) {\n  int sum = a + b;\n  return sum;\n}\nint main(int argc, char** argv) {\n  std::vector<int> values{1, 2, 3};\n  int total = 0;\n  for (int v : values) total = add(total, v);\n  std::printf(\"total %d args %d\\n\", total, argc);\n  return 0;\n}\n",
        )
        .unwrap();
        let program = dir.join(if cfg!(windows) { "app.exe" } else { "app" });
        let mut compile = Command::new(&gxx);
        // As a kit does: the compiler folder first on PATH (its own DLLs), for g++ and the program.
        let mut paths = vec![gxx.parent().unwrap().to_owned()];
        paths.extend(env::split_paths(&kits::path_of(&[])));
        let path = env::join_paths(paths)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        compile.env("PATH", &path);
        compile.args(["-g", "-O0", "-o"]).arg(&program).arg(&source);
        kits::hide_window(&mut compile);
        let built = compile.output().unwrap();
        assert!(
            built.status.success(),
            "{}",
            String::from_utf8_lossy(&built.stderr)
        );

        let adapters = DebugAdapters::default();
        let id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::channel::<Value>();
        adapters
            .start(
                "main",
                &id,
                Adapter::Gdb,
                &gdb,
                &[("PATH".into(), path.clone())],
                &dir,
                move |event| {
                    if let LspEvent::Message { data } = event {
                        let _ = sender.send(serde_json::from_str(&data).unwrap());
                    }
                },
            )
            .unwrap();
        let send = |value: Value| adapters.send("main", &id, &value.to_string()).unwrap();
        let wait = |test: &dyn Fn(&Value) -> bool| loop {
            let message = receiver.recv_timeout(Duration::from_secs(30)).unwrap();
            if test(&message) {
                return message;
            }
        };
        send(
            json!({"seq":1,"type":"request","command":"initialize","arguments":{"adapterID":"gdb","linesStartAt1":true,"columnsStartAt1":true,"pathFormat":"path"}}),
        );
        let init = wait(&|m| m["command"] == "initialize");
        assert_eq!(init["body"]["supportsLogPoints"], true);
        let plan = Plan {
            program: program.clone(),
            args: vec!["a b".into()],
            cwd: dir.clone(),
            env: {
                let mut all: Vec<_> = env::vars().collect();
                overlay(&mut all, [("PATH".into(), path.clone())]);
                all
            },
        };
        adapters
            .launch("main", &id, &launch_request(Adapter::Gdb, 2, &plan))
            .unwrap();
        send(
            json!({"seq":3,"type":"request","command":"setBreakpoints","arguments":{
            "source":{"path":source.display().to_string()},
            "breakpoints":[{"line":4,"hitCondition":"1"},{"line":10,"condition":"total > 100"},{"line":11,"logMessage":"total is {total}"}]}}),
        );
        wait(&|m| m["command"] == "setBreakpoints");
        send(json!({"seq":4,"type":"request","command":"configurationDone"}));
        let stopped = wait(&|m| m["event"] == "stopped");
        assert_eq!(stopped["body"]["reason"], "breakpoint");
        send(
            json!({"seq":5,"type":"request","command":"stackTrace","arguments":{"threadId":stopped["body"]["threadId"]}}),
        );
        let trace = wait(&|m| m["command"] == "stackTrace");
        let frames = trace["body"]["stackFrames"].as_array().unwrap();
        assert_eq!(frames[0]["name"], "add");
        assert_eq!(frames[0]["line"], 4);
        send(
            json!({"seq":6,"type":"request","command":"evaluate","arguments":{"expression":"values","frameId":frames[1]["id"],"context":"hover"}}),
        );
        let values = wait(&|m| m["command"] == "evaluate");
        assert!(
            values["body"]["result"]
                .as_str()
                .unwrap()
                .contains("length 3")
        );
        // GDB ignores that many hits (the renderer sends N - 1 to stop on the Nth): the second
        // call, where a is 1.
        send(
            json!({"seq":7,"type":"request","command":"evaluate","arguments":{"expression":"a","frameId":frames[0]["id"],"context":"watch"}}),
        );
        assert_eq!(wait(&|m| m["command"] == "evaluate")["body"]["result"], "1");
        send(
            json!({"seq":8,"type":"request","command":"continue","arguments":{"threadId":stopped["body"]["threadId"]}}),
        );
        // Once its ignore count is used up the breakpoint stops on every call: continue to the
        // end, collecting the logpoint and the program output.
        let (mut log, mut out, mut stops) = (String::new(), String::new(), 0);
        let code = loop {
            let m = receiver.recv_timeout(Duration::from_secs(30)).unwrap();
            match (m["event"].as_str(), m["body"]["category"].as_str()) {
                (Some("stopped"), _) => {
                    stops += 1;
                    send(
                        json!({"seq":10 + stops,"type":"request","command":"continue","arguments":{"threadId":m["body"]["threadId"]}}),
                    );
                }
                (Some("output"), Some("console")) => log += m["body"]["output"].as_str().unwrap(),
                (Some("output"), _) => out += m["body"]["output"].as_str().unwrap(),
                (Some("exited"), _) => break m["body"]["exitCode"].clone(),
                _ => {}
            }
        };
        assert_eq!(code, 0);
        assert_eq!(stops, 1, "the third call stops once more");
        assert!(log.contains("total is 6"), "{log}");
        assert!(out.contains("total 6 args 2"), "{out}");
        // The renderer cannot start another program in the session.
        let launch = json!({"seq":9,"type":"request","command":"launch","arguments":{}});
        assert!(adapters.send("main", &id, &launch.to_string()).is_err());
        adapters.close_all();
    }
}
