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

## V0.5 Excalidraw

Specification: local `.plans/Tessera_v0.5_Excalidraw_Plan.md`. Design and adaptations
(reopen on use instead of at startup, Tessera-owned file actions, export through a native
dialog, one dark theme): [decision 006](decisions/006-excalidraw.md).

| Step | Delivered                                                                                                | Qualification                                                        |
| ---- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 2    | Fifth built-in plugin, pinned `@excalidraw/excalidraw` 0.18.1, `Untitled`/`Untitled 2` naming, own roots | Browser tests; 1 unit test                                           |
| 3    | Rust open with validation, one tab per canonical path across windows, File Manager and OS drop routing   | 1 Rust test; browser tests with a fake backend; cross-window not run |
| 4    | Save, Save As (extension, open-target refusal), serialized scene with embedded images                    | 1 Rust test; unit and browser tests                                  |
| 5    | Debounced queued autosave with revisions, conflict/error states, `settle` before close confirmation      | 6 unit tests; browser autosave/conflict tests                        |
| 6    | Session list in `drawings.json`, reopen on first launch, recovery snapshots of unsaved drawings          | 1 Rust test; browser test; crash recovery not run natively           |
| 7    | Dark theme, keyboard isolation, Ctrl+O/S/Shift+S/K routing, PNG/SVG export, image drop, offline fonts    | Browser tests; production offline test                               |

Runs on 2026-10-29, Windows x64 (same toolchain as above):

- `cargo test`: **37 passed** (4 new: valid/damaged/foreign drawing files left unchanged,
  extension appending that never bypasses the replace confirmation, session list kept until
  registered and ignored when damaged, path and export-name validation). `cargo clippy -D
warnings` and `cargo fmt --check` passed.
- `npm test`: **38 passed** (9 new: names, one drawing per file, cancelled Save As, ordered
  autosaves keeping later edits dirty, conflict stops autosave, failed save keeps edits, settle
  before close, clean reload vs. dirty conflict, own write during a disk check).
- `npm run test:e2e`: **31 passed** (9 new Excalidraw scenarios in Edge headless with the real
  Excalidraw and an in-memory fake backend: Untitled without dialog, dark theme, toolbar
  shortcut, local fonts; first save, cancelled Save As, autosave, Save As; Ctrl+O and the menu's
  Open focus the open drawing; separate undo per drawing and no drawing keys from a Text Editor;
  Save/Discard/Cancel; reopening the last session's drawing, clean reload and dirty conflict
  without overwriting; PNG and SVG export through Excalidraw's dialog; a dropped image saved
  as a data URL and reopened; scene and undo across tab switches).
- `npm run test:production`: 1 passed; Excalidraw, Excalifont and Xiaolai (CJK) fonts load
  from `/excalidraw/fonts/` with external requests blocked. The release bundle grows by about
  14 MB of fonts and 3 MB of Excalidraw code (lazy chunks). `vite preview` applies no CSP, so
  the Tauri CSP is not exercised by this test.
- `npm run tauri build -- --bundles nsis`: release executable and x64 NSIS installer
  (16.85 MiB, up from 1.91 MiB with the bundled Excalidraw code and fonts) generated. Neither
  was launched or installed.
- Full browser suite repeated 3 times: 31 passed each run.

