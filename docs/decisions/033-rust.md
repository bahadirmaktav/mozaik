# 033 — Rust in the IDE

Status: accepted (2026-11-19). The user asked for the IDE to support Rust as well, after the
official rust-analyzer extension of VS Code, and to turn the C/C++ or the Rust parts off per
project type in Settings → IDE → Features.

## Context

The IDE was built around C and C++: clangd, CMake, GDB/LLDB, CTest, clang-tidy. Rust brings
its own language server (rust-analyzer) and build tool (Cargo). Both run code of the project
on their own unless told otherwise: rust-analyzer builds and runs build scripts (`build.rs`)
and procedural macros to understand the code, and its settings can name commands for it to
run (`check.overrideCommand`, `cargo.buildScripts.overrideCommand`, `runnables.command`).

## Decisions

### Language server (rust-analyzer)

- `lsp.rs` knows a second server, `rust-analyzer`, for `.rs` files (LSP language `rust`).
  Its program is chosen in a native dialog, or found on `PATH` or in Cargo's `bin`. rustup's
  proxy there is resolved with the fixed query `rustup which rust-analyzer`, run in the
  project folder so its `rust-toolchain.toml` counts; a proxy whose component is missing is
  reported ("run `rustup component add rust-analyzer`") instead of started. Last, the server
  that VS Code's rust-analyzer extension ships is used. Nothing is downloaded or installed.
- **Settings belong to Rust.** The renderer never sends rust-analyzer settings: Rust replaces
  the `initializationOptions` of the renderer's `initialize`, refuses
  `workspace/didChangeConfiguration`, and answers rust-analyzer's `workspace/configuration`
  requests itself (they never reach the renderer). The configuration is built from Settings →
  IDE → Rust and holds no command override.
- **No implicit network.** rust-analyzer runs with `CARGO_NET_OFFLINE=true`, so its own
  `cargo metadata` and check never download crates. A project whose dependencies are not
  downloaded yet loads without them until the user builds it.
- **Build scripts and procedural macros** are on by default, as VS Code does for a trusted
  workspace; one switch (Settings → IDE → Rust → Build scripts and procedural macros) turns
  both off, with a description saying it runs project and dependency code.
- **Check on save** (default on, `cargo check` or Clippy) is rust-analyzer's own: after the
  user saves a Rust file. Its results appear in Problems with rustc's or Clippy's source.
- **Diagnostics.** rust-analyzer gives its own diagnostics only when asked
  (`textDocument/diagnostic`), since the client offers pulled diagnostics; it sends those of
  its check. The client asks after a file is opened or changed (debounced) and when the server
  sends `workspace/diagnostic/refresh`, and shows both lists together. clangd keeps sending
  its own.
- **Inlay hints** (types, parameter names, chained types; off in Settings) are drawn for Rust
  files only, as widgets that are not part of the text. Hints and semantic tokens are asked
  again on `workspace/inlayHint/refresh`, `workspace/semanticTokens/refresh` and when
  rust-analyzer reports it is done loading (`experimental/serverStatus`). Its health message
  (a workspace that failed to load, an unsupported toolchain) shows on the editor's status
  with a ⚠ and as its tooltip.
- **Commands** of the official extension that fit Mozaik: Expand Macro Recursively (a Rust
  tab of its own, not a change to save), Locate Parent Module, Open Cargo.toml, Join Lines,
  Reload Workspace and Rebuild Build Dependencies, in the code editor's menu and palette for
  Rust files. Switch Header/Source (Alt+O) stays C/C++'s. Semantic tokens color Rust names
  as C++'s are; clangd's old "comment token means code left out" rule applies to clangd only.
