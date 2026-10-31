//! Compiler kits: the toolchains found on this system, like CMake Tools' kit scan. Only
//! fixed, read-only queries run here (`vswhere`, `<compiler> --version`/`-dumpmachine`,
//! `vcvarsall.bat <arch> && set`); their programs come from the system, never the renderer.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum KitKind {
    Msvc,
    Gcc,
    Clang,
    ClangCl,
}

/// A Visual Studio installation whose `vcvarsall.bat` prepares the environment.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VsEnvironment {
    pub install: PathBuf,
    /// `vcvarsall.bat` argument: `x64`, `x64_x86`, `x64_arm64`.
    pub arch: String,
    /// Major version (17 is Visual Studio 2022), for the Visual Studio generator name.
    pub major: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Kit {
    pub id: String,
    pub name: String,
    /// Short, path-safe name for build folders, unique within a scan.
    pub slug: String,
    pub kind: KitKind,
    pub c: Option<PathBuf>,
    pub cxx: PathBuf,
    pub version: String,
    pub target: String,
    pub vs: Option<VsEnvironment>,
}
impl Kit {
    /// The `-A` platform of the Visual Studio generator.
    pub fn platform(&self) -> &'static str {
        match self.vs.as_ref().map(|v| v.arch.as_str()) {
            Some("x64_x86" | "x86") => "Win32",
            Some("x64_arm64" | "arm64") => "ARM64",
            _ => "x64",
        }
    }
}

const QUERY_TIMEOUT: Duration = Duration::from_secs(10);
const VCVARS_TIMEOUT: Duration = Duration::from_secs(60);

pub fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Runs a short query and returns its standard output, or `None` on failure or timeout.
pub fn query(command: &mut Command, timeout: Duration) -> Option<Vec<u8>> {
    hide_window(command);
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut out = Vec::new();
        let _ = std::io::Read::read_to_end(&mut stdout, &mut out);
        out
    });
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = reader.join().ok()?;
                return status.success().then_some(out);
            }
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(15))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn hash(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest[..6].iter().map(|b| format!("{b:02x}")).collect()
}

/// `gcc`, `gcc-13`, `clang`, `clang-18` (with `.exe` on Windows) and the C++ driver name.
fn driver(file: &str) -> Option<(&'static str, String)> {
    let stem = file.strip_suffix(".exe").unwrap_or(file);
    let (base, suffix) = match stem.find('-') {
        Some(i) => (&stem[..i], &stem[i..]),
        None => (stem, ""),
    };
    if !suffix.is_empty()
        && !suffix[1..]
            .split('.')
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let ext = if file.ends_with(".exe") { ".exe" } else { "" };
    match base {
        "gcc" => Some(("gcc", format!("g++{suffix}{ext}"))),
        "clang" => Some(("clang", format!("clang++{suffix}{ext}"))),
        _ => None,
    }
}

/// The first `x.y` or `x.y.z` in a `--version` banner.
pub fn version_in(text: &str) -> Option<String> {
    let line = text.lines().next()?;
    line.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|w| w.split('.').filter(|p| !p.is_empty()).count() >= 2 && !w.starts_with('.'))
        .map(|w| w.trim_end_matches('.').to_owned())
}

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if cfg!(windows) {
        for env in ["ProgramFiles", "ProgramW6432"] {
            if let Some(root) = std::env::var_os(env) {
                dirs.push(Path::new(&root).join("LLVM").join("bin"));
            }
        }
        for msys in ["ucrt64", "mingw64", "clang64", "mingw32"] {
            dirs.push(Path::new("C:\\msys64").join(msys).join("bin"));
        }
        dirs.push(PathBuf::from("C:\\mingw64\\bin"));
    }
    dirs
}