Not yet exercised natively on any platform: native open/save/export dialogs, `.excalidraw`
writes and autosave on disk, the disk watcher, `drawings.json` across a restart, crash
recovery of an unsaved drawing, cross-window focusing, OS image drops, WebView2/WebKitGTK
rendering under the app CSP, IME in Excalidraw text, and clipboard. Use the
[V0.5 checklist](VALIDATION.md#v05-excalidraw-qualification).

## V0.6 Mermaid, Notes and workspace key

Specification: local `.plans/Tessera_v0.6_Plan.md`. Designs: [workspace key](decisions/007-workspace-shortcuts.md),
[Mermaid](decisions/008-mermaid.md), [Notes](decisions/009-notes.md).

| Plan step | Delivered                                                                                                    | Qualification                                     |
| --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 2         | Physical workspace key (Right Ctrl default; Left Ctrl, Left Alt), K/arrows only, migrated setting, no F12    | 3 unit tests, 1 Rust test, browser tests          |
| 3         | Mermaid 12.2.0 (pinned, lazy), split view with resizable/stacking divider, debounced race-safe preview       | Browser tests                                     |
| 4         | `.mmd` lifecycle on the shared drawing path: Untitled, Save As, autosave, one tab per file, reopen, recovery | 1 Rust test, 2 unit tests, browser tests          |
| 5         | Strict security, non-overridable directives, SVG/PNG export through the native dialog, offline bundle        | Browser XSS/export tests; production offline test |
| 6         | `notes.json` with schema version, locked atomic writes, idempotent QuickNotes seed, CRUD and ordering        | 3 Rust tests                                      |
| 7         | Notes panel: list, drag and keyboard order, Edit/Preview, confirmed delete, autosave, narrow layout          | Browser tests with a fake backend                 |

Runs on 2026-10-29, Windows x64 (same toolchain as above):

- `cargo test`: **42 passed** (5 new: legacy modifier values migrate to physical keys;
  `.mmd`/`.mermaid` open as text with their own session list and are refused as drawings;
  QuickNotes is seeded once and never recreated; note title validation, ordering and selection
  after delete; damaged or newer `notes.json` left byte-identical). `cargo clippy -D warnings`
  and `cargo fmt --check` passed.
- `npm test`: **43 passed** (5 new: only K and arrows are taken while the physical key is held,
  extra modifiers/AltGr/missed keyup ignored, Left Alt and non-Latin layouts; an untouched new
  diagram saves its starter as kind `mermaid`; diagrams keep names and session lists apart from
  drawings).
- `npm run test:e2e`: **47 passed** (16 new, Edge headless; Mermaid and Notes use in-memory fake
  backends): Right Ctrl+K/arrows versus Left Ctrl+K, Left Ctrl+arrow, Right Ctrl+A and Ctrl+Z in
  the editor, launcher focus return, the settings choice with warnings and a disabled Right Alt;
  Mermaid split, sequence/class/state diagrams, divider drag and keys, syntax error with the
  last diagram dimmed, latest render wins, script/HTML/click/directive injection inert with no
  requests, Untitled → Save As → autosave → Save As, open/menu/File Manager opener focusing one
  tab per file, SVG/PNG export leaving the file untouched, session reopen, close prompt, clean
  reload and dirty conflict; Notes seed and independent pages, autosave and safe preview,
  drag/keyboard order across a reload, title and confirmed delete, fast switching with slow
  saves and close without loss, narrow stacking. The fast-switching test found that typing
  right after a click could reach the previous note; selection is now immediate.
  Runs used a separate Vite server on port 1431 because port 1420 was serving the user's
  `tauri dev` session.
- `npm run test:production`: 1 passed; Mermaid renders a class diagram and Notes loads with
  external requests blocked.
- `npm run build`: passed; Mermaid is split into lazy chunks.
- `npm run tauri build -- --bundles nsis`: release executable and x64 NSIS installer
  (17.90 MiB, up from 16.85 MiB with Mermaid) generated. Neither was launched or installed.

Not exercised natively on any platform: Right Ctrl/AltGr/Left Alt reporting in WebView2 and
WebKitGTK, Mermaid dialogs, autosave, watcher, `diagrams.json`, PNG export and crash recovery,
`notes.json` across restarts and processes, and IME/clipboard in both modules. Use the
[V0.6 checklist](VALIDATION.md#v06-qualification).

## V0.7 IDE

Specification: local `.plans/tessera-v0.7-plan.md`. Design: [decision 010](decisions/010-ide.md).

| Plan phase | Delivered                                                                                                                                                                               | Qualification                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1          | IDE Project, Code Editor, Problems and Changes panels in the normal workspace; explorer with create/rename/move/Trash; split, unsaved                                                   | 1 layout test, 7 unit tests, browser tests                                                         |
| 2          | Quick open, in-file and project search/replace (revision-checked writes), back/forward history, watcher reuse                                                                           | 3 Rust tests, browser tests                                                                        |
| 3          | clangd process manager; LSP completion, hover, signature help, definition/declaration/implementation/references, rename, quick fix, diagnostics, Outline, formatting and format on save | 3 Rust tests (one with the real clangd), browser tests with a fake server and with the real clangd |
| 4          | Read-only Git: branch, file states, last commit ↔ current diff; per-project settings outside the repository                                                                             | 2 Rust tests (one with a real repository), browser tests                                           |

Runs on 2026-10-29, Windows x64 (same toolchain as above; clangd from MinGW-w64 and Git for
Windows on `PATH`):

- `cargo test`: **50 passed** (8 new: listing honours `.gitignore`, excludes and skips `.git`;
  search reports UTF-16 columns and skips binary files; replace keeps BOM/CRLF, expands groups
  only for regular expressions and refuses changed or outside files; porcelain v2 parsing;
  status and committed text of a real temporary repository; LSP framing and size limits;
  unknown servers, bad IDs and foreign windows refused; the real clangd answers `initialize`
  and exits when its window's servers close). `cargo clippy -D warnings` and `cargo fmt --check`
  passed.
- `npm test`: **51 passed** (8 new: Windows canonical/plain path keys and file URIs, explorer
  rows and Git folder marks, quick open ranking, back/forward, LSP edits in UTF-16 with overlap
  and file-operation refusal; opening with a share and below the whole layout).
- `npm run test:e2e`: **55 passed** (8 new, Edge headless). Seven use an in-memory project, Git
  and a fake language server: sidebar beside the editor, Git marks and branch, multiple
  cursors, bracket matching, folding, unsaved markers and close prompt; open to the side and
  quick open; project search and replace with one closed file written and open files left
  unsaved; completion, diagnostics in the editor and Problems, quick fix, outline, definition,
  back/forward and references; rename asking before closed files are written, formatting and
  format on save; the diff view and editing without a server; create, rename (tab follows) and
  confirmed Trash, and a pointer drag that moves an open file into a folder. One runs the **real clangd** through Playwright instead of Tauri IPC:
  readiness, outline, an undeclared identifier diagnostic, go to definition into the header,
  Back, and a rename applied to both open files.
- `npm run test:production`: 1 passed; the IDE and Code Editor load with external requests
  blocked.
- `npm run build`: passed. The main chunk grows by about 14 kB; the code editor, language
  modes, LSP client and merge view are lazy chunks.
- `npm run tauri build -- --bundles nsis`: release executable and x64 NSIS installer
  (18.76 MiB, up from 17.90 MiB) generated before the explorer drag switched to pointer events (a renderer-only change). Neither was launched or installed.

Not exercised natively on any platform: clangd and Git started by the Tauri app, their exit
with the window, the folder and program dialogs, watcher-driven refresh, Windows `\\?\` paths
through clangd, and IME/clipboard in the code editor. Use the
[V0.7 checklist](VALIDATION.md#v07-ide-qualification).

Review changes on 2026-10-29: the project sidebar switches views with an icon bar on its left
edge; the New File, New Folder, Refresh and Go to file buttons are gone (the tree's right-click
menu and the project ⋯ menu keep the actions); a command palette field sits in the middle of the
title bar ([decision 007](decisions/007-workspace-shortcuts.md#command-palette)). `npm test`
51 passed, `npm run build` passed, `npm run test:e2e` **56 passed** (1 new: the palette filters,
cancels and runs a command on the focused editor). The title bar field and drag region were not
checked in the Tauri window.

Second review round (2026-10-29): the launcher lists only **IDE**; it opens the project sidebar
with a bottom panel (Problems / Terminal views over a status bar with branch and error/warning
counts). The bottom panel sits under the code editors, not the sidebar; the project status line
is gone (server state stays in the code editor bar). The IDE terminal starts in the project
folder (`create_terminal` takes an optional, validated directory). `cargo test` **51 passed**
(1 new: only existing absolute folders), Clippy and `cargo fmt --check` passed; `npm test` 51
passed (the layout test now covers opening above a panel); `npm run test:e2e` **57 passed** (1
new: one IDE launcher entry, Problems/Terminal views; layout checks the panel under the code);
`npm run test:production` passed. The project terminal was not started natively.

Third review round (2026-10-29):

- **IDE layout**: the sidebar, bottom panel and a separate status bar are docked tools ([decision
  010](decisions/010-ide.md#panels-not-a-second-workspace)): their own bars instead of tab
  strips, no close or maximize, minimize to their bar. The IDE opens with an empty Code Editor
  and, in the first IDE of a window, the folder opened last. Source Control lists Git changes
  (read-only), ignored files are dimmed and the branch left the sidebar header.
- **Code editor keys**: Ctrl+click definition, Ctrl+L, Ctrl+Alt+Up/Down, Alt+O
  header/source; Alt+click adds a cursor.
- **Workspace**: every tab has a close button; save locks moved from the file's folder to the
  app data; the WebView's context menu is suppressed; the status line shows date and time.
  Every shortcut is rebindable in Settings and a window opacity setting fades the whole window
  ([decision 007](decisions/007-workspace-shortcuts.md#rebindable-shortcuts)).
- **Checks**: `cargo test` **52 passed** (new: preferences validation; Git ignored entries
  and no lock file beside a saved file are covered in existing tests), Clippy and `cargo fmt
--check` passed; `npm test` **56 passed** (new: docked tools collapse and never share,
  ignored paths, keybindings); `npm run test:e2e` **62 passed** (new: tab close button and
  context menu, rebinding, opacity and clock, recent folder with Source Control, code
  shortcuts); `npm run build` and `npm run test:production` passed.
- **Not run in Tauri**: transparent windows, minimize, the recent folder, the shortcuts in the
  WebView and the lock directory.

CMake (2026-10-29, [decision 011](decisions/011-cmake.md)):

- **Implemented**: kits (MSVC x64/x86/arm64, MinGW GCC, Clang, clang-cl, GCC) or presets,
  variants, manual configure / Delete Cache and Reconfigure, File API targets, build, build
  all, clean, clean rebuild, cancel, run in the bottom panel, Output channel, build problems,
  clangd with the compilation database; status bar and palette; Workspace Settings in tabs
  (General, Shortcuts, Terminal, IDE).
- **Checks**: `cargo test` **62 passed, 1 ignored** (new: kit drivers/versions/`set` output,
  presets with includes/inheritance/conditions, macro refusal, File API reply, command lines,
  build folders, source folder bounds, a real configure + build + cancel with this machine's
  MinGW Clang, a real MSVC configure + build through `vcvarsall`); Clippy and `cargo fmt
--check` passed. `npm test` **58 passed** (new: compiler/CMake problem lines, bounded
  output). `npm run test:e2e` **63 passed** (new: CMake kit, configure, problems, targets, run,
  palette and settings with a scripted backend). `npm run build`, `npm run test:production`
  and `format:check` passed. The kit scan here found Visual Studio 2019 Build Tools, 2022 and
  2026 (x64, x86), MinGW GCC 15.2, Clang 21.1 and clang-cl.
- **Not run in Tauri**: the CMake status bar, Output and Run view, clangd with the
  compilation database, Linux kits.

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

- Windows 10/11 WebView2: input/IME, clipboard, native picker/drop, Right Ctrl/AltGr reporting,
  crash recovery, independent windows and installer smoke.
- Hyprland and GNOME Wayland: the same checks, compositor modifier conflicts,
  GTK file dialogs and WebKitGTK rendering. No Linux session is available in this workspace.
- Measure startup, idle memory/CPU, resizing and large files on each target; no arbitrary
  performance acceptance threshold.
