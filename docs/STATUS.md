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

## V0.3 File Manager

Specification: local `.plans/Tessera_v0.3_File_Manager_Plan.md`. Design and deliberate
deviations (no restart restoration, Alt+arrow precedence, program files not launched):
[decision 004](decisions/004-file-manager.md).

| Phase | Delivered                                                                                                        | Qualification                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 0     | Integration map; third built-in plugin on the existing contract, store and watcher                               | No duplicate panel host or persistence store                       |
| 1     | Home start, Back/Forward/Up, breadcrumb, Ctrl+L path entry, Details view, virtualized rows, loading/error states | Browser tests with a fake backend; 3 Rust listing/path tests       |
| 2     | Hidden toggle (persisted), folders-first column sort, current-folder filter, link/broken markers, multi-select   | 6 model tests; browser test with 5,000 entries (<80 rows mounted)  |
| 3     | Create, rename, copy/cut/paste, move, Trash, confirmed permanent delete, context menu, default-app open          | 7 Rust operation tests in temp dirs; browser conflict/delete tests |
| 4     | Shared pin registry (persisted order, missing state, cross-window event) and toolbar Pin menu                    | 2 Rust pin tests; browser test across two panels                   |
| 5     | Internal drag-to-folder moves, displayed-folder watcher with coalesced refresh and cleanup                       | Browser drag test; native watcher not exercised                    |
| 6     | Hardening: request tokens, ancestor fallback, protected paths, no-replace placement                              | Platform QA pending (see checklist items 19–30)                    |

Runs on 2026-10-29, Windows x64 (same toolchain as above):

- `cargo test`: **25 passed** (14 new: listing, hidden attribute, path normalization, names,
  protected paths, no-replace rename, conflicts, Keep Both series, Replace via a Trash double,
  same-volume folder move, interrupted staging cleanup, pins persistence/damage).
- Unix-only code (`renameat2`, dot-file hidden rule, symlink and non-UTF-8 tests) was
  type-checked with `cargo check --target x86_64-unknown-linux-gnu` on an extracted copy of
  the modules. It has **not run** on Linux.
- `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`: passed.
- `npm test`: **24 passed**. `npm run test:e2e`: **17 passed** (8 new File Manager scenarios,
  Edge headless, in-memory fake backend — no native filesystem I/O).
- `npm run test:production`: 1 passed; the File Manager chunk (~21 kB) loads offline.
- `npm run tauri build -- --bundles nsis`: release executable and x64 NSIS installer
  (1.85 MiB) generated with the File Manager and the `trash`/`open` crates. Neither was launched
  or installed.

Not yet exercised natively on any platform: real listings and watchers, Trash/Recycle Bin,
default-app opening, conflict flows on disk, cross-volume moves, links/junctions, pins across
restarts and windows. Use the [V0.3 checklist](VALIDATION.md#v03-file-manager-qualification).

## V0.4 Tasks

Specification: local `.plans/Tessera_v0.4_Tasks_Plan.md`. Design and adaptations (no layout
rehydration, per-process singleton, no optimistic UI): [decision 005](decisions/005-tasks.md).

| Phase | Delivered                                                                                                  | Qualification                                                      |
| ----- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1     | Integration map; fourth built-in plugin; optional `claim`/`save` contract members; shared popup menu       | Existing suites still pass                                         |
| 2     | Rust `tasks.rs`: versioned JSON, Inbox, validation, repair, locked atomic saves, damaged/newer refusal     | 8 Rust tests in temp dirs                                          |
| 3     | Single panel (window owner + `focus-plugin`), list picker, All Lists, list create/rename/delete, selection | Browser tests with a fake backend; cross-window focus not run      |
| 4     | Todo/In Progress/Done sections, default collapse, rows with priority and list label, quick add, empty      | Browser tests                                                      |
| 5     | In-panel details, autosaved title/description drafts, selects, safe Markdown preview, confirmed deletes    | 2 Markdown tests (HTML/script/link inertness); browser tests       |
| 6     | Handle drag within/across sections by neighbour anchors, collapsed-section drop, Ctrl+Up/Down              | 3 model tests, 1 Rust order test, browser drag test                |
| 7     | Failed-save state with Retry, close confirmation for drafts, IME guards, offline bundle                    | Browser failure/close test; native file faults and restart pending |

Runs on 2026-10-29, Windows x64 (same toolchain as above):

- `cargo test`: **33 passed** (8 new: Inbox and name rules, append order and Medium default,
  moves without list change and stale anchors, list deletion into the Inbox, round trip with
  an orphaned temp file, damaged/unknown/newer files left byte-identical, load repair, a
  read-only file reported without changes). `cargo clippy -D warnings` and `cargo fmt --check`
  passed. The module has no platform-specific code; it has **not run** on Linux.
- `npm test`: **29 passed** (5 new). `npm run test:e2e`: **22 passed** (5 new Tasks scenarios,
  Edge headless, in-memory fake backend — no native JSON I/O), stable over 6 consecutive full
  runs after a File Manager test was made to wait for focus restoration.
- `npm run test:production`: 1 passed; the Tasks chunk (~17 kB) and the shared Markdown parser
  chunk load offline.
- `npm run tauri build -- --bundles nsis`: release executable and x64 NSIS installer
  (1.91 MiB) generated. Neither was launched or installed.

Not yet exercised natively on any platform: `tasks.json` creation and restart persistence,
cross-window focusing of the single panel, file permission and corruption handling, two
processes writing at once, and IME input. Use the [V0.4 checklist](VALIDATION.md#v04-tasks-qualification).

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
