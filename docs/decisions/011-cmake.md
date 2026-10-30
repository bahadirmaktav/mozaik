# 011: CMake in the IDE

Status: accepted (V0.7, third review round). The user decided to build C++ projects in
Tessera after the IDE review, after the model of VS Code's CMake Tools, so "CMake/build/run"
left the list of excluded features. Debugging came in V0.8 ([decision 012](012-debugging.md));
CTest, remote/container builds and a cache
editor stay out.

## What exists

A project whose source folder holds a `CMakeLists.txt` gets CMake choices and actions in its
status bar and the command palette (`CMake: …`, no default shortcuts). The source folder is
the project root unless Project Settings name a subfolder (for repositories whose CMake
project is not at the top).

| Part              | Where                                        | Notes                                                              |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------ |
| Kits              | `src-tauri/src/cmake/kits.rs`                | MSVC (x64, x86, arm64 per Visual Studio), GCC, Clang, clang-cl     |
| Presets           | `cmake/presets.rs`                           | Read without running CMake: includes, inheritance, conditions      |
| Configure/build   | `cmake/mod.rs`, `cmake/jobs.rs`              | Command lines built in Rust; one job per project and window        |
| Targets           | `cmake/fileapi.rs`                           | CMake File API `codemodel` v2, never `compile_commands.json`       |
| Run               | `terminal.rs` (`create_terminal` with `run`) | The executable in its own PTY session, the panel's **Run** view    |
| Output            | `src/plugins/ide/channels.ts`, `Output.tsx`  | Output channels (first: CMake), bounded, virtual rendering         |
| Problems          | `buildOutput.ts`                             | GCC/Clang, MSVC and `CMake Error/Warning at` lines become problems |
| clangd            | `cmake::clangd_launch`                       | `--compile-commands-dir`, `--query-driver`, the kit's environment  |
| UI state, actions | `src/plugins/ide/cmake.ts`, `Status.tsx`     | Pick lists in the command palette                                  |

## Decisions

- **Nothing runs on its own.** Opening a project reads files only (presets, the last File API
  reply). Configure is never started by opening, a choice or a changed `CMakeLists.txt`, and
  there is no "configure needed" notice. Configure asks for a kit first when none is chosen,
  like CMake Tools.
- **Modes**: with `CMakePresets.json` or `CMakeUserPresets.json` the project uses presets
  (configure and build presets), otherwise kits and variants. The modes never mix, so a kit
  can never contradict a preset.
- **Kits** are scanned when first needed and on "Scan for kits" (Settings → IDE or the kit
  list), and cached in `cmake-kits.json`. Visual Studio installs come from `vswhere`; their
  environment from `vcvarsall.bat <arch> && set` (`cmd /u`, so it is UTF-16), cached per
  install and architecture and applied to configure, build, run and clangd. MinGW/GCC/Clang
  kits put their own folder first on `PATH` (runtime DLLs). An MSVC-targeting clang and
  clang-cl use the newest Visual Studio environment.
- **Build folders**: `${sourceDir}/build/${kit}-${variant}` by default (a setting), so
  compilers and variants never share a folder. Presets use their `binaryDir` (CMake Tools'
  `${sourceDir}/out/build/${presetName}` when missing). Tessera writes only its File API
  query into a build folder; "Delete Cache and Reconfigure" is CMake's `--fresh`.
- **Generator**: Ninja when found (on `PATH`, next to the compiler or bundled with Visual
  Studio), otherwise Visual Studio for MSVC, MinGW Makefiles for MinGW and Unix Makefiles on
  Linux; a setting can fix one. Multi-config generators get the variant as `--config`.
- **`CMAKE_EXPORT_COMPILE_COMMANDS=ON`** is always passed, also with presets unless the
  preset sets it itself (the user's decision), so clangd gets a compilation database.
  clangd restarts after a successful configure and when the kit, variant, preset or source
  folder changes. The Visual Studio generator writes no database; Output says so once.
- **Build target and run target are independent.** Run builds its target first (a setting,
  on by default like CMake Tools), then starts the program in the bottom panel's Run view.
  Its arguments (one per line, passed as argv, no shell) and working folder are per target in
  Project Settings.
- **Processes**: configure/build run with piped output (not a PTY), in a Windows job object
  or a Unix process group, so Cancel and closing the window end compilers too. Output is sent
  in batches of whole lines.
- **Problems**: each configure or build replaces that project's build problems. They are
  listed with the language server's, marked "build"; the status bar counts both.
- **Settings**: application-wide CMake settings (program, generator, build folder, parallel
  jobs, build before run, kits) are in Workspace Settings → IDE with clangd's program; a
  project's choices (kit, variant, presets, targets, source folder, run arguments) are saved
  with its IDE project settings in the app config directory, never in the repository.

## Not verified natively

The Rust tests configure and build a real project with this machine's MinGW Clang and MSVC
(Visual Studio 2022, through `vcvarsall`) and cancel a running build. The desktop app's
status bar, Output, Run view and clangd with the compilation database were not exercised in
Tauri; see [VALIDATION](../VALIDATION.md#v07-ide-qualification).