- **Features.** Settings → IDE → Features lists _C/C++ Language Server (clangd)_ and _Rust
  Language Server (rust-analyzer)_ separately (the preference ids stay: `languageServer` is
  clangd's). Off, that server stops and starts for no project. Features apply to every
  window; a C++ user turns rust-analyzer off and a Rust user clangd.
- Problems lists rust-analyzer as a provider of its own (its sources `rust-analyzer`, `rustc`
  and `clippy`).

### Cargo

- `cargo.rs` finds cargo (chosen in a native dialog, on `PATH`, or in Cargo's `bin`, where
  rustup's proxy follows the project's toolchain). A project with a `Cargo.toml` in its folder
  is a Cargo project: the status bar shows its profile (dev or release), Build (or the running
  step with ✕), the build target, Run, Debug and the run target, as CMake's do. Every action
  is also a `Cargo:` palette command: Select Profile / Build Target / Run Target, Build, Check,
  Clippy, Clean, Run, Cancel.
- **Targets** come from the fixed query `cargo metadata --format-version 1 --no-deps
--offline` (workspace members only), read when a pick list, Run or Debug needs them, never
  on opening the project. A target is named `cargo:<kind>:<package>:<name>` (lib, bin,
  example, test, bench); CMake target names cannot hold `:`, so Run, Debug and
  `.mozaik/debug.json` take either kind of name. Rust checks the name against the metadata and
  builds `-p <package> --bin|--example|--test|--bench <name>` (or `--lib`) itself.
- **Steps** run on `cmake::jobs` (cancellable process tree, hidden console), one Cargo task
  per project and window, with `--manifest-path`, `--release` for the release profile,
  `-j` from the settings, `--offline` when chosen and `--color never`. Output goes to Output →
  Cargo; rustc's errors and warnings (`error[E0425]: …` then ` --> file:line:col`) become
  Problems with the source `build`, Clippy's lint name as their code. Clean clears them.
- **Run** builds the run target first (a setting) and starts the program Cargo wrote
  (`<target dir>/<debug|release>/[examples/]<name>`) in the bottom panel's Run view, with
  the target's arguments and working folder from Project Settings (empty: the project
  folder), `CARGO_MANIFEST_DIR`, `CARGO_PKG_NAME`, `CARGO_PKG_VERSION` and the profile's
  `deps` folder on the library path, as `cargo run` sets them. The program must lie in the
  target directory.
- **Network.** Mozaik's own Cargo query runs offline. Build, Check, Clippy and Run are the
  user's; Cargo may download missing dependencies then, unless Settings → IDE → Rust →
  Offline builds adds `--offline`.
- A folder with both a `CMakeLists.txt` and a `Cargo.toml` is a CMake project for Run and
  Debug; its Cargo commands still work from the status bar and palette.
- Features: _Cargo_ turns the status bar items and commands off. Run and Debug needs CMake
  or Cargo.

### Debugging Cargo programs

- Debug builds the Cargo run target and starts the debugger chosen for the project's Rust
  toolchain, read with the fixed query `rustc -vV` (rustup's proxy beside cargo, in the
  project folder): an `*-msvc` host is treated as clang-cl programs already are (PDB debug
  information: LLDB only, never GDB), Apple hosts prefer LLDB, others GDB. Debugging MSVC
  programs with Microsoft's debugger stays out of scope; LLDB reading PDB is not that.
- Rust's pretty-printers come from the toolchain's `lib/rustlib/etc` (`rustc --print
sysroot`), as rust-lldb and rust-gdb use them: LLDB's launch request gets
  `command script import "<etc>/lldb_lookup.py"` and `command source -s 0
"<etc>/lldb_commands"` as `initCommands` (built in Rust, never from the renderer); GDB is
  started with `--directory=<etc>` and `add-auto-load-safe-path <etc>`. An LLDB without
  Python reports the import and debugs without them: values show as Rust's raw structures.

## Not done

- Code lenses (Run | Debug above `main` and tests), hover actions, the syntax tree and HIR
  views, structural search and replace, rustup toolchain management, crates.io version hints
  (network) and a rust-analyzer download.
- Cargo tests in the Testing view, `cargo new`/`cargo init`, features and target triples
  other than the host's.