fn gnu_kits(vs: &[VsEnvironment]) -> Vec<Kit> {
    let mut seen = HashSet::new();
    let mut kits = Vec::new();
    for dir in search_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter_map(|e| e.file_name().into_string().ok())
            .collect();
        names.sort();
        for name in names {
            let Some((family, cxx_name)) = driver(&name) else {
                continue;
            };
            let (c, cxx) = (dir.join(&name), dir.join(&cxx_name));
            let Ok(canonical) = cxx.canonicalize() else {
                continue;
            };
            if !seen.insert(canonical) {
                continue;
            }
            let Some(banner) = query(Command::new(&c).arg("--version"), QUERY_TIMEOUT) else {
                continue;
            };
            let banner = String::from_utf8_lossy(&banner).into_owned();
            // Apple's and some distributions' `gcc` is clang under another name.
            let family = if banner.contains("clang version") {
                "clang"
            } else {
                family
            };
            let target = query(Command::new(&c).arg("-dumpmachine"), QUERY_TIMEOUT)
                .map(|t| String::from_utf8_lossy(&t).trim().to_owned())
                .unwrap_or_default();
            let version = version_in(&banner).unwrap_or_default();
            let (kind, label) = if family == "gcc" {
                (KitKind::Gcc, "GCC")
            } else {
                (KitKind::Clang, "Clang")
            };
            // An MSVC-targeting clang needs the Visual Studio headers and libraries.
            let vs = target
                .contains("msvc")
                .then(|| vs.iter().find(|v| v.arch == "x64").cloned())
                .flatten();
            kits.push(Kit {
                id: hash(&format!("{kind:?}|{}", cxx.display())),
                name: format!("{label} {version} {target}").trim().to_owned(),
                slug: format!("{}-{version}", label.to_lowercase()),
                kind,
                c: Some(c),
                cxx,
                version,
                target,
                vs,
            });
        }
    }
    kits
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VsInstance {
    installation_path: PathBuf,
    display_name: Option<String>,
    installation_version: String,
}

fn vs_instances() -> Vec<VsInstance> {
    let Some(root) = std::env::var_os("ProgramFiles(x86)") else {
        return Vec::new();
    };
    let vswhere = Path::new(&root)
        .join("Microsoft Visual Studio")
        .join("Installer")
        .join("vswhere.exe");
    if !vswhere.is_file() {
        return Vec::new();
    }
    query(
        Command::new(vswhere).args([
            "-all",
            "-products",
            "*",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-format",
            "json",
            "-utf8",
        ]),
        QUERY_TIMEOUT,
    )
    .and_then(|out| serde_json::from_slice(&out).ok())
    .unwrap_or_default()
}

fn msvc_kits() -> (Vec<Kit>, Vec<VsEnvironment>) {
    let mut kits = Vec::new();
    let mut environments = Vec::new();
    for instance in vs_instances() {
        let install = instance.installation_path;
        let major: u32 = instance
            .installation_version
            .split('.')
            .next()
            .and_then(|m| m.parse().ok())
            .unwrap_or(0);
        let vc = install.join("VC");
        let Ok(tools) = std::fs::read_to_string(
            vc.join("Auxiliary")
                .join("Build")
                .join("Microsoft.VCToolsVersion.default.txt"),
        ) else {
            continue;
        };
        let tools = tools.trim().to_owned();
        let bin = vc
            .join("Tools")
            .join("MSVC")
            .join(&tools)
            .join("bin")
            .join("Hostx64");
        let product = instance
            .display_name
            .unwrap_or_else(|| format!("Visual Studio {major}"));
        for (target, arch, label) in [
            ("x64", "x64", "amd64"),
            ("x86", "x64_x86", "amd64_x86"),
            ("arm64", "x64_arm64", "amd64_arm64"),
        ] {
            let cl = bin.join(target).join("cl.exe");
            if !cl.is_file() {
                continue;
            }
            let vs = VsEnvironment {
                install: install.clone(),
                arch: arch.into(),
                major,
            };
            kits.push(Kit {
                id: hash(&format!("msvc|{}|{arch}", install.display())),
                name: format!("{product} Release - {label}"),
                slug: format!("msvc-{major}-{target}"),
                kind: KitKind::Msvc,
                c: Some(cl.clone()),
                cxx: cl,
                version: tools.clone(),
                target: target.into(),
                vs: Some(vs.clone()),
            });
            environments.push(vs);
        }
        let bundled = vc
            .join("Tools")
            .join("Llvm")
            .join("x64")
            .join("bin")
            .join("clang-cl.exe");
        if let Some(vs) = environments
            .iter()
            .find(|v| v.install == install && v.arch == "x64")
            && bundled.is_file()
        {
            kits.push(clang_cl(&bundled, vs.clone(), &format!("VS {major}")));
        }
    }
    (kits, environments)
}

