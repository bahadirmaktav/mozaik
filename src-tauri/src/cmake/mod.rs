//! CMake for the IDE, after VS Code's CMake Tools: kits or presets, manual configure, File
//! API targets, build, clean and run. Every command line is built here from the user's
//! choices (kit, preset, variant, target names checked against what Rust found); the
//! renderer never supplies a program or a CMake argument.
pub mod fileapi;
pub mod jobs;
pub mod kits;
pub mod presets;

use crate::files::atomic_write;
use kits::{Kit, KitKind};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{State, WebviewWindow, ipc::Channel};

pub const VARIANTS: [&str; 4] = ["Debug", "Release", "RelWithDebInfo", "MinSizeRel"];
pub const GENERATORS: [&str; 8] = [
    "Ninja",
    "Ninja Multi-Config",
    "Unix Makefiles",
    "MinGW Makefiles",
    "NMake Makefiles",
    "Visual Studio 18 2026",
    "Visual Studio 17 2022",
    "Visual Studio 16 2019",
];
const UNSPECIFIED: &str = "unspecified";

/// Application-wide CMake settings (Workspace Settings → IDE).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CMakeSettings {
    /// Empty: Ninja when found, otherwise the platform's default for the kit.
    pub generator: String,
    /// Build folder template; `${sourceDir}`, `${kit}`, `${variant}`.
    pub build_directory: String,
    pub build_before_run: bool,
    /// `--parallel` jobs; 0 leaves it to the generator.
    pub parallel_jobs: u16,
}
impl Default for CMakeSettings {
    fn default() -> Self {
        Self {
            generator: String::new(),
            build_directory: "${sourceDir}/build/${kit}-${variant}".into(),
            build_before_run: true,
            parallel_jobs: 0,
        }
    }
}
impl CMakeSettings {
    fn validate(&self) -> Result<(), String> {
        if !self.generator.is_empty() && !GENERATORS.contains(&self.generator.as_str()) {
            return Err(format!("Unknown generator {}", self.generator));
        }
        if self.build_directory.trim().is_empty()
            || self.build_directory.len() > 500
            || self.build_directory.contains(['\n', '\0'])
        {
            return Err("The build folder must be 1–500 characters".into());
        }
        if self.parallel_jobs > 512 {
            return Err("Parallel jobs must be at most 512".into());
        }
        Ok(())
    }
}

/// How a run target starts: its arguments (one per entry, no shell) and working folder.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Launch {
    pub args: Vec<String>,
    /// Relative to the source folder; empty is the program's folder.
    pub cwd: String,
}

/// A project's CMake choices, kept with its IDE settings in the app config directory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectCMake {
    /// Folder of the top `CMakeLists.txt`, relative to the project; empty is the project.
    pub source_directory: String,
    pub kit: Option<String>,
    /// Empty is Debug.
    pub variant: String,
    pub configure_preset: Option<String>,
    pub build_preset: Option<String>,
    /// `None` builds all.
    pub build_target: Option<String>,
    pub run_target: Option<String>,
    pub launch: BTreeMap<String, Launch>,
}
fn short(text: &str, limit: usize) -> bool {
    text.len() <= limit && !text.contains(['\0', '\n', '\r'])
}
impl ProjectCMake {
    pub fn validate(&self) -> Result<(), String> {
        let names = [
            &self.kit,
            &self.configure_preset,
            &self.build_preset,
            &self.build_target,
            &self.run_target,
        ];
        if !short(&self.source_directory, 500)
            || names
                .iter()
                .any(|n| n.as_deref().is_some_and(|n| !short(n, 300)))
        {
            return Err("CMake choices must be at most 300 characters on one line".into());
        }
        if !self.variant.is_empty() && !VARIANTS.contains(&self.variant.as_str()) {
            return Err(format!("Unknown variant {}", self.variant));
        }
        if self.launch.len() > 200
            || self.launch.iter().any(|(target, launch)| {
                !short(target, 300)
                    || !short(&launch.cwd, 500)
                    || launch.args.len() > 100
                    || launch
                        .args
                        .iter()
                        .any(|a| a.len() > 2000 || a.contains('\0'))
            })
        {
            return Err("Run arguments: at most 100 per target, 2000 characters each".into());
        }
        Ok(())
    }
    fn variant(&self) -> &str {
        if self.variant.is_empty() {
            "Debug"
        } else {
            &self.variant
        }
    }
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct Stored {
    #[serde(flatten)]
    settings: CMakeSettings,
    program: Option<PathBuf>,
}

static STORE: Mutex<()> = Mutex::new(());
fn config_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join(name))
}
fn read_json<T: for<'a> Deserialize<'a> + Default>(path: &Path) -> Result<T, String> {
    if !path.exists() {
        return Ok(T::default());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|_| {
        format!(
            "The CMake settings file is damaged and was left unchanged: {}",
            path.display()
        )
    })
}
fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    fs::create_dir_all(path.parent().ok_or("Invalid settings directory")?)
        .map_err(|e| e.to_string())?;
    atomic_write(
        path,
        &serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
}
fn stored(app: &tauri::AppHandle) -> Result<Stored, String> {
    let _guard = STORE.lock().map_err(|e| e.to_string())?;
    read_json(&config_file(app, "cmake.json")?)
}
fn update_stored(app: &tauri::AppHandle, change: impl FnOnce(&mut Stored)) -> Result<(), String> {
    let _guard = STORE.lock().map_err(|e| e.to_string())?;
    let path = config_file(app, "cmake.json")?;
    let mut value: Stored = read_json(&path)?;
    change(&mut value);
    write_json(&path, &value)
}

