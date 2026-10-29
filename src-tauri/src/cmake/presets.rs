//! `CMakePresets.json` and `CMakeUserPresets.json`, read without running CMake: the visible
//! presets, their inheritance, conditions and the build folder. CMake itself applies the
//! preset when it is configured with `--preset`.
use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

const MAX_INCLUDE_DEPTH: usize = 10;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub name: String,
    pub display: String,
    /// The configure preset of a build preset.
    pub configure: Option<String>,
}

/// A configure preset with its parents applied.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Configure {
    pub name: String,
    pub generator: Option<String>,
    pub binary_dir: Option<String>,
    pub architecture: Option<(String, String)>,
    pub toolset: Option<(String, String)>,
    pub cache: BTreeMap<String, String>,
    pub environment: BTreeMap<String, String>,
    pub file_dir: PathBuf,
}

struct Entry {
    value: Map<String, Value>,
    file_dir: PathBuf,
}
#[derive(Default)]
pub struct Presets {
    configure: BTreeMap<String, Entry>,
    build: BTreeMap<String, Entry>,
}

pub fn exists(source: &Path) -> bool {
    source.join("CMakePresets.json").is_file() || source.join("CMakeUserPresets.json").is_file()
}

fn read_file(
    path: &Path,
    presets: &mut Presets,
    seen: &mut HashSet<PathBuf>,
    depth: usize,
) -> Result<(), String> {
    if depth > MAX_INCLUDE_DEPTH {
        return Err("CMake presets include each other too deeply".into());
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if !seen.insert(canonical.clone()) {
        return Ok(());
    }
    let text = std::fs::read(&canonical).map_err(|e| format!("{}: {e}", path.display()))?;
    let json: Value = serde_json::from_slice(&text)
        .map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
    let dir = canonical.parent().unwrap_or(Path::new("")).to_owned();
    for include in json["include"].as_array().into_iter().flatten() {
        if let Some(file) = include.as_str() {
            read_file(&dir.join(file), presets, seen, depth + 1)?;
        }
    }
    for (key, target) in [
        ("configurePresets", &mut presets.configure),
        ("buildPresets", &mut presets.build),
    ] {
        for preset in json[key].as_array().into_iter().flatten() {
            if let (Some(name), Some(object)) = (preset["name"].as_str(), preset.as_object()) {
                target.insert(
                    name.to_owned(),
                    Entry {
                        value: object.clone(),
                        file_dir: dir.clone(),
                    },
                );
            }
        }
    }
    Ok(())
}

pub fn read(source: &Path) -> Result<Presets, String> {
    let mut presets = Presets::default();
    let mut seen = HashSet::new();
    let project = source.join("CMakePresets.json");
    if project.is_file() {
        read_file(&project, &mut presets, &mut seen, 0)?;
    }
    // The user file implicitly includes the project file, already read above.
    let user = source.join("CMakeUserPresets.json");
    if user.is_file() {
        read_file(&user, &mut presets, &mut seen, 0)?;
    }
    Ok(presets)
}

fn parents(value: &Map<String, Value>) -> Vec<String> {
    match &value.get("inherits") {
        Some(Value::String(one)) => vec![one.clone()],
        Some(Value::Array(many)) => many
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    }
}

/// The preset's fields with inherited ones filled in: the preset first, then each parent
/// in order (maps merge, the nearer value wins).
fn merged(
    all: &BTreeMap<String, Entry>,
    name: &str,
    depth: usize,
) -> Result<Map<String, Value>, String> {
    if depth > 32 {
        return Err(format!("Preset {name} inherits from itself"));
    }
    let entry = all
        .get(name)
        .ok_or_else(|| format!("Unknown preset {name}"))?;
    let mut result = entry.value.clone();
    for parent in parents(&entry.value) {
        let inherited = merged(all, &parent, depth + 1)?;
        for (key, value) in inherited {
            if matches!(
                key.as_str(),
                "name" | "hidden" | "inherits" | "displayName" | "condition"
            ) {
                continue;
            }
            match (result.get_mut(&key), value) {
                (Some(Value::Object(mine)), Value::Object(theirs))
                    if matches!(key.as_str(), "cacheVariables" | "environment") =>
                {
                    for (k, v) in theirs {
                        mine.entry(k).or_insert(v);
                    }
                }
                (None, value) => {
                    result.insert(key, value);
                }
                _ => {}
            }
        }
    }
    Ok(result)
}

pub fn host_system() -> &'static str {
    if cfg!(windows) {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "Darwin"
    } else {
        "Linux"
    }
}