fn clang_cl(path: &Path, vs: VsEnvironment, owner: &str) -> Kit {
    let version = query(Command::new(path).arg("--version"), QUERY_TIMEOUT)
        .and_then(|b| version_in(&String::from_utf8_lossy(&b)))
        .unwrap_or_default();
    Kit {
        id: hash(&format!("clang-cl|{}", path.display())),
        name: format!("Clang-cl {version} ({owner}, amd64)"),
        slug: format!("clang-cl-{version}"),
        kind: KitKind::ClangCl,
        c: Some(path.to_owned()),
        cxx: path.to_owned(),
        version,
        target: "x86_64-pc-windows-msvc".into(),
        vs: Some(vs),
    }
}

/// Every kit on this system. Takes seconds (each compiler is asked for its version).
pub fn scan() -> Vec<Kit> {
    let (mut kits, environments) = if cfg!(windows) {
        msvc_kits()
    } else {
        (Vec::new(), Vec::new())
    };
    kits.extend(gnu_kits(&environments));
    // clang-cl outside Visual Studio (LLVM, MSYS2) uses the newest Visual Studio environment.
    if let Some(vs) = environments.iter().rev().find(|v| v.arch == "x64") {
        let known: HashSet<PathBuf> = kits
            .iter()
            .filter_map(|k| k.cxx.canonicalize().ok())
            .collect();
        let mut seen = HashSet::new();
        for dir in search_dirs() {
            let path = dir.join("clang-cl.exe");
            if let Ok(canonical) = path.canonicalize()
                && !known.contains(&canonical)
                && seen.insert(canonical)
            {
                kits.push(clang_cl(&path, vs.clone(), "Visual Studio"));
            }
        }
    }
    unique_slugs(&mut kits);
    kits
}

fn unique_slugs(kits: &mut [Kit]) {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for kit in kits.iter() {
        *counts.entry(kit.slug.clone()).or_default() += 1;
    }
    for kit in kits.iter_mut() {
        if counts[&kit.slug] > 1 {
            kit.slug = format!("{}-{}", kit.slug, &kit.id[..6]);
        }
    }
}

static ENVIRONMENTS: Mutex<BTreeMap<String, Vec<(String, String)>>> = Mutex::new(BTreeMap::new());

/// `set` output of `cmd /u`: UTF-16LE `NAME=value` lines.
pub fn parse_set(output: &[u8]) -> Vec<(String, String)> {
    let units: Vec<u16> = output
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .collect();
    String::from_utf16_lossy(&units)
        .lines()
        .filter_map(|line| {
            let (name, value) = line.split_once('=')?;
            (!name.is_empty()).then(|| (name.to_owned(), value.to_owned()))
        })
        .collect()
}

fn vcvars(vs: &VsEnvironment) -> Result<Vec<(String, String)>, String> {
    let key = format!("{}|{}", vs.install.display(), vs.arch);
    if let Some(env) = ENVIRONMENTS.lock().map_err(|e| e.to_string())?.get(&key) {
        return Ok(env.clone());
    }
    let script = vs
        .install
        .join("VC")
        .join("Auxiliary")
        .join("Build")
        .join("vcvarsall.bat");
    if !script.is_file() {
        return Err(format!("{} is missing", script.display()));
    }
    let mut command = Command::new("cmd.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // `cmd /u` writes `set` in UTF-16, so non-ASCII paths survive.
        command.raw_arg(format!(
            "/d /u /s /c \"\"{}\" {} >nul 2>&1 && set\"",
            script.display(),
            vs.arch
        ));
    }
    // English compiler messages, so build problems can be recognised.
    command.env("VSLANG", "1033");
    let output = query(&mut command, VCVARS_TIMEOUT)
        .ok_or_else(|| format!("{} {} failed", script.display(), vs.arch))?;
    let env = parse_set(&output);
    if !env.iter().any(|(n, _)| n.eq_ignore_ascii_case("INCLUDE")) {
        return Err(format!("{} did not set up MSVC", script.display()));
    }
    ENVIRONMENTS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(key, env.clone());
    Ok(env)
}

