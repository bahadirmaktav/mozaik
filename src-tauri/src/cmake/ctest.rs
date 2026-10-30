//! CTest for the IDE's Testing view: the tests CMake registered (`add_test`, GoogleTest's
//! `gtest_discover_tests`), listed and run with the ctest beside the CMake program, in the
//! active build folder. Both run only when the user asks, as the configure and build steps.
use super::{blocking, fileapi, jobs, require_cmake, resolve};
use serde::Serialize;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{State, WebviewWindow, ipc::Channel};

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestInfo {
    pub name: String,
    /// The executable target the test runs, when it is one of the project's.
    pub target: Option<String>,
    /// The program's arguments that run this test alone (GoogleTest's filter), for Debug.
    pub args: Vec<String>,
    pub disabled: bool,
}

fn ctest_program(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cmake = require_cmake(app)?;
    let path = cmake.with_file_name(if cfg!(windows) { "ctest.exe" } else { "ctest" });
    if path.is_file() {
        Ok(path)
    } else {
        Err(format!("CTest was not found beside {}", cmake.display()))
    }
}
fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}
/// The tests of `ctest --show-only=json-v1`, whose output may start with other messages.
pub fn parse_list(output: &str, targets: &[fileapi::Target]) -> Result<Vec<TestInfo>, String> {
    let start = output
        .find("{\n")
        .or_else(|| output.find('{'))
        .ok_or("CTest listed no tests")?;
    let value: Value = serde_json::Deserializer::from_str(&output[start..])
        .into_iter()
        .next()
        .ok_or("CTest listed no tests")?
        .map_err(|e| format!("CTest's test list could not be read: {e}"))?;
    let tests = value["tests"].as_array().cloned().unwrap_or_default();
    Ok(tests
        .iter()
        .filter_map(|test| {
            let name = test["name"].as_str()?.to_owned();
            let program = test["command"][0].as_str().map(Path::new);
            let target = program.and_then(|program| {
                targets
                    .iter()
                    .filter(|t| t.kind == "EXECUTABLE")
                    .find(|t| {
                        t.artifact
                            .as_deref()
                            .is_some_and(|a| same_file(Path::new(a), program))
                    })
                    .map(|t| t.name.clone())
            });
            let args = test["command"]
                .as_array()
                .map(|command| {
                    command
                        .iter()
                        .skip(1)
                        .filter_map(|a| a.as_str().map(str::to_owned))
                        .collect()
                })
                .unwrap_or_default();
            let disabled = test["properties"].as_array().is_some_and(|props| {
                props
                    .iter()
                    .any(|p| p["name"] == "DISABLED" && p["value"] == true)
            });
            Some(TestInfo {
                name,
                target,
                args,
                disabled,
            })
        })
        .collect())
}
/// A CTest regular expression matching exactly these names.
pub fn name_filter(names: &[String]) -> Result<String, String> {
    if names.is_empty() || names.len() > 10_000 {
        return Err("Choose between 1 and 10000 tests".into());
    }
    let mut pattern = String::from("^(");
    for (index, name) in names.iter().enumerate() {
        if name.is_empty() || name.len() > 1000 || name.chars().any(char::is_control) {
            return Err(format!("Invalid test name {name:?}"));
        }
        if index > 0 {
            pattern.push('|');
        }
        for c in name.chars() {
            if "\\^$.|?*+()[]{}".contains(c) {
                pattern.push('\\');
            }
            pattern.push(c);
        }
    }
    pattern.push_str(")$");
    // Windows command lines end at 32767 characters.
    if pattern.len() > 30_000 {
        return Err("Too many tests are selected at once; run them all instead".into());
    }
    Ok(pattern)
}

struct Setup {
    key: String,
    program: PathBuf,
    build: PathBuf,
    config: Option<String>,
    env: Vec<(String, String)>,
    targets: Vec<fileapi::Target>,
}
fn setup(app: &tauri::AppHandle, label: &str, root: &str) -> Result<Setup, String> {
    let root = crate::project::root(root)?;
    let cmake = crate::project::settings_for(app, &root)?.cmake;
    let active = resolve(app, &root, &cmake)?;
    let targets = active
        .targets()?
        .ok_or("Configure the project before looking for tests")?;
    Ok(Setup {
        key: format!("{label}|{}", root.display()),
        program: ctest_program(app)?,
        config: active.config().map(str::to_owned),
        env: active.environment(app)?,
        build: active.build.clone(),
        targets,
    })
}

