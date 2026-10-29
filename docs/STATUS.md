# V0.1 implementation and validation

Specification: local `.plans/TESSERA_V0.1_PLAN.md` (intentionally gitignored).

Work proceeds in the specification's order: foundation, layout model, interactions,
editor, data safety, packaging/validation. Platform results must be recorded from actual
runs; the existence of a config or test does not prove platform support.

## Implemented

| Stage | Delivered                                                                                                                                 | Qualification                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 0     | Official Tauri 2 scaffold, dark shell, independent windows, constrained CSP/navigation                                                    | Windows build and process/window launch observed; native UI inspection blocked by tool access |
| 1     | Pure serializable binary split tree; open, close, resize, swap, move, reorder, spatial focus, maximize                                    | 13 domain tests                                                                               |
| 2     | Splitters, tabs, pointer capture, previews, configurable held modifier, launcher                                                          | Browser interaction coverage                                                                  |
| 3     | Built-in contract, lazy CodeMirror adapter, documents separate from views, undo/redo, indentation, syntax, line navigation                | Browser coverage including hidden state and focus                                             |
| 4     | Native picker/read/save, atomic replacement, revision conflicts, notify directory watchers, recovery, UTF-8/BOM/endings, lightweight mode | 5 Rust and 5 frontend boundary tests; native end-to-end scenarios still pending               |
| 5     | Dark tokens, custom title bar, focus/dialog handling, error boundary, local icons, Windows NSIS, CI for Windows/Ubuntu                    | Cross-platform qualification remains open                                                     |

## Runs on 2026-10-29

Environment: Windows x64; Node 24.14.1; npm 11.11.0; Rust 1.92.0; MSVC toolchain
resolved by Cargo. Linux/Wayland was not available.

- `npm test`: **18 passed** (13 layout, 5 file/document boundary).
- `npm run test:e2e`: **7 passed**, Microsoft Edge headless (not native WebView2).
- `npm run test:production`: **1 passed**, release frontend with external requests blocked;
  workspace and dynamically loaded editor assets stayed local.
- `npm run build`: TypeScript and Vite successful. Editor is a separate lazy chunk (~602 kB
  minified, ~212 kB gzip); Vite's 500 kB advisory remains visible, not suppressed.
- `cargo test --manifest-path src-tauri/Cargo.toml --offline`: **5 passed**.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --offline -- -D warnings`: passed.
- `npm run tauri dev`: compiled and launched a native `Tessera` window.
- `npm run tauri build -- --bundles nsis`: release executable and x64 NSIS installer generated.
  Installer execution/installation is not verified.
- UI screenshot from browser tests inspected: opaque editors, compact shared tab bars,
  subtle focus, no overlapping content at 1200×800.
- Parser experiment and measured fallback rationale: [decision 002](decisions/002-editor-and-data.md).

Native UI access returned `Computer Use was not approved to use tessera`. No native
interaction result is inferred from the successful browser tests. The generated CI workflow
has not been run remotely; its Ubuntu job does not prove Wayland compatibility.

Artifacts (ignored by Git):

```text
src-tauri/target/release/tessera.exe
src-tauri/target/release/bundle/nsis/Tessera_0.1.0_x64-setup.exe
```

## V0.2 terminal module

Specification: local `.plans/Tessera_V0.2_Plan.md`. Design: [decision 003](decisions/003-terminal.md).

| Stage | Delivered                                                                                                    | Qualification                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| A     | Plugin contract generalized (title, modified, subscribe); launcher lists Terminal                            | Existing browser suite still passes                              |
| B     | Rust `TerminalSessions`: portable-pty, ordered UTF-8 channel, backpressure, close/exit cleanup, shell list   | 6 Rust tests, 2 of them spawn real CMD sessions on Windows       |
| C     | xterm.js 6.0.0 + FitAddon 0.11.0 view, emulator kept across remounts, copy/paste, scrollback, token theme    | Browser test of failure state, tab move and close; no native run |
| D     | Independent sessions, Default Shell setting, missing-shell error with one-off fallback, home directory start | Build and browser tests only                                     |
| E     | Release build                                                                                                | See runs below; native interactive qualification is pending      |

Runs on 2026-10-29, Windows x64 (same toolchain as the V0.1 runs above):

- `cargo test`: **11 passed**, including a real ConPTY + `cmd.exe` session that runs a
  command, reports exit and closes idempotently, and window/app-wide cleanup of three sessions.
- Linux-specific terminal code (`getpwuid_r`, SIGKILL path) was type-checked and linted with
  `cargo check`/`cargo clippy --target x86_64-unknown-linux-gnu` on an extracted copy of the
  module. It has **not run** on Linux.
- `npm test`: 18 passed. `npm run test:e2e`: **9 passed** (Edge headless; no native PTY).
- `npm run test:production`: 1 passed; editor and terminal chunks load without external requests.
- `npm run build`: terminal view is a separate lazy chunk (~336 kB, ~85 kB gzip).
- `npm run tauri build -- --bundles nsis`: release executable and x64 NSIS installer
  (1.75 MiB) generated with the terminal module. Neither was launched or installed.

Not yet exercised in the native app on any platform: typing into a live shell, TUI programs,
resize propagation, clipboard, ConPTY cursor handshake through xterm.js, Settings shell
switching, process cleanup on tab/window/app close, and high-volume output. Use the
[V0.2 checklist](VALIDATION.md#v02-terminal-qualification).

## Acceptance coverage

| Criteria         | Current evidence                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| AC-01, 03–18, 24 | Pure model and/or browser tests; native modifier behavior remains to be checked                    |
| AC-02            | Independent renderer construction implemented; two native windows not manually exercised           |
| AC-19            | Snapshot persistence and live-session lock implemented; actual kill/relaunch recovery flow pending |
| AC-20–22         | Revision, encoding and clean/dirty boundary tests; actual native watcher/dialog flow pending       |
| AC-23            | Binary/encoding rejection and large-document fallback tested                                       |
| AC-25            | Bundled frontend external-request audit passed; native disconnected-machine run pending            |
| AC-26            | View teardown, state disposal and watcher refcounts implemented; native resource profiling pending |
| AC-27            | Windows native and both Linux/Wayland smoke matrices pending                                       |

See [manual validation checklist](VALIDATION.md) for the remaining reproducible steps.

## Platform checks still required

- Windows 10/11 WebView2: input/IME, clipboard, native picker/drop, Alt focus loss,
  crash recovery, independent windows and installer smoke.
- Hyprland and GNOME Wayland: the same checks, compositor modifier conflicts,
  GTK file dialogs and WebKitGTK rendering. No Linux session is available in this workspace.
- Measure startup, idle memory/CPU, resizing and large files on each target; no arbitrary
  performance acceptance threshold.