/// Expands the preset macros CMake defines for these fields; an unknown macro is an error
/// rather than a guess.
pub fn expand(
    text: &str,
    source: &Path,
    preset: &str,
    generator: Option<&str>,
    file_dir: &Path,
    environment: &BTreeMap<String, String>,
) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find('$') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let open = rest.find('{').filter(|&i| i <= 5);
        let close = open.and_then(|o| rest[o..].find('}').map(|c| o + c));
        let (Some(open), Some(close)) = (open, close) else {
            out.push('$');
            rest = &rest[1..];
            continue;
        };
        let (kind, name) = (&rest[1..open], &rest[open + 1..close]);
        let value = match (kind, name) {
            ("", "sourceDir") => source.display().to_string(),
            ("", "sourceParentDir") => source.parent().unwrap_or(source).display().to_string(),
            ("", "sourceDirName") => source
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            ("", "presetName") => preset.to_owned(),
            ("", "generator") => generator.unwrap_or_default().to_owned(),
            ("", "hostSystemName") => host_system().to_owned(),
            ("", "fileDir") => file_dir.display().to_string(),
            ("", "dollar") => "$".into(),
            ("", "pathListSep") => if cfg!(windows) { ";" } else { ":" }.into(),
            ("env", var) => environment
                .get(var)
                .cloned()
                .or_else(|| std::env::var(var).ok())
                .unwrap_or_default(),
            ("penv", var) => std::env::var(var).unwrap_or_default(),
            _ => return Err(format!("Unsupported preset macro {}", &rest[..=close])),
        };
        out.push_str(&value);
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn condition(value: &Value, expand: &dyn Fn(&str) -> String) -> bool {
    let Some(object) = value.as_object() else {
        // `true`/`false`/`null` literals.
        return value.as_bool().unwrap_or(true);
    };
    let text = |key: &str| expand(object.get(key).and_then(Value::as_str).unwrap_or_default());
    let list = || -> Vec<String> {
        object
            .get("list")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|v| v.as_str().map(expand))
            .collect()
    };
    let conditions = || {
        object
            .get("conditions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    match object.get("type").and_then(Value::as_str) {
        Some("const") => object.get("value").and_then(Value::as_bool).unwrap_or(true),
        Some("equals") => text("lhs") == text("rhs"),
        Some("notEquals") => text("lhs") != text("rhs"),
        Some("inList") => list().contains(&text("string")),
        Some("notInList") => !list().contains(&text("string")),
        Some("anyOf") => conditions().iter().any(|c| condition(c, expand)),
        Some("allOf") => conditions().iter().all(|c| condition(c, expand)),
        Some("not") => !object
            .get("condition")
            .is_some_and(|c| condition(c, expand)),
        // `matches`/`notMatches` and unknown types: shown, CMake decides.
        _ => true,
    }
}

fn display(value: &Map<String, Value>, name: &str) -> String {
    value
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or(name)
        .to_owned()
}

fn visible(presets: &BTreeMap<String, Entry>, source: &Path) -> Vec<(String, Map<String, Value>)> {
    let mut list = Vec::new();
    for (name, entry) in presets {
        if entry.value.get("hidden").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Ok(value) = merged(presets, name, 0) else {
            continue;
        };
        let env: BTreeMap<String, String> = BTreeMap::new();
        let expand = |text: &str| {
            expand(text, source, name, None, &entry.file_dir, &env).unwrap_or_default()
        };
        if entry
            .value
            .get("condition")
            .is_some_and(|c| !condition(c, &expand))
        {
            continue;
        }
        list.push((name.clone(), value));
    }
    list
}

impl Presets {
    pub fn configure_list(&self, source: &Path) -> Vec<PresetInfo> {
        visible(&self.configure, source)
            .into_iter()
            .map(|(name, value)| PresetInfo {
                display: display(&value, &name),
                name,
                configure: None,
            })
            .collect()
    }
    pub fn build_list(&self, source: &Path) -> Vec<PresetInfo> {
        visible(&self.build, source)
            .into_iter()
            .map(|(name, value)| PresetInfo {
                display: display(&value, &name),
                configure: value
                    .get("configurePreset")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                name,
            })
            .collect()
    }
    pub fn configure(&self, name: &str) -> Result<Configure, String> {
        let value = merged(&self.configure, name, 0)?;
        let strategy = |key: &str| match value.get(key) {
            Some(Value::String(v)) => Some((v.clone(), "set".to_owned())),
            Some(Value::Object(o)) => o.get("value").and_then(Value::as_str).map(|v| {
                (
                    v.to_owned(),
                    o.get("strategy")
                        .and_then(Value::as_str)
                        .unwrap_or("set")
                        .to_owned(),
                )
            }),
            _ => None,
        };
        let strings = |key: &str| -> BTreeMap<String, String> {
            value
                .get(key)
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(k, v)| {
                    let text = match v {
                        Value::String(s) => s.clone(),
                        Value::Bool(b) => if *b { "ON" } else { "OFF" }.into(),
                        Value::Object(o) => match o.get("value")? {
                            Value::String(s) => s.clone(),
                            Value::Bool(b) => if *b { "ON" } else { "OFF" }.into(),
                            _ => return None,
                        },
                        _ => return None,
                    };
                    Some((k.clone(), text))
                })
                .collect()
        };
        Ok(Configure {
            name: name.to_owned(),
            generator: value
                .get("generator")
                .and_then(Value::as_str)
                .map(str::to_owned),
            binary_dir: value
                .get("binaryDir")
                .and_then(Value::as_str)
                .map(str::to_owned),
            architecture: strategy("architecture"),
            toolset: strategy("toolset"),
            cache: strings("cacheVariables"),
            environment: strings("environment"),
            file_dir: self.configure[name].file_dir.clone(),
        })
    }
}