/// Lists the active build folder's tests. GoogleTest's discovery may run the test programs
/// to list their tests, so this is a user's action like a build.
#[tauri::command]
pub async fn cmake_tests(
    app: tauri::AppHandle,
    window: WebviewWindow,
    jobs: State<'_, jobs::Jobs>,
    root: String,
) -> Result<Vec<TestInfo>, String> {
    let jobs = jobs.inner().clone();
    let label = window.label().to_owned();
    blocking(move || {
        let setup = setup(&app, &label, &root)?;
        let mut args = vec!["--show-only=json-v1".to_owned()];
        if let Some(config) = &setup.config {
            args.extend(["-C".to_owned(), config.clone()]);
        }
        let output = Arc::new(Mutex::new(String::new()));
        let collected = output.clone();
        let sink: Arc<dyn Fn(jobs::JobEvent) + Send + Sync> = Arc::new(move |event| {
            let jobs::JobEvent::Output { text } = event;
            collected
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push_str(&text);
        });
        let finished = jobs.run(
            &label,
            &setup.key,
            &setup.program,
            &args,
            &setup.build,
            &setup.env,
            sink,
        )?;
        let output = output.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if finished.cancelled {
            return Err("Test discovery was cancelled".into());
        }
        if finished.code != Some(0) {
            return Err(format!(
                "CTest could not list the tests: {}",
                output.trim().lines().last().unwrap_or("")
            ));
        }
        parse_list(&output, &setup.targets)
    })
    .await
}