/// Kits found by the last scan; scanned the first time they are needed.
pub fn kits(app: &tauri::AppHandle, rescan: bool) -> Result<Vec<Kit>, String> {
    let path = config_file(app, "cmake-kits.json")?;
    if !rescan {
        let _guard = STORE.lock().map_err(|e| e.to_string())?;
        if path.exists() {
            return read_json(&path);
        }
    }
    let found = kits::scan();
    let _guard = STORE.lock().map_err(|e| e.to_string())?;
    write_json(&path, &found)?;
    Ok(found)
}

fn cmake_program(app: &tauri::AppHandle) -> Result<Option<(PathBuf, bool)>, String> {
    if let Some(path) = stored(app)?.program {
        return Ok(path.is_file().then_some((path, true)));
    }
    if let Some(path) = kits::find_on(&kits::path_of(&[]), "cmake") {
        return Ok(Some((path, false)));
    }
    let mut known = Vec::new();
    if cfg!(windows) {
        for env in ["ProgramFiles", "ProgramW6432"] {
            if let Some(root) = std::env::var_os(env) {
                known.push(Path::new(&root).join("CMake").join("bin").join("cmake.exe"));
            }
        }
        for kit in kits(app, false)? {
            if let Some(vs) = kit.vs {
                known.push(
                    vs.install
                        .join("Common7")
                        .join("IDE")
                        .join("CommonExtensions")
                        .join("Microsoft")
                        .join("CMake")
                        .join("CMake")
                        .join("bin")
                        .join("cmake.exe"),
                );
            }
        }
    } else {
        known.push(PathBuf::from("/usr/local/bin/cmake"));
        known.push(PathBuf::from("/usr/bin/cmake"));
    }
    Ok(known.into_iter().find(|p| p.is_file()).map(|p| (p, false)))
}
fn require_cmake(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    cmake_program(app)?
        .map(|(p, _)| p)
        .ok_or_else(|| "CMake was not found. Install it or choose it in Settings → IDE.".into())
}

/// The folder of the top `CMakeLists.txt`, inside the project, without the `\?` prefix
/// (CMake and the compilers reject it).
pub fn source_dir(root: &Path, cmake: &ProjectCMake) -> Result<PathBuf, String> {
    let dir = root.join(cmake.source_directory.trim());
    let dir = dir
        .canonicalize()
        .map_err(|e| format!("CMake source folder {}: {e}", dir.display()))?;
    if !dir.starts_with(root) {
        return Err("The CMake source folder must be inside the project".into());
    }
    Ok(crate::git::plain(&dir))
}