impl Configure {
    /// The build folder: `binaryDir` expanded, or CMake Tools' default when it is missing.
    pub fn build_dir(&self, source: &Path) -> Result<PathBuf, String> {
        let text = self
            .binary_dir
            .clone()
            .unwrap_or_else(|| "${sourceDir}/out/build/${presetName}".into());
        let expanded = expand(
            &text,
            source,
            &self.name,
            self.generator.as_deref(),
            &self.file_dir,
            &self.environment,
        )?;
        let path = PathBuf::from(expanded);
        Ok(if path.is_relative() {
            source.join(path)
        } else {
            path
        })
    }
    /// Whether the compiler needs the Visual Studio environment (Ninja or Makefiles with cl
    /// or clang-cl, or an `external` architecture), and for which architecture.
    pub fn msvc_arch(&self) -> Option<String> {
        if self
            .generator
            .as_deref()
            .is_some_and(|g| g.starts_with("Visual Studio"))
        {
            return None;
        }
        let external = self
            .architecture
            .as_ref()
            .is_some_and(|(_, s)| s == "external")
            || self.toolset.as_ref().is_some_and(|(_, s)| s == "external");
        let msvc_compiler = ["CMAKE_CXX_COMPILER", "CMAKE_C_COMPILER"].iter().any(|k| {
            self.cache.get(*k).is_some_and(|c| {
                let file = Path::new(c)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                matches!(file.as_str(), "cl" | "cl.exe" | "clang-cl" | "clang-cl.exe")
            })
        });
        (cfg!(windows) && (external || msvc_compiler)).then(|| {
            self.architecture
                .as_ref()
                .map(|(a, _)| a.to_lowercase())
                .unwrap_or_else(|| "x64".into())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_inherit_hide_and_honour_conditions() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("CMakePresets.json"),
            r#"{
              "version": 6,
              "include": ["more.json"],
              "configurePresets": [
                {"name": "base", "hidden": true, "generator": "Ninja",
                 "binaryDir": "${sourceDir}/out/${presetName}",
                 "cacheVariables": {"A": "1", "CMAKE_CXX_COMPILER": "cl.exe"}},
                {"name": "debug", "inherits": "base", "displayName": "Debug",
                 "cacheVariables": {"A": "2", "B": {"type": "BOOL", "value": true}}},
                {"name": "never", "inherits": "base",
                 "condition": {"type": "equals", "lhs": "${hostSystemName}", "rhs": "Plan9"}}
              ],
              "buildPresets": [{"name": "build-debug", "configurePreset": "debug"}]
            }"#,
        )
        .unwrap();
        std::fs::write(
            dir.path().join("more.json"),
            r#"{"version": 6, "configurePresets": [{"name": "extra", "binaryDir": "b"}]}"#,
        )
        .unwrap();
        let source = dir.path().canonicalize().unwrap();
        let presets = read(&source).unwrap();
        let names: Vec<String> = presets
            .configure_list(&source)
            .into_iter()
            .map(|p| p.name)
            .collect();
        assert_eq!(names, ["debug", "extra"]);
        let debug = presets.configure("debug").unwrap();
        assert_eq!(debug.generator.as_deref(), Some("Ninja"));
        assert_eq!(debug.cache["A"], "2");
        assert_eq!(debug.cache["B"], "ON");
        assert_eq!(
            debug.build_dir(&source).unwrap(),
            PathBuf::from(format!("{}/out/debug", source.display()))
        );
        assert_eq!(
            presets
                .configure("extra")
                .unwrap()
                .build_dir(&source)
                .unwrap(),
            source.join("b")
        );
        assert_eq!(debug.msvc_arch(), cfg!(windows).then(|| "x64".to_owned()));
        assert_eq!(
            presets.build_list(&source)[0].configure.as_deref(),
            Some("debug")
        );
    }

    #[test]
    fn unknown_macros_are_refused() {
        let env = BTreeMap::new();
        let p = Path::new("/src");
        assert_eq!(
            expand("${dollar}{x}/$env{NOPE_X}", p, "a", None, p, &env).unwrap(),
            "${x}/"
        );
        assert!(expand("${vendor}", p, "a", None, p, &env).is_err());
    }
}