/// Runs the named tests (all without names) to their end, streaming CTest's output.
#[tauri::command]
pub async fn cmake_test(
    app: tauri::AppHandle,
    window: WebviewWindow,
    jobs: State<'_, jobs::Jobs>,
    root: String,
    tests: Option<Vec<String>>,
    events: Channel<jobs::JobEvent>,
) -> Result<jobs::Finished, String> {
    let jobs = jobs.inner().clone();
    let label = window.label().to_owned();
    blocking(move || {
        let setup = setup(&app, &label, &root)?;
        let mut args = vec!["--output-on-failure".to_owned()];
        if let Some(config) = &setup.config {
            args.extend(["-C".to_owned(), config.clone()]);
        }
        if let Some(names) = &tests {
            args.extend(["-R".to_owned(), name_filter(names)?]);
        }
        let sink: Arc<dyn Fn(jobs::JobEvent) + Send + Sync> = Arc::new(move |event| {
            let _ = events.send(event);
        });
        sink(jobs::JobEvent::Output {
            text: format!("[test] {}\n", jobs::shown(&setup.program, &args)),
        });
        let finished = jobs.run(
            &label,
            &setup.key,
            &setup.program,
            &args,
            &setup.build,
            &setup.env,
            sink.clone(),
        )?;
        sink(jobs::JobEvent::Output {
            text: if finished.cancelled {
                "[test] Cancelled\n".into()
            } else {
                format!(
                    "[test] Finished with exit code {}\n",
                    finished.code.map_or("?".into(), |c| c.to_string())
                )
            },
        });
        Ok(finished)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_tests_with_their_targets() {
        let dir = tempfile::tempdir().unwrap();
        let program = dir.path().join("basic_tests.exe");
        std::fs::write(&program, b"").unwrap();
        let targets = vec![fileapi::Target {
            name: "basic_tests".into(),
            kind: "EXECUTABLE".into(),
            artifact: Some(program.display().to_string()),
        }];
        let output = format!(
            "Some discovery note\n{}",
            serde_json::json!({
                "kind": "ctestInfo",
                "tests": [
                    {
                        "name": "InventoryBasic.StartsEmpty",
                        "command": [program, "--gtest_filter=InventoryBasic.StartsEmpty"],
                        "properties": [{ "name": "WORKING_DIRECTORY", "value": "x" }]
                    },
                    {
                        "name": "InventoryBasic.ShowsAFailure",
                        "command": [program],
                        "properties": [{ "name": "DISABLED", "value": true }]
                    },
                    { "name": "script", "command": ["/bin/sh", "x.sh"] }
                ]
            })
        );
        let tests = parse_list(&output, &targets).unwrap();
        assert_eq!(
            tests,
            [
                TestInfo {
                    name: "InventoryBasic.StartsEmpty".into(),
                    target: Some("basic_tests".into()),
                    args: vec!["--gtest_filter=InventoryBasic.StartsEmpty".into()],
                    disabled: false
                },
                TestInfo {
                    name: "InventoryBasic.ShowsAFailure".into(),
                    target: Some("basic_tests".into()),
                    args: Vec::new(),
                    disabled: true
                },
                TestInfo {
                    name: "script".into(),
                    target: None,
                    args: vec!["x.sh".into()],
                    disabled: false
                }
            ]
        );
        assert!(parse_list("No tests were found!!!", &targets).is_err());
    }

    /// Lists and runs real CTest tests (an exact filter with parentheses, a disabled test)
    /// when CMake and a GCC or Clang kit are installed.
    #[test]
    fn lists_and_runs_real_ctest_tests() {
        use super::super::kits;
        let Some(kit) = kits::scan()
            .into_iter()
            .find(|k| matches!(k.kind, kits::KitKind::Gcc | kits::KitKind::Clang))
        else {
            eprintln!("no GCC or Clang kit; skipped");
            return;
        };
        let Some(cmake) = kits::find_on(&kits::path_of(&[]), "cmake") else {
            eprintln!("cmake is not installed; skipped");
            return;
        };
        let ctest = cmake.with_file_name(if cfg!(windows) { "ctest.exe" } else { "ctest" });
        let dir = tempfile::tempdir().unwrap();
        let source = crate::git::plain(&dir.path().canonicalize().unwrap());
        std::fs::write(
            source.join("CMakeLists.txt"),
            "cmake_minimum_required(VERSION 3.20)\nproject(t CXX)\nenable_testing()\nadd_executable(check check.cpp)\nadd_test(NAME \"Suite.ok/(1, 2)\" COMMAND check 0)\nadd_test(NAME Suite.bad COMMAND check 1)\nadd_test(NAME Suite.off COMMAND check 0)\nset_tests_properties(Suite.off PROPERTIES DISABLED TRUE)\n",
        )
        .unwrap();
        std::fs::write(
            source.join("check.cpp"),
            "#include <cstdio>\n#include <cstdlib>\nint main(int, char** argv) { std::puts(\"checked\"); return std::atoi(argv[1]); }\n",
        )
        .unwrap();
        let build = source.join("build");
        std::fs::create_dir_all(&build).unwrap();
        super::fileapi::write_query(&build).unwrap();
        let env = kits::environment(&kit).unwrap();
        let jobs = jobs::Jobs::default();
        let output = Arc::new(Mutex::new(String::new()));
        let collected = output.clone();
        let sink: Arc<dyn Fn(jobs::JobEvent) + Send + Sync> = Arc::new(move |event| {
            let jobs::JobEvent::Output { text } = event;
            collected.lock().unwrap().push_str(&text);
        });
        let run = |program: &Path, args: Vec<String>, cwd: &Path| {
            output.lock().unwrap().clear();
            jobs.run("main", "p", program, &args, cwd, &env, sink.clone())
                .unwrap()
        };
        let strings = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let generator = if kits::find_on(&kits::path_of(&[]), "ninja").is_some() {
            "Ninja"
        } else if cfg!(windows) {
            "MinGW Makefiles"
        } else {
            "Unix Makefiles"
        };
        let configured = run(
            &cmake,
            vec![
                "-S".into(),
                source.display().to_string(),
                "-B".into(),
                build.display().to_string(),
                "-G".into(),
                generator.into(),
                format!("-DCMAKE_CXX_COMPILER={}", kit.cxx.display()),
            ],
            &source,
        );
        assert_eq!(configured.code, Some(0), "{}", output.lock().unwrap());
        let built = run(
            &cmake,
            strings(&["--build", &build.display().to_string()]),
            &source,
        );
        assert_eq!(built.code, Some(0), "{}", output.lock().unwrap());
        let targets = fileapi::targets(&build, None).unwrap().unwrap();

        run(&ctest, strings(&["--show-only=json-v1"]), &build);
        let tests = parse_list(&output.lock().unwrap(), &targets).unwrap();
        assert_eq!(
            tests
                .iter()
                .map(|t| (t.name.as_str(), t.target.as_deref(), t.disabled))
                .collect::<Vec<_>>(),
            [
                ("Suite.ok/(1, 2)", Some("check"), false),
                ("Suite.bad", Some("check"), false),
                ("Suite.off", Some("check"), true)
            ]
        );
        assert_eq!(tests[1].args, ["1"]);

        let filter = name_filter(&["Suite.ok/(1, 2)".into(), "Suite.off".into()]).unwrap();
        let ran = run(
            &ctest,
            vec!["--output-on-failure".into(), "-R".into(), filter],
            &build,
        );
        let text = output.lock().unwrap().clone();
        assert_eq!(ran.code, Some(0), "{text}");
        assert!(text.contains("Test #1: Suite.ok/(1, 2) ..."), "{text}");
        assert!(text.contains("***Not Run (Disabled)"), "{text}");
        assert!(!text.contains("Suite.bad"), "{text}");
        let failed = run(
            &ctest,
            strings(&["--output-on-failure", "-R", "^(Suite\\.bad)$"]),
            &build,
        );
        assert_ne!(failed.code, Some(0));
        assert!(output.lock().unwrap().contains("***Failed"));
    }

    #[test]
    fn filters_match_names_exactly() {
        assert_eq!(
            name_filter(&["A.b".into(), "P/S.t/(1, 2)".into()]).unwrap(),
            r"^(A\.b|P/S\.t/\(1, 2\))$"
        );
        assert!(name_filter(&[]).is_err());
        assert!(name_filter(&["a\nb".into()]).is_err());
    }
}
