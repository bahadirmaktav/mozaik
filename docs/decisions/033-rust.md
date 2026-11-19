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

## Not done

- Code lenses (Run | Debug above `main` and tests), hover actions, the syntax tree and HIR
  views, structural search and replace, rustup toolchain management, crates.io version hints
  (network) and a rust-analyzer download.
