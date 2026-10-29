//! The CMake File API: Tessera's query in the build folder and the targets of the reply.
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

const CLIENT: &str = "client-tessera";
// Reply files are CMake's own; this only guards against reading something unexpected.
const MAX_REPLY_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub name: String,
    /// `EXECUTABLE`, `STATIC_LIBRARY`, `SHARED_LIBRARY`, `MODULE_LIBRARY`, `OBJECT_LIBRARY`,
    /// `INTERFACE_LIBRARY` or `UTILITY`.
    pub kind: String,
    /// The program of an executable, absolute.
    pub artifact: Option<String>,
}

/// Asks CMake to write the code model on its next configure. The only file Tessera writes
/// into a build folder.
pub fn write_query(build: &Path) -> Result<(), String> {
    let dir = build.join(".cmake/api/v1/query").join(CLIENT);
    std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    std::fs::write(
        dir.join("query.json"),
        br#"{"requests":[{"kind":"codemodel","version":2}]}"#,
    )
    .map_err(|e| e.to_string())
}

fn read_json(path: &Path) -> Result<Value, String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if meta.len() > MAX_REPLY_BYTES {
        return Err(format!("{} is too large", path.display()));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", path.display()))
}

/// A file name from a reply: plain, inside the reply folder.
fn reply_file(reply: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err(format!("Unexpected File API reply file {name}"));
    }
    Ok(reply.join(name))
}

/// The targets of the configuration (`config` for multi-config generators; otherwise the
/// only one). `None` when the folder has no reply yet.
pub fn targets(build: &Path, config: Option<&str>) -> Result<Option<Vec<Target>>, String> {
    let reply = build.join(".cmake/api/v1/reply");
    let Ok(entries) = std::fs::read_dir(&reply) else {
        return Ok(None);
    };
    let Some(index) = entries
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.starts_with("index-") && n.ends_with(".json"))
        .max()
    else {
        return Ok(None);
    };
    let index = read_json(&reply_file(&reply, &index)?)?;
    let codemodel = index["reply"][CLIENT]["query.json"]["responses"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(index["objects"].as_array().into_iter().flatten())
        .find(|o| o["kind"] == "codemodel")
        .and_then(|o| o["jsonFile"].as_str())
        .ok_or("The CMake reply has no code model")?
        .to_owned();
    let model = read_json(&reply_file(&reply, &codemodel)?)?;
    let configurations = model["configurations"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let configuration = config
        .and_then(|c| configurations.iter().find(|x| x["name"] == c))
        .or_else(|| configurations.first())
        .ok_or("The CMake code model has no configuration")?;
    let mut list = Vec::new();
    for target in configuration["targets"].as_array().into_iter().flatten() {
        let (Some(name), Some(file)) = (target["name"].as_str(), target["jsonFile"].as_str())
        else {
            continue;
        };
        let detail = read_json(&reply_file(&reply, file)?)?;
        let kind = detail["type"].as_str().unwrap_or("UTILITY").to_owned();
        let artifact = (kind == "EXECUTABLE")
            .then(|| detail["artifacts"][0]["path"].as_str())
            .flatten()
            .map(|p| {
                let path = Path::new(p);
                let path = if path.is_relative() {
                    build.join(path)
                } else {
                    path.to_owned()
                };
                path.to_string_lossy().into_owned()
            });
        list.push(Target {
            name: name.to_owned(),
            kind,
            artifact,
        });
    }
    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(Some(list))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_targets_are_read_and_names_checked() {
        let dir = tempfile::tempdir().unwrap();
        let build = dir.path();
        assert_eq!(targets(build, None).unwrap(), None);
        write_query(build).unwrap();
        assert!(
            build
                .join(".cmake/api/v1/query/client-tessera/query.json")
                .is_file()
        );
        let reply = build.join(".cmake/api/v1/reply");
        std::fs::create_dir_all(&reply).unwrap();
        std::fs::write(
            reply.join("index-1.json"),
            r#"{"objects":[{"kind":"codemodel","jsonFile":"codemodel-v2-a.json"}]}"#,
        )
        .unwrap();
        std::fs::write(
            reply.join("codemodel-v2-a.json"),
            r#"{"configurations":[
                {"name":"Debug","targets":[{"name":"app","jsonFile":"t-app.json"},
                                           {"name":"Lib","jsonFile":"t-lib.json"}]},
                {"name":"Release","targets":[]}]}"#,
        )
        .unwrap();
        std::fs::write(
            reply.join("t-app.json"),
            r#"{"type":"EXECUTABLE","artifacts":[{"path":"bin/app.exe"}]}"#,
        )
        .unwrap();
        std::fs::write(reply.join("t-lib.json"), r#"{"type":"STATIC_LIBRARY"}"#).unwrap();
        let list = targets(build, Some("Debug")).unwrap().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].kind, "EXECUTABLE");
        assert_eq!(
            list[0].artifact.as_deref(),
            Some(build.join("bin/app.exe").to_string_lossy().as_ref())
        );
        assert_eq!(list[1].artifact, None);
        assert!(targets(build, Some("Release")).unwrap().unwrap().is_empty());
        std::fs::write(
            reply.join("index-2.json"),
            r#"{"objects":[{"kind":"codemodel","jsonFile":"../x.json"}]}"#,
        )
        .unwrap();
        assert!(targets(build, None).is_err());
    }
}