/// What the current choices resolve to.
pub struct Active {
    pub source: PathBuf,
    pub build: PathBuf,
    pub kit: Option<Kit>,
    pub preset: Option<presets::Configure>,
    pub build_preset: Option<String>,
    pub generator: Option<String>,
    pub variant: String,
    pub multi: bool,
}
pub fn multi_config(generator: Option<&str>) -> bool {
    generator.is_some_and(|g| {
        g == "Ninja Multi-Config" || g.starts_with("Visual Studio") || g == "Xcode"
    })
}
fn ninja_for(kit: Option<&Kit>) -> bool {
    kits::find_on(&kits::path_of(&[]), "ninja").is_some()
        || kit.is_some_and(|k| {
            k.cxx.parent().is_some_and(|d| {
                d.join(if cfg!(windows) { "ninja.exe" } else { "ninja" })
                    .is_file()
            }) || k.vs.as_ref().is_some_and(|vs| {
                vs.install
                    .join("Common7")
                    .join("IDE")
                    .join("CommonExtensions")
                    .join("Microsoft")
                    .join("CMake")
                    .join("Ninja")
                    .join("ninja.exe")
                    .is_file()
            })
        })
}
fn default_generator(kit: Option<&Kit>) -> Option<String> {
    if ninja_for(kit) {
        return Some("Ninja".into());
    }
    match kit {
        Some(k) if k.vs.is_some() => Some(match k.vs.as_ref().map(|v| v.major) {
            Some(16) => "Visual Studio 16 2019".into(),
            Some(18) => "Visual Studio 18 2026".into(),
            _ => "Visual Studio 17 2022".into(),
        }),
        Some(_) if cfg!(windows) => Some("MinGW Makefiles".into()),
        Some(_) => Some("Unix Makefiles".into()),
        None => None,
    }
}
fn expand_build_dir(
    template: &str,
    source: &Path,
    kit: &str,
    variant: &str,
) -> Result<PathBuf, String> {
    let mut text = template
        .replace("${sourceDir}", &source.display().to_string())
        .replace("${workspaceFolder}", &source.display().to_string())
        .replace("${kit}", kit)
        .replace("${variant}", variant);
    if let Some(start) = text.find("${") {
        return Err(format!("Unknown build folder variable {}", &text[start..]));
    }
    text = text.trim().to_owned();
    let path = PathBuf::from(text);
    Ok(if path.is_relative() {
        source.join(path)
    } else {
        path
    })
}

pub fn resolve(
    app: &tauri::AppHandle,
    root: &Path,
    cmake: &ProjectCMake,
) -> Result<Active, String> {
    let source = source_dir(root, cmake)?;
    if presets::exists(&source) {
        let all = presets::read(&source)?;
        let name = cmake
            .configure_preset
            .clone()
            .or_else(|| all.configure_list(&source).first().map(|p| p.name.clone()))
            .ok_or("The CMake presets define no configure preset")?;
        let preset = all.configure(&name)?;
        let build_preset = cmake.build_preset.clone().filter(|b| {
            all.build_list(&source)
                .iter()
                .any(|p| &p.name == b && p.configure.as_deref() == Some(name.as_str()))
        });
        return Ok(Active {
            build: preset.build_dir(&source)?,
            multi: multi_config(preset.generator.as_deref()),
            generator: preset.generator.clone(),
            preset: Some(preset),
            build_preset,
            kit: None,
            variant: cmake.variant().into(),
            source,
        });
    }
    let settings = stored(app)?.settings;
    let kit = match cmake.kit.as_deref() {
        None | Some(UNSPECIFIED) => None,
        Some(id) => Some(
            kits(app, false)?
                .into_iter()
                .find(|k| k.id == id)
                .ok_or("The chosen kit was not found. Scan for kits and choose again.")?,
        ),
    };
    let generator = if settings.generator.is_empty() {
        default_generator(kit.as_ref())
    } else {
        Some(settings.generator.clone())
    };
    let variant = cmake.variant().to_owned();
    let build = expand_build_dir(
        &settings.build_directory,
        &source,
        kit.as_ref().map_or(UNSPECIFIED, |k| k.slug.as_str()),
        &variant,
    )?;
    Ok(Active {
        multi: multi_config(generator.as_deref()),
        source,
        build,
        kit,
        preset: None,
        build_preset: None,
        generator,
        variant,
    })
}