/// Environment variables to set for a kit's configure, build, run and language server.
pub fn environment(kit: &Kit) -> Result<Vec<(String, String)>, String> {
    if let Some(vs) = &kit.vs {
        let mut env = vcvars(vs)?;
        env.push(("VSLANG".into(), "1033".into()));
        // An external clang-cl must come first on PATH, before Visual Studio's own.
        if kit.kind == KitKind::ClangCl
            && let Some(dir) = kit.cxx.parent()
            && let Some(path) = env.iter_mut().find(|(n, _)| n.eq_ignore_ascii_case("PATH"))
        {
            path.1 = format!("{};{}", dir.display(), path.1);
        }
        return Ok(env);
    }
    // MinGW compilers and the programs they build need their own folder on PATH (DLLs).
    let mut paths: Vec<PathBuf> = kit.cxx.parent().into_iter().map(Path::to_owned).collect();
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let joined: OsString = std::env::join_paths(paths).map_err(|e| e.to_string())?;
    Ok(vec![("PATH".into(), joined.to_string_lossy().into_owned())])
}

/// The value of PATH in an environment layer, falling back to this process.
pub fn path_of(env: &[(String, String)]) -> OsString {
    env.iter()
        .find(|(n, _)| n.eq_ignore_ascii_case("PATH"))
        .map(|(_, v)| OsString::from(v))
        .or_else(|| std::env::var_os("PATH"))
        .unwrap_or_default()
}

/// A program on a PATH value (`ninja`, `cmake`).
pub fn find_on(path: &OsString, program: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.into()
    };
    std::env::split_paths(path)
        .map(|dir| dir.join(&file))
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drivers_versions_and_set_output_are_recognised() {
        assert_eq!(driver("gcc.exe"), Some(("gcc", "g++.exe".into())));
        assert_eq!(driver("clang-18"), Some(("clang", "clang++-18".into())));
        assert_eq!(driver("gcc-ar"), None);
        assert_eq!(driver("clang-format"), None);
        assert_eq!(driver("clangd"), None);
        assert_eq!(
            version_in("gcc.exe (Rev8, Built by MSYS2 project) 15.2.0\nCopyright"),
            Some("15.2.0".into())
        );
        assert_eq!(
            version_in("clang version 21.1.4\nTarget: x"),
            Some("21.1.4".into())
        );
        let text: Vec<u8> = "INCLUDE=C:\\VC\\include\r\n=C:=C:\\\r\nPath=C:\\bin\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(
            parse_set(&text),
            vec![
                ("INCLUDE".into(), "C:\\VC\\include".into()),
                ("Path".into(), "C:\\bin".into())
            ]
        );
    }

    /// Lists this machine's kits: `cargo test print_kits -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn print_kits() {
        for kit in scan() {
            println!("{:<55} {:<22} {}", kit.name, kit.slug, kit.cxx.display());
        }
    }

    #[test]
    fn duplicate_slugs_get_their_id() {
        let kit = |id: &str| Kit {
            id: id.into(),
            name: "GCC".into(),
            slug: "gcc-13".into(),
            kind: KitKind::Gcc,
            c: None,
            cxx: PathBuf::from("g++"),
            version: "13".into(),
            target: String::new(),
            vs: None,
        };
        let mut kits = vec![kit("aaaaaaaaaaaa"), kit("bbbbbbbbbbbb")];
        unique_slugs(&mut kits);
        assert_eq!(kits[0].slug, "gcc-13-aaaaaa");
        assert_eq!(kits[1].slug, "gcc-13-bbbbbb");
    }
}