impl Active {
    /// Variables for CMake, the build, programs and clangd.
    pub fn environment(&self, app: &tauri::AppHandle) -> Result<Vec<(String, String)>, String> {
        if let Some(kit) = &self.kit {
            // The Visual Studio generator finds its own toolset.
            if self
                .generator
                .as_deref()
                .is_some_and(|g| g.starts_with("Visual Studio"))
                && kit.vs.is_some()
            {
                return Ok(Vec::new());
            }
            return kits::environment(kit);
        }
        if let Some(arch) = self.preset.as_ref().and_then(|p| p.msvc_arch()) {
            let wanted = match arch.as_str() {
                "x86" | "win32" => "x64_x86",
                "arm64" => "x64_arm64",
                _ => "x64",
            };
            let kit = kits(app, false)?
                .into_iter()
                .rev()
                .find(|k| {
                    k.kind == KitKind::Msvc && k.vs.as_ref().is_some_and(|v| v.arch == wanted)
                })
                .ok_or("This preset needs Visual Studio (MSVC), which was not found")?;
            return kits::environment(&kit);
        }
        Ok(Vec::new())
    }
    fn config(&self) -> Option<&str> {
        (self.multi && self.preset.is_none()).then_some(self.variant.as_str())
    }
    pub fn configure_args(&self, fresh: bool) -> Vec<String> {
        let mut args = vec!["-S".into(), self.source.display().to_string()];
        let mut export = true;
        if let Some(preset) = &self.preset {
            args.push(format!("--preset={}", preset.name));
            if preset.binary_dir.is_none() {
                args.extend(["-B".into(), self.build.display().to_string()]);
            }
            export = !preset.cache.contains_key("CMAKE_EXPORT_COMPILE_COMMANDS");
        } else {
            args.extend(["-B".into(), self.build.display().to_string()]);
            if let Some(generator) = &self.generator {
                args.extend(["-G".into(), generator.clone()]);
            }
            let vs = self
                .generator
                .as_deref()
                .is_some_and(|g| g.starts_with("Visual Studio"));
            if let Some(kit) = &self.kit {
                if vs {
                    args.extend(["-A".into(), kit.platform().into()]);
                    if kit.kind == KitKind::ClangCl {
                        args.extend(["-T".into(), "ClangCL".into()]);
                    }
                } else {
                    if let Some(c) = &kit.c {
                        args.push(format!("-DCMAKE_C_COMPILER={}", c.display()));
                    }
                    args.push(format!("-DCMAKE_CXX_COMPILER={}", kit.cxx.display()));
                }
            }
            if !self.multi {
                args.push(format!("-DCMAKE_BUILD_TYPE={}", self.variant));
            }
        }
        if export {
            args.push("-DCMAKE_EXPORT_COMPILE_COMMANDS=ON".into());
        }
        if fresh {
            args.push("--fresh".into());
        }
        args
    }
    pub fn build_args(&self, target: Option<&str>, clean_first: bool, jobs: u16) -> Vec<String> {
        let mut args = vec!["--build".into()];
        match &self.build_preset {
            Some(preset) => args.push(format!("--preset={preset}")),
            None => {
                args.push(self.build.display().to_string());
                if let Some(config) = self.config() {
                    args.extend(["--config".into(), config.into()]);
                }
            }
        }
        if let Some(target) = target {
            args.extend(["--target".into(), target.into()]);
        }
        if jobs > 0 {
            args.extend(["--parallel".into(), jobs.to_string()]);
        }
        if clean_first {
            args.push("--clean-first".into());
        }
        args
    }
    pub fn targets(&self) -> Result<Option<Vec<fileapi::Target>>, String> {
        fileapi::targets(&self.build, self.config())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// The source folder has a `CMakeLists.txt`.
    cmake: bool,
    source: String,
    presets: bool,
    configure_presets: Vec<presets::PresetInfo>,
    build_presets: Vec<presets::PresetInfo>,
    build_dir: Option<String>,
    generator: Option<String>,
    /// `None` until the build folder has been configured.
    targets: Option<Vec<fileapi::Target>>,
    compile_commands: bool,
    error: Option<String>,
}

fn project_info(app: &tauri::AppHandle, root: &Path) -> Result<ProjectInfo, String> {
    let cmake = crate::project::settings_for(app, root)?.cmake;
    let mut info = ProjectInfo {
        cmake: false,
        source: crate::project::display(root),
        presets: false,
        configure_presets: Vec::new(),
        build_presets: Vec::new(),
        build_dir: None,
        generator: None,
        targets: None,
        compile_commands: false,
        error: None,
    };
    let source = match source_dir(root, &cmake) {
        Ok(source) => source,
        Err(error) => {
            info.error = Some(error);
            return Ok(info);
        }
    };
    info.source = crate::project::display(&source);
    info.cmake = source.join("CMakeLists.txt").is_file();
    if !info.cmake {
        return Ok(info);
    }
    if presets::exists(&source) {
        info.presets = true;
        match presets::read(&source) {
            Ok(all) => {
                info.configure_presets = all.configure_list(&source);
                info.build_presets = all.build_list(&source);
            }
            Err(error) => info.error = Some(error),
        }
    }
    match resolve(app, root, &cmake) {
        Ok(active) => {
            info.compile_commands = active.build.join("compile_commands.json").is_file();
            info.build_dir = Some(crate::project::display(&active.build));
            info.generator = active.generator.clone();
            match active.targets() {
                Ok(targets) => info.targets = targets,
                Err(error) => info.error = Some(error),
            }
        }
        Err(error) => info.error = info.error.or(Some(error)),
    }
    Ok(info)
}

pub struct RunLaunch {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: Vec<(String, String)>,
}

/// The program, arguments, folder and environment of a run target, from the last
/// configure's code model.
pub fn run_launch(app: &tauri::AppHandle, root: &str, target: &str) -> Result<RunLaunch, String> {
    let root = crate::project::root(root)?;
    let cmake = crate::project::settings_for(app, &root)?.cmake;
    let active = resolve(app, &root, &cmake)?;
    let targets = active
        .targets()?
        .ok_or("Configure the project before running a target")?;
    let artifact = targets
        .iter()
        .find(|t| t.name == target && t.kind == "EXECUTABLE")
        .and_then(|t| t.artifact.clone())
        .ok_or_else(|| format!("{target} is not an executable target"))?;
    let program = Path::new(&artifact)
        .canonicalize()
        .map_err(|_| format!("{target} has not been built yet ({artifact})"))?;
    let build = active.build.canonicalize().unwrap_or(active.build.clone());
    if !program.starts_with(&build) && !program.starts_with(&root) {
        return Err("The program is outside the project and its build folder".into());
    }
    let (program, build) = (crate::git::plain(&program), crate::git::plain(&build));
    let launch = cmake.launch.get(target).cloned().unwrap_or_default();
    let cwd = if launch.cwd.trim().is_empty() {
        program.parent().map(Path::to_owned).unwrap_or(build)
    } else {
        active.source.join(launch.cwd.trim())
    };
    if !cwd.is_dir() {
        return Err(format!(
            "The working folder {} does not exist",
            cwd.display()
        ));
    }
    Ok(RunLaunch {
        program,
        args: launch.args,
        cwd,
        env: active.environment(app)?,
    })
}

/// clangd's arguments and environment for a project configured with CMake: the active
/// build folder's compilation database and the kit's compiler for system headers.
pub fn clangd_launch(app: &tauri::AppHandle, root: &Path) -> (Vec<String>, Vec<(String, String)>) {
    let Ok(settings) = crate::project::settings_for(app, root) else {
        return Default::default();
    };
    let Ok(active) = resolve(app, root, &settings.cmake) else {
        return Default::default();
    };
    if !active.source.join("CMakeLists.txt").is_file() {
        return Default::default();
    }
    let mut args = Vec::new();
    if active.build.join("compile_commands.json").is_file() {
        args.push(format!("--compile-commands-dir={}", active.build.display()));
    }
    if let Some(kit) = &active.kit
        && matches!(kit.kind, KitKind::Gcc | KitKind::Clang)
    {
        let drivers: Vec<String> = kit
            .c
            .iter()
            .chain(std::iter::once(&kit.cxx))
            .map(|p| p.display().to_string())
            .collect();
        args.push(format!("--query-driver={}", drivers.join(",")));
    }
    (args, active.environment(app).unwrap_or_default())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInfo {
    settings: CMakeSettings,
    program: Option<String>,
    configured: bool,
    generators: Vec<&'static str>,
}
fn settings_info(app: &tauri::AppHandle) -> Result<SettingsInfo, String> {
    let program = cmake_program(app)?;
    Ok(SettingsInfo {
        settings: stored(app)?.settings,
        configured: stored(app)?.program.is_some(),
        program: program.map(|(p, _)| p.display().to_string()),
        generators: GENERATORS.to_vec(),
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
pub async fn cmake_settings(app: tauri::AppHandle) -> Result<SettingsInfo, String> {
    blocking(move || settings_info(&app)).await
}
#[tauri::command]
pub async fn cmake_set_settings(
    app: tauri::AppHandle,
    settings: CMakeSettings,
) -> Result<SettingsInfo, String> {
    settings.validate()?;
    blocking(move || {
        update_stored(&app, |s| s.settings = settings)?;
        settings_info(&app)
    })
    .await
}
/// Lets the user pick the CMake program in a native dialog; `reset` goes back to detection.
#[tauri::command]
pub async fn cmake_choose_program(
    app: tauri::AppHandle,
    reset: bool,
) -> Result<Option<SettingsInfo>, String> {
    let program = if reset {
        None
    } else {
        let Some(file) = rfd::AsyncFileDialog::new()
            .set_title("Choose the cmake program")
            .pick_file()
            .await
        else {
            return Ok(None);
        };
        Some(file.path().canonicalize().map_err(|e| e.to_string())?)
    };
    blocking(move || {
        update_stored(&app, |s| s.program = program)?;
        settings_info(&app).map(Some)
    })
    .await
}
#[tauri::command]
pub async fn cmake_kits(app: tauri::AppHandle, rescan: bool) -> Result<Vec<Kit>, String> {
    blocking(move || kits(&app, rescan)).await
}
#[tauri::command]
pub async fn cmake_project(app: tauri::AppHandle, root: String) -> Result<ProjectInfo, String> {
    blocking(move || project_info(&app, &crate::project::root(&root)?)).await
}

#[derive(Deserialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Step {
    Configure,
    Reconfigure,
    Build,
    Clean,
    CleanRebuild,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    finished: jobs::Finished,
    info: ProjectInfo,
}

/// Runs one CMake step to its end, streaming its output. `target` (build only) must be a
/// target of the last configure; `None` builds all.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn cmake_run(
    app: tauri::AppHandle,
    window: WebviewWindow,
    jobs: State<'_, jobs::Jobs>,
    root: String,
    step: Step,
    target: Option<String>,
    events: Channel<jobs::JobEvent>,
) -> Result<StepResult, String> {
    let jobs = jobs.inner().clone();
    let label = window.label().to_owned();
    blocking(move || {
        let root = crate::project::root(&root)?;
        let key = format!("{label}|{}", root.display());
        if jobs.busy(&key) {
            return Err("A CMake task is already running for this project".into());
        }
        let sink: Arc<dyn Fn(jobs::JobEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = events.send(event);
        });
        let say = |text: String| sink(jobs::JobEvent::Output { text: text + "\n" });
        let settings = stored(&app)?.settings;
        let cmake = crate::project::settings_for(&app, &root)?.cmake;
        let active = resolve(&app, &root, &cmake)?;
        if !active.source.join("CMakeLists.txt").is_file() {
            return Err(format!("{} has no CMakeLists.txt", active.source.display()));
        }
        let program = require_cmake(&app)?;
        let args = match step {
            Step::Configure | Step::Reconfigure => {
                fs::create_dir_all(&active.build)
                    .map_err(|e| format!("{}: {e}", active.build.display()))?;
                fileapi::write_query(&active.build)?;
                active.configure_args(step == Step::Reconfigure)
            }
            Step::Build | Step::CleanRebuild => {
                if let Some(name) = &target {
                    let known = active.targets()?.unwrap_or_default();
                    if !known.iter().any(|t| &t.name == name) {
                        return Err(format!("Unknown target {name}. Configure again?"));
                    }
                }
                active.build_args(
                    target.as_deref(),
                    step == Step::CleanRebuild,
                    settings.parallel_jobs,
                )
            }
            Step::Clean => active.build_args(Some("clean"), false, 0),
        };
        if active.kit.as_ref().is_some_and(|k| k.vs.is_some()) {
            say("[env] Preparing the Visual Studio environment…".into());
        }
        let env = active.environment(&app)?;
        let name = format!("{step:?}").to_lowercase();
        say(format!("[{name}] {}", jobs::shown(&program, &args)));
        let started = std::time::Instant::now();
        let finished = jobs.run(&label, &key, &program, &args, &active.source, &env, sink.clone())?;
        say(if finished.cancelled {
            format!("[{name}] Cancelled")
        } else {
            format!(
                "[{name}] Finished with exit code {} ({:.1} s)",
                finished.code.map_or("?".into(), |c| c.to_string()),
                started.elapsed().as_secs_f32()
            )
        });
        if step != Step::Build
            && step != Step::Clean
            && active.generator.as_deref().is_some_and(|g| g.starts_with("Visual Studio"))
        {
            say("[info] The Visual Studio generator writes no compile_commands.json; clangd works without it.".into());
        }
        Ok(StepResult {
            finished,
            info: project_info(&app, &root)?,
        })
    })
    .await
}
#[tauri::command]
pub fn cmake_cancel(
    window: WebviewWindow,
    jobs: State<jobs::Jobs>,
    root: String,
) -> Result<(), String> {
    let root = crate::project::root(&root)?;
    jobs.cancel(
        window.label(),
        &format!("{}|{}", window.label(), root.display()),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kit() -> Kit {
        Kit {
            id: "k".into(),
            name: "GCC 13".into(),
            slug: "gcc-13".into(),
            kind: KitKind::Gcc,
            c: Some(PathBuf::from("/usr/bin/gcc")),
            cxx: PathBuf::from("/usr/bin/g++"),
            version: "13".into(),
            target: "x86_64-linux-gnu".into(),
            vs: None,
        }
    }
    fn active(generator: &str) -> Active {
        Active {
            source: PathBuf::from("/p"),
            build: PathBuf::from("/p/build/gcc-13-Debug"),
            kit: Some(kit()),
            preset: None,
            build_preset: None,
            generator: Some(generator.into()),
            variant: "Debug".into(),
            multi: multi_config(Some(generator)),
        }
    }

    #[test]
    fn kit_mode_command_lines() {
        let ninja = active("Ninja");
        let args = ninja.configure_args(false);
        assert!(args.contains(&"-DCMAKE_BUILD_TYPE=Debug".into()));
        assert!(args.contains(&"-DCMAKE_CXX_COMPILER=/usr/bin/g++".into()));
        assert!(args.contains(&"-DCMAKE_EXPORT_COMPILE_COMMANDS=ON".into()));
        assert!(!args.contains(&"--fresh".into()));
        assert!(ninja.configure_args(true).contains(&"--fresh".into()));
        assert_eq!(
            ninja.build_args(Some("app"), false, 8),
            [
                "--build",
                "/p/build/gcc-13-Debug",
                "--target",
                "app",
                "--parallel",
                "8"
            ]
        );
        let multi = active("Ninja Multi-Config");
        assert!(
            !multi
                .configure_args(false)
                .iter()
                .any(|a| a.starts_with("-DCMAKE_BUILD_TYPE"))
        );
        assert_eq!(
            multi.build_args(None, true, 0),
            [
                "--build",
                "/p/build/gcc-13-Debug",
                "--config",
                "Debug",
                "--clean-first"
            ]
        );
    }

    #[test]
    fn build_folders_and_choices_are_checked() {
        let source = Path::new("/src");
        assert_eq!(
            expand_build_dir(
                "${sourceDir}/build/${kit}-${variant}",
                source,
                "gcc-13",
                "Debug"
            )
            .unwrap(),
            PathBuf::from("/src/build/gcc-13-Debug")
        );
        assert_eq!(
            expand_build_dir("out", source, "k", "v").unwrap(),
            source.join("out")
        );
        assert!(expand_build_dir("${home}/x", source, "k", "v").is_err());
        let mut cmake = ProjectCMake::default();
        assert!(cmake.validate().is_ok());
        cmake.variant = "Fast".into();
        assert!(cmake.validate().is_err());
        cmake.variant = "Release".into();
        cmake.launch.insert(
            "app".into(),
            Launch {
                args: vec!["a\0b".into()],
                cwd: String::new(),
            },
        );
        assert!(cmake.validate().is_err());
        let settings = CMakeSettings {
            generator: "Borland".into(),
            ..Default::default()
        };
        assert!(settings.validate().is_err());
    }

    /// Configures and builds a small project with a real GCC or Clang kit and CMake when both
    /// are installed: File API targets, the compilation database, the program, and cancel.
    #[test]
    fn configures_builds_and_cancels_with_a_real_kit() {
        let Some(kit) = kits::scan()
            .into_iter()
            .find(|k| matches!(k.kind, KitKind::Gcc | KitKind::Clang))
        else {
            eprintln!("no GCC or Clang kit; skipped");
            return;
        };
        build_with(kit, true);
    }

    /// The Visual Studio environment (vcvarsall) with Ninja, when Visual Studio is installed.
    #[test]
    fn msvc_kit_builds_when_installed() {
        let Some(kit) = kits::scan()
            .into_iter()
            .find(|k| k.kind == KitKind::Msvc && k.target == "x64")
        else {
            eprintln!("no MSVC kit; skipped");
            return;
        };
        let env = kits::environment(&kit).unwrap();
        assert!(env.iter().any(|(n, _)| n.eq_ignore_ascii_case("INCLUDE")));
        build_with(kit, false);
    }

    fn build_with(kit: Kit, cancel: bool) {
        let Some(cmake) = kits::find_on(&kits::path_of(&[]), "cmake") else {
            eprintln!("cmake is not installed; skipped");
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let source = crate::git::plain(&dir.path().canonicalize().unwrap());
        fs::write(
            source.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.16)\nproject(t CXX)\nadd_library(core STATIC core.cpp)\nadd_executable(app main.cpp)\ntarget_link_libraries(app core)\nadd_custom_target(slow COMMAND ${CMAKE_COMMAND} -E sleep 30)\n",
        )
        .unwrap();
        fs::write(source.join("core.cpp"), "int core() { return 1; }\n").unwrap();
        fs::write(
            source.join("main.cpp"),
            "int core();\nint main() { return core() - 1; }\n",
        )
        .unwrap();
        let mut active = active("Ninja");
        active.generator = default_generator(Some(&kit));
        active.multi = false;
        active.source = source.clone();
        active.build = source.join("build");
        active.kit = Some(kit.clone());
        let env = kits::environment(&kit).unwrap();
        let jobs = jobs::Jobs::default();
        let output = Arc::new(Mutex::new(String::new()));
        let sink_output = output.clone();
        let sink: Arc<dyn Fn(jobs::JobEvent) + Send + Sync> = Arc::new(move |event| {
            let jobs::JobEvent::Output { text } = event;
            sink_output.lock().unwrap().push_str(&text);
        });
        fs::create_dir_all(&active.build).unwrap();
        fileapi::write_query(&active.build).unwrap();
        let run = |args: Vec<String>| {
            jobs.run("main", "p", &cmake, &args, &source, &env, sink.clone())
                .unwrap()
        };
        let configured = run(active.configure_args(false));
        assert_eq!(configured.code, Some(0), "{}", output.lock().unwrap());
        assert!(active.build.join("compile_commands.json").is_file());
        let targets = active.targets().unwrap().unwrap();
        let kinds: Vec<(&str, &str)> = targets
            .iter()
            .map(|t| (t.name.as_str(), t.kind.as_str()))
            .collect();
        assert_eq!(
            kinds,
            [
                ("app", "EXECUTABLE"),
                ("core", "STATIC_LIBRARY"),
                ("slow", "UTILITY")
            ]
        );
        let built = run(active.build_args(Some("app"), false, 2));
        assert_eq!(built.code, Some(0), "{}", output.lock().unwrap());
        assert!(Path::new(targets[0].artifact.as_ref().unwrap()).is_file());
        if !cancel {
            return;
        }
        // Cancel ends the step and its children (CMake's sleep) promptly.
        let canceller = jobs.clone();
        let started = std::time::Instant::now();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(2));
            canceller.cancel("main", "p");
        });
        let cancelled = run(active.build_args(Some("slow"), false, 0));
        assert!(cancelled.cancelled);
        assert!(started.elapsed() < std::time::Duration::from_secs(20));
    }

    #[test]
    fn source_folder_stays_inside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("cpp")).unwrap();
        let mut cmake = ProjectCMake {
            source_directory: "cpp".into(),
            ..Default::default()
        };
        assert_eq!(
            source_dir(&root, &cmake).unwrap(),
            crate::git::plain(&root.join("cpp"))
        );
        cmake.source_directory = "..".into();
        assert!(source_dir(&root, &cmake).is_err());
    }
}
