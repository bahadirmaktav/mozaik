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
- `npm run tauri dev`: compiled and launched a native `Mozaik` window.
- `npm run tauri build -- --bundles nsis`: release executable and x64 NSIS installer generated.
  Installer execution/installation is not verified.
- UI screenshot from browser tests inspected: opaque editors, compact shared tab bars,
  subtle focus, no overlapping content at 1200×800.
- Parser experiment and measured fallback rationale: [decision 002](decisions/002-editor-and-data.md).

Native UI access returned `Computer Use was not approved to use mozaik`. No native
interaction result is inferred from the successful browser tests. The generated CI workflow
has not been run remotely; its Ubuntu job does not prove Wayland compatibility.

Artifacts (ignored by Git):

```text
src-tauri/target/release/mozaik.exe
src-tauri/target/release/bundle/nsis/Mozaik_0.1.0_x64-setup.exe
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
(reopen on use instead of at startup, Mozaik-owned file actions, export through a native
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

Fourth V0.7 review (2026-10-30, [decision 010](decisions/010-ide.md#palette-output-and-terminals-fourth-v07-review)):

- **Implemented**: no title bar palette field; the palette by Ctrl+Shift+P (`>`), Ctrl+P (files)
  and Ctrl+Shift+O (`@` symbols). Workspace Settings: search, module tabs (General, Text
  Editor, IDE, Terminal, File Manager, Tasks and Notes) with their shortcuts, folding sections,
  Save / Cancel / Reset to Default. Source Control: Staged Changes and Changes, stage, unstage,
  discard (confirmed; untracked to the Trash), change count on the activity bar, comparisons
  as tabs with syntax colours and visible change colours; folders coloured after their
  changes; Explorer file section folds and the folded Outline stays at the bottom. Output
  channels IDE and CMake, IDE messages there and in the status bar. Several terminals per
  bottom panel with a shell choice. Code Editor: tab close button on the tab's background,
  gutter as markers | numbers | fold chevrons on hover, Ctrl+hover definition links.
- **Checks**: `cargo test` **63 passed, 1 ignored** (new: stage/unstage/discard on a real
  repository, before and after the first commit, with literal pathspecs and a refused path
  outside it); Clippy and `cargo fmt --check` passed. `npm test` **58 passed** (folder
  decorations updated). `npm run test:e2e` **64 passed** (new: gutter, fold and Ctrl+hover;
  changed: palette by keys, settings tabs/search/save/reset, Source Control groups and
  actions, terminals). `npm run build` and `format:check` passed.
- **Not run in Tauri**: Git stage/unstage/discard from the app, the shell picker and several
  terminals, the settings dialog, the palette keys in WebView2 (Ctrl+P is the WebView's print
  otherwise), the Ctrl+hover link.

Fifth V0.7 review (2026-10-30, [decision 007](decisions/007-workspace-shortcuts.md#behavior),
[decision 010](decisions/010-ide.md#git)):

- **Implemented**: no title bar or window buttons, a 10 px drag strip (double-click
  maximizes), the Mozaik mark in the status line; workspace key+E closes the window and
  key+C the focused panel (an IDE part asks, then closes the whole IDE; the last IDE takes its
  code editors). The IDE's code area stays: an empty editor replaces the last closed tab and
  has no close button. Working tree comparisons edit the file's document (its code tab opens
  behind) and revert single changes with arrows.
- **Checks**: `npm test` **58 passed** (workspace key C/E). `npm run test:e2e` **66 passed**
  (new: editable comparison and revert, kept code editor and key+C; changed: Close IDE takes
  the code editor, key+C on a text panel, no window buttons). `npm run build`,
  `npm run test:production` and `format:check` passed.
- **Not run in Tauri**: dragging, double-click maximize and edge resizing without decorations
  on Windows and both Wayland sessions (GNOME has no minimize without buttons), Right Ctrl+C/E
  in WebView2, the editable comparison against real Git.

## V0.8 debugging

Plan: `.plans/tessera-v0.8-plan.md`; decisions in [012](decisions/012-debugging.md).

- **Implemented**: Run and Debug sidebar view (launch target, Start, Select Debugger, the
  `.mozaik/debug.json` editor; Variables, Watch, Call Stack with threads, Breakpoints), a
  floating toolbar (Continue/Pause, Step Over/Into/Out, Restart, Stop), breakpoint gutter
  (line, conditional, hit count, logpoint; verification and refusals shown), paused line,
  Debug Hover, Set Value, paged children, Debug Console (messages, logpoints, expressions),
  program output in `Debug: <target>`, `Debug: …` palette commands and a status bar button.
  Debug builds the run target first, never configures; one session in the application; MSVC
  refused before building; GDB's DAP or lldb-dap found next to the compiler, on PATH or chosen
  in a dialog; breakpoints, watches and the debugger choice in app data per project.
- **Checks (2026-10-30, Windows 11)**: `cargo test` **70 passed** (new: the request allowlist,
  `debug.json` parsing and variables, Run/debug.json merging, compiler detection, one
  session, and **a real GDB 16.3 DAP session** on a program built with this machine's MinGW
  g++: hit count, conditional and line breakpoints, a logpoint, a pretty-printed
  `std::vector`, evaluation, program output, exit code). `cargo clippy` clean. `npm test`
  **65 passed** (new: breakpoint toggling/moving/kinds, hit count translation, refused
  abilities, hover expressions, console bound). `npm run test:e2e` **68 passed** (new: the
  whole flow against a scripted adapter — gutter breakpoints, hit count dialog, persistence,
  build before debug, setBreakpoints contents, Call Stack, paused line, Variables with paging,
  Hover, Watch, Set Value, Debug Console, Step Over, Continue to exit, program output, cleanup;
  and the missing-debugger refusal without a build plus the configuration dialog writing
  `debug.json`). `npm run build`, `npm run test:production`, `format:check` passed.
- **Not run**: the desktop app against a real adapter (WebView2 or WebKitGTK), lldb-dap
  (not installed here; its hit count semantics are taken from its source), Linux GDB/LLDB,
  Pause of a running program, crash/signal stops, killing the adapter. See
  [VALIDATION](VALIDATION.md#v08-debugging-qualification) items 69–73.
- **Limits**: the program has no keyboard input (GDB's DAP gives it `/dev/null`, and Mozaik
  does not run `runInTerminal` commands); GDB's own messages share the program's output
  stream; exception breakpoint filters and function breakpoints are not offered.

Sixth V0.7 review (2026-10-30, [decision 010](decisions/010-ide.md),
[decision 007](decisions/007-workspace-shortcuts.md#behavior),
[decision 012](decisions/012-debugging.md#decisions)):

- **Implemented**: resizable, folding sidebar sections (Explorer files/Outline, Run and Debug)
  whose folds and heights survive switching views (Source Control and TODOs groups too); a
  TODOs view after Todo Tree with tags from Workspace Settings → IDE, grouping by file or tag
  and tag colors in the editor; Alt+Left/Right instead of the editor bar's back/forward
  buttons; a fading highlight where definitions, references, results and symbols land;
  Ctrl+D; Ctrl+`and View: Toggle Terminal; a bug icon for Run and Debug, icons in the IDE
status bar and a Git branch icon; the code file's line ending and encoding in the IDE status
bar; a keyboard button with the workspace keys instead of the status line hint; breakpoints
right beside the line numbers; the debugged program's output in the Debug Console instead
of a`Debug: <target>` tab.
- **Checks**: `cargo test` **70 passed** (TODO tags in preferences), `cargo clippy` clean.
  `npm test` **70 passed** (new: TODO patterns, parsing, colors). `npm run test:e2e`
  **69 passed** (new: sections fold/resize and keep that, TODOs by file and tag, editor tag
  colors, Ctrl+D, Ctrl+`; changed: Alt+Left/Right and the jump highlight, gutter order,
status bar texts, program output in the console, the keyboard menu). `npm run build`
  passed.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 74.

Seventh V0.7 review (2026-10-30, [decision 007](decisions/007-workspace-shortcuts.md#behavior)):

- **Implemented**: the command palette serves the whole workspace: Add to Workspace: <tool>
  for every launcher entry and the commands of the modules in the workspace (File Manager,
  Tasks, Notes, Mermaid, IDE, Code Editor), registered by their views. The launcher is
  Ctrl+Shift+I, Workspace Settings Ctrl+Shift+, (both also palette commands), Close Panel
  Ctrl+Shift+C and Close Window Ctrl+Shift+E; the workspace key keeps only focus (Right
  Ctrl+arrows); whole-panel drag holds Ctrl+Shift. Shifted punctuation keys are named by
  their unshifted key on the layout. Fixed: the breakpoint gutter collapsed (and the line
  numbers slid over it) when the cursor line scrolled out of view; code in language server
  hovers lost its highlighting (the sanitizer dropped CodeMirror's class names).
- **Checks**: `npm test` **71 passed** (new: Ctrl+Shift keys, the comma key under Shift, old
  `Mod+…` changes dropped). `npm run test:e2e` **70 passed** (new: Tasks palette commands,
  Add to Workspace and settings from the palette, hover highlighting, gutter width; changed:
  every launcher, settings and close key, Ctrl+Shift panel drag, Left Alt focus). `npm run
build` and `format:check` passed.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 75.

Eighth V0.7 review (2026-10-30, [decisions 002](decisions/002-editor-and-data.md#floating-panels)
and [013](decisions/013-testing.md)):

- **Implemented**: floating panels (Ctrl+Shift+Enter in the launcher and on the palette's
  Add commands, moved by the header, resized at the edges, tabs dropped on them, Dock/Float
  Panel); the IDE **Testing** view over CTest (by program and GoogleTest suite, run a test,
  suite, program or all after building, failed test output, debug one test, go to its
  `TEST` line, `Test: …` commands, Output → Tests); Text Editor word wrap under the
  indentation (a setting, on by default) and its own status bar (Ln/Col, ending, encoding,
  Modified), a drawing's autosave state in its own bar; window opacity in 1 % steps; the
  status line's keyboard button is gone. debug-playground got GoogleTest examples (with and
  without a fixture, a parameterized table and a disabled test).
- **Checks**: `npm test` **78 passed** (new: floating panel model, test grouping and CTest
  output). `npm run test:e2e` **73 passed** (new: floating panels, Testing view, word wrap and
  the editor's status bar). `cargo test` **73 passed** (new: CTest listing and filters, and a
  real CTest project configured, built, listed and run with this machine's MinGW GCC and
  CMake 4.1.2), Clippy and `cargo fmt --check` clean. `npm run build` and `format:check`
  passed.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 76.

Ninth review (2026-10-31, decisions [014](decisions/014-mozaik.md),
[015](decisions/015-coverage.md) and [013](decisions/013-testing.md)):

- **Implemented**: the application is **Mozaik** (names, identifier `dev.mozaik.desktop`,
  `.mozaik/debug.json`, a mosaic "M" logo and icons; the former Tessera config and data
  folders are copied once at start); Left/Right move between a dialog's buttons, and a
  dialog focuses its intended button (Cancel, Skip) instead of the first one; the Testing
  view lists tests when shown and groups them by suite only, a failure is a red cross and a
  skip a grey slashed circle; a moved floating Excalidraw keeps the pen under the pointer;
  Ctrl+K Ctrl+C / Ctrl+K Ctrl+U add and remove line comments (keybindings learn chords,
  recorded as two presses); the IDE **Coverage** view over LCOV and Cobertura reports with
  a read-only, coloured tab per file. debug-playground got a `gcc-coverage` preset and a
  `coverage` target (gcov + gcovr) writing `build/gcc-coverage/coverage/coverage.info`.
- **Checks**: `npm test` **84 passed** (new: chords, CTest skip states, coverage parsers
  and tree). `npm run test:e2e` **75 passed** (new: dialog arrows, floating drawing pointer,
  Coverage view; changed: Testing view, code shortcuts, shortcut settings).
  `npm run test:production` passed after its launcher key was updated. `cargo test` **76
  passed** (new: data adoption, coverage report store), Clippy and `cargo fmt --check`
  clean. `npm run build` and `format:check` passed. debug-playground's `gcc-coverage` build
  and CTest run wrote gcov counters with this machine's MinGW GCC 15.2; gcovr was not
  installed, so the report itself was not generated.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 76.

Tenth review (2026-10-31, decision [016](decisions/016-tabs-and-editors.md)):

- **Implemented**: tabs close with the middle button and have a right-click menu (Close,
  Close Others, Close All, Split Right, Split Down); a Text Editor panel adds tabs from a `+`
  and a double click on its tab strip; the Text Editor shares the Code Editor's editing
  shortcuts and Find / Replace; the Code Editor bar lost its `⋯`; IDE terminals start in the
  plain project folder (no `\\?\` prefix for Command Prompt and PowerShell); the bottom
  panel's terminals split side by side from their list (Split and Kill on hover), the bar's
  Kill button is gone and the shell chooser sits against New Terminal; Tasks shows its
  sections without tasks and without "+ Add Task" rows, and a dragged task is a card that
  follows the pointer while the list opens a slot.
- **Checks**: `npm test` **84 passed**. `npm run test:e2e` **77 passed** (new: tab menu,
  middle click, split and new tabs; Text Editor shortcuts; changed: IDE terminal list and
  split, Tasks empty state and card drag, Code Editor actions through the palette).
  `cargo test` **76 passed**, Clippy and `cargo fmt --check` clean, `npm run build` passed.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 77.

Eleventh review (2026-10-31, decision [017](decisions/017-code-analysis.md); changes in
[003](decisions/003-terminal.md), [004](decisions/004-file-manager.md),
[007](decisions/007-workspace-shortcuts.md) and [010](decisions/010-ide.md)):

- **Implemented**: the empty workspace names only the palette key and shows the new mark;
  a new icon (the four-tile design recoloured to Mozaik's sage and sand) for the app, the
  status line and the empty workspace; the launcher is Ctrl+Shift+' (VS Code's `oem_7`, a key
  position written `[Quote]`), settings stay Ctrl+Shift+, (`oem_comma`); the palette and the
  launcher scroll the selected entry into view; palette commands list the five run last,
  a line, then the rest by match and alphabetically; the IDE's code area starts and stays
  empty without an "Untitled" tab, a double click on its tab bar adds a file; Workspace
  Settings name the start folder of new terminals and File Managers. Code analysis
  (Mozaik_Code_Quality_Integration_Plan stage 1 and 3): clangd's live clang-tidy checks
  (`--clang-tidy`), clang-tidy on the current file or the whole compilation database with
  parallel workers and Cancel, findings with rule and source in Problems (grouped across
  sources, stale after edits or another build folder), a Problems filter, fixes after a diff
  preview and a hash check, Output → Analysis, a status bar state, settings and palette
  commands. SonarLint (stage 2) is not shipped: its feasibility gate was not passed.
- **Checks**: `npm test` **91 passed**. `npm run test:e2e` **79 passed, 1 failed**: "panels
  keep independent history but share pins" (File Manager) fails the same way on a clean
  checkout of `HEAD` in this environment, so it is not caused by these changes (the pin
  mock does not reach the module instance the app uses). New E2E: recent and alphabetical
  palette with scrolling, start folders, empty code area with double click, clang-tidy run →
  Problems filter → fix preview → stale. `npm run test:production` **1 passed**.
  `cargo test` **82 passed** (1 ignored), among them one that runs this machine's real
  clang-tidy 21.1.4 (MinGW) on a small compilation database and reads its fix; Clippy and
  `cargo fmt --check` clean; `npm run build` and `format:check` passed.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 78.

Twelfth review (2026-10-31, decisions [009](decisions/009-notes.md) and
[016](decisions/016-tabs-and-editors.md); a change in [017](decisions/017-code-analysis.md)):

- **Implemented**: New Window builds its window from an async command (a synchronous one
  deadlocks WebView2 on Windows and left the new window white); the status line's mark and
  clock line up with the panels' outer edges; the palette lists the IDE's command groups
  (CMake, Test, Coverage, Analysis, Debug) only while an IDE is in the workspace (Debug also
  while a session runs); the Problems filter sits at the right of the bottom panel's bar, and
  the dock toggles no longer carry the workspace `panel` class; a Text Editor panel's `+`
  offers New File, Open File… and Open Folder… ("New Text Tab" is now "New File"), and an
  opened folder shows at the left of the panel as in Sublime Text; Notes keep their notes as
  Markdown files of a notes folder with subfolders as groups (no `notes.json`).
- **Checks**: `npm test` **91 passed**. `npm run test:e2e` **81 passed** (new: + menu, Open
  File and Open Folder, IDE commands hidden without an IDE, Problems filter in the bar, and
  the notes folder: choose folder, groups, rename, move, Trash, changed-on-disk decision).
  `cargo test` **84 passed** (1 ignored; new: folder scan, paths inside the folder, revision
  checked saves, no-replace create/rename/move), Clippy and `cargo fmt --check` clean,
  `npm run build` and `format:check` passed.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 79.

Thirteenth review (2026-11-01, decisions [016](decisions/016-tabs-and-editors.md),
[018](decisions/018-layout-templates.md); changes in [002](decisions/002-editor-and-data.md),
[004](decisions/004-file-manager.md) and [009](decisions/009-notes.md)):

- **Implemented**: a Text Editor tab's Split Right/Down, or a text tab dropped at an edge of a
  Text Editor, divides the panel into editor groups with a line between them (a split marked
  `group`), which maximize and close together and never hold other modules; a Text Editor
  added to the workspace is a page to write on without a tab, typing makes it an Untitled
  tab, and closing the last tab leaves the page (and the panel's folder) instead of closing
  the panel; the Text Editor highlights by file name with the Code Editor's grammars (no
  language server needed); Notes drop the word "vault" and the comparison with Obsidian;
  Notes' header has new-note and new-group icon buttons and names new items and renames in
  the tree instead of a dialog; the File Manager's right-click menu has New file and New
  folder (a file's name is typed with its extension); a File Manager double click, Enter or
  pin opens a text file as a tab of the workspace's Text Editor (or a new one beside), files
  dragged onto a Text Editor open there, and other files still go to their default
  application; layout templates (Save Layout as Template…, Open Layout Template…, Delete
  Layout Template…) keep modules and their places in `layouts.json`.
- **Checks**: `npm test` **96 passed** (new: editor groups in the model, templates to and
  from workspaces). `npm run test:e2e` **84 passed** (new: editor groups, the page to write
  on, File Manager open and drag into the Text Editor, context menu New file, inline Notes
  naming, layout templates). `cargo test` **86 passed** (1 ignored; new: template validation,
  no silent replace, damaged file). Clippy and `cargo fmt --check` clean, `npm run build`
  and `format:check` passed. Browser runs used a fresh Vite server on another port: the
  running `tauri dev` server's hot-reloaded modules made the File Manager's pin test fail
  with two module instances.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 80.

Fourteenth review (2026-11-01; changes in [002](decisions/002-editor-and-data.md),
[003](decisions/003-terminal.md), [004](decisions/004-file-manager.md) and
[016](decisions/016-tabs-and-editors.md)):

- **Implemented**: the File Manager names new files and folders in a row at the top of its
  list and renames in the row (F2), without a dialog (the field is shared with Notes); its
  right-click menu adds **Open in Terminal** (a tab of the workspace's Terminal, or a new one
  beside) and **Open in IDE (New Window)** (a new window that starts with an IDE on the
  folder, checked by Rust and taken once by that window); a Text Editor page keeps the ✕ in
  its panel bar, which closes the panel; tabs have soft top corners and the selected tab joins
  its content without the line under it, as in VS Code; the Text Editor's status bar shows
  the active file's path at its left; a Terminal panel's **+** lists the detected shells and
  adds the chosen one as a tab; terminal tabs can be renamed in place from the tab menu.
- **Checks**: `npm test` **96 passed**. `npm run test:e2e` **86 passed** (new: a terminal
  panel's shell menu and tab rename, File Manager Open in Terminal and Open in IDE; updated:
  inline File Manager naming, the page's close button, the status bar path). `cargo test`
  **86 passed** (1 ignored). Clippy and `cargo fmt --check` clean, `npm run build` and
  `format:check` passed. Browser runs again used a fresh Vite server on another port.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 81.

Fifteenth review (2026-11-01; changes in [003](decisions/003-terminal.md) and the new
[019](decisions/019-fonts.md)):

- **Implemented**: the terminal's 16 ANSI colors follow the user's prompt colors and
  installed Nerd Fonts are tried first; Workspace Settings → General → Font (the interface
  font) with **Use for all modules**, and a Font field in the Text Editor, IDE, Terminal and
  File Manager tabs and two (Tasks, Notes) in Tasks and Notes. Fonts apply at once to open
  editors and running terminals and are kept in `preferences.json`.
- **Checks**: `npm test` **100 passed** (new: font variables, "all", fallbacks, rejected
  names). `npm run test:e2e` **87 passed** (new: a module font, a rejected name, the General
  font for all modules). `cargo test` preferences test passed (fonts kept and validated).
  Clippy and `cargo fmt --check` clean, `npm run build` and `format:check` passed.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 82.

Sixteenth review (2026-11-01; changes in [003](decisions/003-terminal.md) and the new
[020](decisions/020-powershell-prompt.md)):

- **Implemented**: Workspace Settings → Terminal → **PowerShell prompt**, a `.ps1` file new
  PowerShell terminals run after the profile (`-NoExit -EncodedCommand`, at most 8 KiB, a
  warning line when it cannot be read); the dependency-free example
  `examples/powershell/path-venv-git-prompt.ps1` (folder, venv/Conda, Git branch, `❯❯`).
  References to oh-my-posh were removed; Mozaik never depended on it.
- **Checks**: `npm test` **100 passed**. `npm run test:e2e` **87 passed** (updated: the
  prompt field rejects a non-`.ps1` path and saves a trimmed one). `cargo test` **87 passed**
  (1 ignored; new: PowerShell detection, Base64 of UTF-16LE, the prompt file's path, BOM, size
  and encoding checks). Clippy and `cargo fmt --check` clean, `npm run build` and
  `format:check` passed. The example was run in Windows PowerShell 5.1 (`-NoProfile`): the
  prompt text in the repository (`git(main)`), home, `C:\`, a deep folder and with a venv,
  `$LASTEXITCODE` kept. With the execution policy `Restricted`, `-File` was refused and
  `-EncodedCommand` ran it. PowerShell 7 is not installed here.
- **Not run in Tauri**: see [VALIDATION](VALIDATION.md#v08-debugging-qualification) item 83.

Seventeenth review (2026-11-01; changes in [003](decisions/003-terminal.md),
[007](decisions/007-workspace-shortcuts.md) and [018](decisions/018-layout-templates.md)):

- **Implemented**: font fields list every installed font when opened (a datalist showed
  only the ones matching the chosen font) and filter as the user types; a module font set by
  General → Use for all modules is dimmed and says why on hover. The Workspace key no
  longer lists Right Alt. Save Layout as Template, the IDE's New File/New Folder/Rename and
  Tasks' New List ask for the name in a palette-style prompt (`NamePrompt`, replacing
  `NameDialog`); replacing, opening and deleting a template are confirmed in a palette pick
  list. In a terminal Ctrl+Shift+C still copies a selection and closes the panel without one.
- **Checks**: `npm test` **100 passed**. `npm run test:e2e` **88 passed** (new: Ctrl+Shift+C
  in a terminal; updated: the font list after a pick, the disabled font's hint, the template,
  explorer and Tasks name prompts). `npm run build` and `format:check` passed. Not run in
  Tauri: the native tooltip and the terminal's copy with a real selection.

## v0.8.0 release preparation

- Version 0.8.0 in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json`; the first
  public release.
- Licensed GPL-3.0-or-later (`LICENSE`), with `THIRD_PARTY_NOTICES.md` for bundled software
  and Excalidraw's fonts. elkjs (EPL-2.0, Mermaid's optional `layout: elk`) is replaced at
  build time by `src/plugins/mermaid/no-elk.ts`; diagrams use Mermaid's dagre layout (Mermaid 12
  defaults to ELK) and a file asking for `layout: elk` shows a message.
- `npm audit` reports no vulnerabilities: `overrides` raise lodash-es and, inside
  Excalidraw's pinned tree, nanoid and KaTeX to fixed releases. Excalidraw stays 0.18.1.
- The File Manager also refuses to open Python scripts, MMC consoles, CHM help, MSIX/APPX
  packages and Windows shell link types.
- The README is a short introduction; the per-tool text moved to `docs/USER_GUIDE.md`.
- The Windows installer is built by the `Release` workflow, started by hand from GitHub
  Actions on `main`: it checks that the three versions agree and that no `v<version>` tag or
  release exists, runs the `Validate` checks, builds the NSIS installer and creates a draft
  release with it and its SHA-256 file. The tag is created only when the draft is published,
  so a failed run leaves nothing behind. The workflow has not run on GitHub yet.
- `Validate` runs on Windows only for v0.8.0. On ubuntu-24.04 two browser tests failed
  (Close Others left all tabs open; the Delete key on a note row opened no dialog) and could
  not be reproduced on Windows; the Linux job returns after they are checked on Linux.

## v0.9.0 release preparation

- Version 0.9.0 in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json` (and the
  lock files). A minor release: the reviews since v0.8.0 add features within the V0.8
  scope (no new plan module) and change how Notes stores its data.
- **Upgrading from v0.8.0:** Notes now keeps each note as a Markdown file in a folder chosen in
  Workspace Settings; the old `notes.json` in app data is not read or migrated and stays where
  it was ([009](decisions/009-notes.md)). Release notes must say so.
- Main changes since v0.8.0: Text Editor editor groups, a folder beside the editor, a page to
  write on, New File/Open File from **+**, highlighting by file type and the path in its
  status bar; layout templates from the palette; fonts per module or for all; a PowerShell
  prompt file; picking a terminal's shell and renaming terminal tabs; File Manager file and
  folder creation in the list, opening files in the Text Editor and folders in a terminal or a
  new IDE window; names asked in the palette's place.
- Since the seventeenth review a module that is still loading shows an empty panel instead of
  "Opening…", and every font field lists its default first (System font, Default or General
  font, with the family it shows), so a chosen font can be undone.
- Security check: `npm audit` reports no vulnerabilities; `cargo audit` reports no
  vulnerabilities, only warnings for unmaintained or unsound crates in the Linux GTK/D-Bus
  tree of Tauri (`proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`, `glib`
  0.18), which Mozaik does not use directly. The capabilities and CSP are unchanged since
  v0.8.0. The Rust commands added since v0.8.0 (layout templates, Notes files, fonts, the
  PowerShell prompt file, `choose_folder`, `take_window_start`) validate their input; font
  names cannot leave the CSS value, and the prompt file must be an absolute `.ps1` path of at
  most 8 KiB, passed Base64-encoded, never joined into a command line. A Notes group that is a
  link or junction out of the notes folder was still accepted for new notes, new groups, moves
  and Trash (notes already checked this); groups are now checked the same way.
- The prompt file runs with the user's rights, like their profile, and `-EncodedCommand` is
  not subject to the execution policy ([020](decisions/020-powershell-prompt.md)). Changing
  the setting needs the renderer, which can already type into a terminal, so it adds no new
  way to run code.

## Eighteenth review (after v0.9.0)

- Color themes and IDE zoom ([021](decisions/021-themes-and-zoom.md)); the IDE status bar
  uses a smaller font and cuts long CMake choices with an ellipsis (the full text is in the
  tooltip); Source Control no longer repeats the branch above Changes (the status bar shows
  it); code hovers and completions float in their own popup color with an edge and shadow.
  Browser checks only; native WebView2/WebKitGTK rendering of the themes is not yet verified.
- Developer: Reload Window and `mozaik -ide <path>`
  ([022](decisions/022-reload-and-command-line.md)). The argument parsing has a Rust test;
  the reload and the command line were not run natively.
- IDE Explorer: Ctrl/Shift multi-selection, cut/copy/paste shared with the File Manager
  (a name in use asks Keep Both, Replace or Skip), a drag preview next to the pointer,
  vscode-icons-style kind icons drawn in Mozaik, and New File/New Folder/Refresh/Collapse
  Folders on the title while hovered (E2E with a fake backend).
- File Manager search through subfolders and the This PC page
  ([004](decisions/004-file-manager.md)): Rust tests and E2E with a fake backend; not yet run
  on native Windows or Linux.
- File Manager files open as a tab in the File Manager's panel when the workspace has no Text
  Editor (E2E). Drawings and diagrams clicked in the IDE Explorer open in Excalidraw or
  Mermaid as a tab among the code editors (not covered by E2E yet).
- clangd gets `--query-driver` for the compilers CMake recorded in the build folder, not only
  for a chosen kit, so a preset that picks MinGW lets clangd find its standard library. Paths
  from CMake's record use the platform's separators, so GDB found next to the compiler is
  `C:\…\bin\gdb.exe`, not `C:/…/bin\gdb.exe`. Rust tests; not yet run against a native MinGW
  preset project. A recorded compiler is passed only when it exists outside the project, is
  named like a compiler and holds no glob characters: a repository could commit a build folder
  whose record and `compile_commands.json` name its own program, which clangd would then run
  when a file is opened (found in the v0.10.0 security check).
- The Windows installer ships Microsoft's current ConPTY (`conpty.dll`, `OpenConsole.exe`)
  so full-screen terminal programs (opencode, Claude Code) scroll back as in Windows Terminal
  ([023](decisions/023-conpty.md)). The download script ran here; the installer build and the
  programs in a native Mozaik terminal were not run.
- CMake files get Mozaik's own highlighting and completion (commands, keywords, variables,
  the file's targets): unit tests and E2E.
- IDE features can be turned off in Settings → IDE → Features
  ([024](decisions/024-ide-features.md)): E2E for the sidebar, status bar, panel, gutter and
  palette; a Rust test for the preference. That no clangd or Git process starts was not
  observed natively.
- Undo and Redo of file operations, shared by the File Managers and the IDE Explorer
  ([025](decisions/025-file-undo.md)), and same-folder pastes without a question: E2E with fake
  file systems and a Rust test for the transfer report. Restoring from the real Recycle Bin
  or freedesktop Trash was not exercised natively.
- IDE Explorer: names typed in the tree's rows, no text selection while dragging, a click
  on the empty space clears the selection, file icon themes from the palette with preview,
  and a Settings gear in the activity bar: E2E.

## v0.10.0 release preparation

- Version 0.10.0 in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json` (and the
  lock files). A minor release: the reviews since v0.9.0 add features within the V0.8 scope.
  Build the Windows installer with `npm.cmd run package:windows` (it ships ConPTY,
  [023](decisions/023-conpty.md)); a plain `tauri build` leaves it out.
- **Upgrading from v0.9.0:** nothing to migrate. `preferences.json` gains `ideDisabledFeatures`
  and `ideIconTheme`; files without them get every IDE feature on and the Seti icons. The
  Explorer's box-shaped file badges are replaced by the Seti icon theme.
- Main changes since v0.9.0: color themes and IDE zoom; Developer: Reload Window and
  `mozaik -ide <path>`; File Manager search through subfolders, a This PC page, Undo/Redo of
  file operations (shared with the IDE Explorer) and same-folder pastes without a question;
  IDE Explorer multi-selection, cut/copy/paste, rename in place and file icon themes; CMake
  highlighting and completion; IDE features that can be turned off; clangd finding MinGW's
  headers with presets; the current ConPTY in the installer; colored task priorities.
- Security check: `npm audit` reports no vulnerabilities. `cargo audit` reports no
  vulnerabilities; its warnings are the unmaintained or unsound crates of Tauri's Linux
  GTK/D-Bus tree listed for v0.9.0, and `async-executor` 1.14.0 being yanked, now 1.14.1. The
  capabilities and CSP are unchanged since v0.9.0. The Rust commands added since v0.9.0 —
  `list_drives`, `search_directory`/`cancel_search` (names only, links not followed, at most
  5000 results, cancellable, query up to 260 characters), `reload_window` (a folder checked as
  a project root, which `project_open` already accepts) and `restore_from_trash` (only to a
  free path, never replacing) — validate their input and give the renderer nothing it could
  not already do. One finding was fixed: clangd's `--query-driver` took the compilers named in
  the build folder's CMake record, so a repository that commits a build folder could have
  clangd run its own program when a file is opened; recorded compilers must now exist outside
  the project and be named like compilers. ConPTY is downloaded only by the build script, with
  a pinned SHA-256. Starting the debugger still runs GDB found next to the recorded compiler;
  debugging builds and runs the project's code anyway, so it already trusts the project.
- Checks run for this release: Rust tests, Clippy, `cargo fmt`, vitest, the full Playwright
  suite, the production offline test and the format check. The installer was not built and
  nothing was run natively here.

## Review after v0.10.0

- **Ctrl+Shift+M** Minimize Window, also a palette command and rebindable
  ([007](decisions/007-workspace-shortcuts.md)). The Code Editor no longer opens CodeMirror's
  lint panel with it. Unit-tested key matching only; minimizing was not run in Tauri.
- A note's Edit page is a CodeMirror editor with the editing shortcuts of the text and code
  editors (Ctrl+L, Ctrl+D, Ctrl+Alt+Up/Down, Alt+click, line comment chords, Find / Replace)
  and Markdown highlighting ([009](decisions/009-notes.md)). Browser-tested (Notes and
  Settings scenarios); IME and AltGr typing in a note were not checked natively.
- IDE zoom scales the whole IDE as in VS Code, not only the code text: its panels, tabs,
  menus, docked bars, Output lines and bottom panel terminals
  ([021](decisions/021-themes-and-zoom.md)). Browser-tested (IDE zoom scenario and the full
  E2E suite); WebView2/WebKitGTK rendering at other sizes was not checked natively.

## v0.11.0 release preparation

- Version 0.11.0 in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json` (and the
  lock files). A minor release: the changes since v0.10.0 add features within the V0.8 scope.
  Build the Windows installer with `npm.cmd run package:windows` (it ships ConPTY,
  [023](decisions/023-conpty.md)); a plain `tauri build` leaves it out.
- **Upgrading from v0.10.0:** nothing to migrate; no stored file changed its format. The
  existing `ideFontSize` now sizes the whole IDE (its ratio to 13px), so a user who enlarged
  the code text will see the sidebar, tabs, bottom panel and status bar grow with it.
- Main changes since v0.10.0: IDE zoom scales the whole IDE as in VS Code (panels, tabs,
  menus, docked bars, Output lines and bottom panel terminals); Ctrl+Shift+M Minimize Window;
  a note's Edit page is a CodeMirror editor with the text and code editors' editing
  shortcuts, Find / Replace and Markdown highlighting; centered C++ pluses and badges on
  well-known folders in the Explorer icons.
- Security check: `npm audit` reports no vulnerabilities. `cargo audit` (advisory database
  of 1403 advisories) reports no vulnerabilities; its five warnings are the unmaintained or
  unsound crates of Tauri's Linux GTK/D-Bus tree listed for v0.9.0 (`proc-macro-error`,
  `zbus_names`, `zvariant`, `zvariant_derive`, `glib` 0.18), which Mozaik does not use
  directly. Nothing under `src-tauri` changed since v0.10.0 except the version: no new Rust
  commands, and the capabilities and CSP are the same (Minimize Window uses the
  `core:window:allow-minimize` permission the window already had). No dependency was added
  or updated. The renderer changes add no network access, no HTML injection (the existing
  `innerHTML` uses are CodeMirror markers, sanitized LSP Markdown and Mermaid's strict SVG,
  unchanged) and no new native calls; the IDE zoom is a CSS variable set from a number the
  preferences already validate (8–32).
- Checks run for this release: Rust tests (94 passed, 1 ignored), Clippy with `-D warnings`,
  `cargo fmt --check`, vitest (108), the full Playwright suite (96), the production offline
  test and the format check. The installer was not built and nothing was run natively here.

## Twenty-first review (after v0.11.0)

The user's list of IDE and File Manager requests ([026](decisions/026-ide-and-file-manager-requests.md)).

Run on Windows 11 in this workspace: `cargo test` (105 passed, one ignored), `cargo clippy`,
`cargo fmt`, `npm test` (125 passed), `npm run build`, the production offline test, and the full
Playwright suite in Edge (110 passed) with fake native backends. The real clangd test also passed
against the clangd on this machine: its semantic tokens color names, and with `-Wall` as a fallback
flag an unused variable shows a warning. `clangd --check` showed the flags reach the compile command
from a compilation database, and clang-tidy reported the unused variable with `--checks` and
`--extra-arg=-Wall`.

**Not run in the desktop app (Tauri, WebView2):** copying, cutting and pasting between two windows and
two processes; a real `.lnk` from Windows (the format's reader is unit-tested on built bytes);
`navigator.clipboard` in the code menu and Copy Path, which only ran in Edge with permission granted;
F5 and Ctrl+R against WebView2's own accelerators (only Edge's); the minimap's rendering, scale factors
and speed on large files; `git log` through the app, on a real repository.

## v0.12.0 release preparation

- Version 0.12.0 in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json` (and the lock
  files), and the README. A minor release: the changes since v0.11.0 add features within the V0.8
  scope. Build the Windows installer with `npm.cmd run package:windows` (it ships ConPTY,
  [023](decisions/023-conpty.md)); a plain `tauri build` leaves it out.
- **Upgrading from v0.11.0:** nothing to migrate. Stored files gain fields with defaults (a pin's
  label, the new preferences, the analysis settings), and older files load. Behavior a user will
  notice: a click in the Explorer no longer moves the focus to the editor (double click or Enter
  does); F5 and Ctrl+R no longer reload the window; clangd and clang-tidy get `-Wall -Wextra` by
  default, so existing projects may show more warnings (Settings → IDE → Code Analysis).
- Main changes since v0.11.0 ([026](decisions/026-ide-and-file-manager-requests.md)): the minimap with
  Git's changes as bands and the scrollbar right of it, themed scrollbars, Git marks beside the line
  numbers, the Source Control graph, refresh and multi-select, VS Code's Search with ignored files on
  request, Markdown preview in the Text and Code Editors, C++ highlight themes over clangd's semantic
  tokens, compiler warnings and default clang-tidy checks, a file clipboard shared by all windows,
  opening Windows shortcuts, named pins and their list, centered jumps, and the code menu's Cut, Copy
  and Paste.
- **Security check.** `npm audit` reports no vulnerabilities. `cargo audit` (1409 advisories, 502
  crates) reports no vulnerabilities; its five warnings are the unmaintained or unsound crates of
  Tauri's Linux GTK/D-Bus tree listed for earlier releases (`proc-macro-error`, `zbus_names`,
  `zvariant`, `zvariant_derive`, `glib` 0.18), which Mozaik does not use directly. Capabilities, CSP
  and CI workflows are the same as v0.11.0. The only dependency change is `uuid`'s `v5` feature, which
  adds `sha1_smol` (BSD-3-Clause, covered by the notices); it names a cache folder and protects nothing.
  The diff since v0.11.0 was read for new commands, process arguments, HTML sinks and network access.
  It adds no HTML sink or network request; the Markdown tables stay React elements with plain text.
  New process arguments are validated (check names, `-W…` flags without a comma, so no `-Wl,`), and
  commit text from `git log` is only ever rendered as text.
- **Found and fixed by that review** ([026](decisions/026-ide-and-file-manager-requests.md)):
  - A shortcut naming `run.cmd.` or `run.cmd ` passed the extension check, and ShellExecute runs such
    a name (a probe with a harmless script on this machine showed it; not run through the app), against
    the rule that the File Manager runs no programs. Reachable only through shortcuts, new in this
    release.
  - A shortcut's target on a network path was looked up, which connects to that host. Found by reading
    the code, with no host to try it against; a test now shows such targets are refused.
  - `git status`, which Mozaik runs by itself, started a clean filter from the opened folder's own
    `.git/config` (a probe and a test with real Git showed it). The fixed command was not new in this
    release, so earlier releases very likely have it too; they were not run to confirm. `git add` and
    `git restore`, which the user starts, keep their filters on purpose.
- **Not changed, for a later decision:** the release workflow uses actions by tag (`actions/*@v4`,
  `dtolnay/rust-toolchain@stable`), not by commit, in a job that can write releases; the installer is
  not code-signed; the CSP keeps `style-src 'unsafe-inline'`. Configure, build, clangd and clang-tidy
  read a project's own files as before, so a project one does not trust should not be built.
- Checks run for this release: Rust tests (108 passed, 1 ignored), Clippy with `-D warnings`,
  `cargo fmt --check`, vitest (125), the full Playwright suite (111), now with scrollbars shown, the
  production offline test and the format check on the committed files. The installer was not built and
  nothing was run natively here: the steps in `docs/VALIDATION.md` after v0.11.0 are still open.

## After v0.12.0: errors on the minimap, large C++ files

- The minimap marks lines with errors. Git's marks compare whole lines, the Problems view renders only
  the rows in view, and Outline re-renders only with a new answer ([026](decisions/026-ide-and-file-manager-requests.md#large-files)).
- Measured with a CPU profile in Edge on 6,000 lines of C++ and the real clangd 23, in Vite's dev build,
  time from the click to the editor showing or to typing 30 characters: open with a reformatted base
  37.2 s → 0.21 s; with every third line changed 2.5 s → 0.23 s; typing with 1,844 problems 3.5 s →
  0.49 s. Plain opening was already 0.2 s, unchanged.
- Checks run: vitest (131), `tests/e2e/ide.spec.ts` and `ide-clangd.spec.ts` (38), build, format check.
  **Not run in the desktop app (Tauri, WebView2)**, so the user's own file has not been measured.

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

## After v0.12.0: the IDE as a whole

A window with an IDE holds only the IDE (other modules float beside it, Ctrl+Shift+Enter), code panels are editor groups (one file can show in several), every file opens as a tab among the code editors (images in a viewer), Claude Code and Codex run beside the code, each module has a font size, and Mermaid previews zoom and move ([027](decisions/027-ide-as-a-whole.md), [021](decisions/021-themes-and-zoom.md), [008](decisions/008-mermaid.md)). Verified in browser tests only; the native steps are in [VALIDATION](VALIDATION.md).

## SonarQube ([028](decisions/028-sonarqube.md))

- **Implemented**: a SonarQube view in the IDE's activity bar connects a project to a server
  (address and project key from `sonar-project.properties`, a user token in the system's
  credential store) and shows the issues and Quality Gate of the analysis CI made for the local
  branch's merge request, else the branch, else the main branch. Issues are placed in the
  working tree through Git and the editor's text (as analyzed, moved, changed, unmatched), drawn
  in the editor, listed in Problems as `SonarQube`, and two refreshes are compared (fixed, new).
  Read-only GET requests through Rust on Connect and Refresh only; no scanner, no local analysis.
- **Checks**: `cargo test` **125 passed** (1 ignored), among them a stand-in server on 127.0.0.1
  modeled on SonarQube Cloud's public responses and a real temporary Git repository; Clippy and
  `cargo fmt --check` clean. `npm test` **147 passed**, `npm run test:e2e` **124 passed** (new:
  the SonarQube view, Problems, editor marks, tracking while editing, compared refreshes),
  `npm run test:production` **1 passed**, `npm run build` and `format:check` passed.
- **Not run in the desktop app (Tauri)** and not against a SonarQube Server: see
  [VALIDATION](VALIDATION.md#sonarqube-028).

## v0.13.0 release preparation

- Version 0.13.0 in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json` (and the lock
  files), and the README. A minor release. Build the Windows installer with
  `npm.cmd run package:windows` (it ships ConPTY, [023](decisions/023-conpty.md)).
- **Linux packages.** The `Release` workflow now also builds a `.deb` and an AppImage on Ubuntu
  22.04, after running the Rust tests there, and attaches them to the draft with their SHA-256
  files; the release notes say they are untried. A failed Linux job leaves them out and keeps
  the Windows installer. Only the draft job may write to the repository now (before, the Windows
  build job could). The workflow has not run on GitHub with these changes.
- **First Linux build, in WSL (Ubuntu 24.04, WSLg) on this machine:** the same commands built
  `Mozaik_0.13.0_amd64.deb` (21.8 MiB) and `Mozaik_0.13.0_amd64.AppImage` (96.8 MiB); the app was
  not started from them. There, Rust tests 125 passed (1 ignored) after two tests that parsed
  Windows paths on Linux were fixed (the code was right), Clippy was clean, and vitest (147), the
  build, the format check, the full Playwright suite (124 passed, the clangd test skipped without
  clangd) and the production offline test passed. Playwright's Chromium ran with NSS from Ubuntu's
  packages unpacked into a cache folder, as `sudo` was not available.
- **Found on Linux and fixed:** releasing the middle button pastes Linux's primary selection into
  the focused editor in Chromium, so closing a tab with it added the last selected text to another
  file (unsaved, undoable). A probe and a new browser test showed it; the release's default is now
  prevented on workspace and agent session tabs, and the test also fails on Windows without the
  fix. This was the "Close Others" failure that kept Linux out of `Validate` since v0.8.0: it
  failed only after another test of the same browser had selected text. The other one (Delete on a
  note row) passed. `Validate` runs on ubuntu-24.04 again. Whether WebKitGTK pastes the same way
  is not known: the app was not run on Linux.
- **Upgrading from v0.12.0:** nothing to migrate. New files are added only when used
  (`sonar.json`; the token in the credential store), and the new preferences (module font sizes)
  have defaults. Behavior a user will notice: a window with an IDE holds only the IDE, code panels
  split into editor groups, and every file opens as a tab among the code editors
  ([027](decisions/027-ide-as-a-whole.md)).
- Main changes since v0.12.0: the IDE as a whole with editor groups and file tabs, Claude Code and
  Codex sessions beside the code, a font size per module, Mermaid previews that zoom and move,
  errors on the minimap and faster large C++ files, and the SonarQube view
  ([028](decisions/028-sonarqube.md)), the one network access, to the user's own server.
- **Security check.** `npm audit` reports no vulnerabilities. `cargo audit` (1422 advisories, 565
  crates) reports no vulnerabilities. Its eight warnings are the five listed for v0.12.0 and three
  new ones of the same kind: keyring's Secret Service on Linux brings zbus 4 (`zbus_names` 3,
  `zvariant` 4, `zvariant_derive` 4, unmaintained like the zbus 5 crates Tauri already uses).
  - **New dependencies.** `reqwest` with `native-tls` (SChannel on Windows, the system's OpenSSL
    on Linux) and `keyring` add 60 crates, all under MIT, Apache-2.0 or BSD-3-Clause and covered
    by the notices. `dbus-secret-service` is in the lock file only as an optional dependency that
    is not built.
  - **Unchanged.** Capabilities and CSP are as in v0.12.0: the renderer still cannot reach the
    network. The workflows changed only as described above (Linux packages, Linux in `Validate`).
  - **What the review of the diff since v0.12.0 found.** It was read for new commands, process
    arguments, HTML sinks and network access, and adds no HTML sink: the server's texts render
    as text, with no links. The SonarQube requests are GETs to the saved address only. A token
    stays with the address it was saved for, and is never returned to the renderer or logged. A
    redirect to another scheme, host or port is not followed (tested). Issue paths outside the
    analyzed folder are dropped (tested). The new Git commands take only 7–64 hex digit commit
    names, and `git diff` starts none of the repository's own filters (now tested, like `status`).
- **Found and fixed by that review** ([027](decisions/027-ide-as-a-whole.md#coding-agents)):
  - With Command Prompt as the shell, an agent's `cmd /k claude` ran a `claude.bat` at the top of
    the opened project instead of the installed Claude Code, because Command Prompt looks in the
    current folder first. A probe with a harmless script on this machine showed it, outside the
    app; a Windows test shows `NoDefaultCurrentDirectoryInExePath=1`, now set for those sessions,
    stops it. The agents are new in this release, so no released version had this.
- **Not changed, for a later decision**, as in v0.12.0: the release workflow uses actions by tag,
  the installer is not code-signed, and the CSP keeps `style-src 'unsafe-inline'`. An `http://`
  SonarQube address sends the token unencrypted; the view warns about it but still allows it.
- **Checks run for this release:**
  - Rust: tests (125 passed, 1 ignored), Clippy with `-D warnings`, `cargo fmt --check`.
  - Front end: vitest (147), the full Playwright suite (125 with the middle-click test), the
    production offline test, the build and the format check.
  - On Linux (WSL): as listed above.
  - Not done: the Windows installer was not built, and the app was not run natively on either
    system. The steps in `docs/VALIDATION.md` after v0.11.0 and v0.12.0, and for SonarQube, are
    still open.

## Window identity and command control (2026-11-07)

- **Implemented:** the centered control in the custom top strip opens the existing command
  palette and shows the IDE project name, the explicitly opened layout template name, or
  Mozaik. The document and native window title use the same identity (`<name> — Mozaik`). The
  renderer received only Tauri's narrow `allow-set-title` permission.
- **Checks:** TypeScript, production frontend build, format check, Vitest (**147 passed**),
  `cargo check`, and three focused Playwright scenarios for the control, layout title and IDE
  project title passed.
- **Not run natively:** the title and control were not inspected in WebView2 or the Windows
  taskbar/window switcher; this remains in [VALIDATION](VALIDATION.md#v07-ide-qualification).

## Command control text and a second IDE (2026-11-07)

- **Implemented:** the command control sits centered in the visible strip above the panels
  and shows the focused IDE's project name, or Command Palette without an IDE; a layout name
  stays in the OS window title only while the window holds panels. A second IDE splits the
  whole window and opens on the right, keeping the first sidebar's width; a third is refused
  (decision [027](decisions/027-ide-as-a-whole.md)).
- **Checks:** TypeScript, production frontend build, format check, Vitest (**148 passed**)
  and the full Playwright suite (**127 passed**).
- **Fixed:** closing one of two IDEs from its code editor (Ctrl+Shift+C) left its code
  editors open; they now close with it.
- **Not run natively:** the control's vertical placement and two IDEs side by side were not
  inspected in WebView2.

## Markdown links and pictures, VS Code-like dark themes (2026-11-07)

- **Markdown preview** ([029](decisions/029-markdown-links-and-themes.md)): a README's allowed
  HTML layout renders; heading links scroll, local file links open the file (code beside code,
  else a Text Editor tab), local pictures show from blobs. Web links and pictures stay text.
- **Themes:** Dark Modern, Dark+, Monokai, One Dark, Dracula, Solarized Dark, Abyss, Tomorrow
  Night Blue, Kimbie Dark and High Contrast Dark.
- **Checks:** TypeScript, production frontend build, format check, Vitest (**156 passed**)
  and the full Playwright suite (**128 passed**; a new scenario covers pictures, heading and
  file links and inert scripts in the IDE preview).
- **Not run natively:** pictures read through `drawings_read_image` in WebView2, the Text
  Editor's link opening (only the IDE's is browser-tested) and the new themes' look.

## Recent projects in Add to Workspace: IDE (2026-11-07)

- **Palette:** Add to Workspace: IDE lists Empty Project, then the ten folders opened last
  (`ide-recent.json` now keeps a list, still readable by earlier versions)
  ([029](decisions/029-markdown-links-and-themes.md)).
- **Checks:** cargo fmt, Clippy, Rust tests (**126 passed**, 1 ignored), TypeScript, build,
  format check, Vitest (**156 passed**) and the full Playwright suite (**129 passed**).
- **Not run natively:** the list read from the real `ide-recent.json` in WebView2.

## Starter CMake project, floating IDE in a new window, `mozaik -i` and `-t` (2026-11-08)

- **IDE:** CMake: New Project in Empty Folder (palette) and New CMake Project (sidebar menu)
  write `CMakeLists.txt` and `main.cpp` into an empty project folder (hidden entries allowed,
  `create_new`, no replace) ([030](decisions/030-cmake-starter-and-command-line.md)).
- **Workspace:** Add to Workspace: IDE with Ctrl+Shift+Enter in a window with panels (palette or
  launcher) opens the chosen folder in a new window, past the two-IDE limit.
- **Command line:** `-i`/`-ide`/`--ide`; `mozaik -t <file>`/`--text` in a Mozaik terminal
  opens the file in that window (beside the Terminal tab, or in the IDE's code editors) through
  a per-process request folder (`requests.rs`), elsewhere in a new window.
- **Checks:** cargo fmt, Clippy, Rust tests (**129 passed**, 1 ignored), TypeScript, build,
  format check, Vitest (**157 passed**) and the full Playwright suite (**131 passed**).
- **Not run natively:** `mozaik -t` from Terminal, IDE and agent sessions (env variables,
  watcher events on Windows and Linux), the new window from Ctrl+Shift+Enter, and the starter
  project configured and built with a real kit.

## Explorer: Reveal in File Manager and Open in Integrated Terminal (2026-11-08)

- **IDE:** the Explorer's menu on a file or folder opens that folder (a file's folder) in a
  floating File Manager beside the IDE, or in a new terminal of the project's bottom panel.
  Both are off while several rows are marked.
- **Checks:** TypeScript, build, format check, Vitest (**157 passed**) and the full Playwright
  suite (**132 passed**).
- **Not run natively:** the File Manager and the shell started in the chosen folder on Windows
  and Linux.

## Files in their own IDE, faint inactive C++ code (2026-11-08)

- **IDE:** with two IDEs in a window, a file from one IDE's Explorer (or any jump into its
  project) opens among that IDE's code editors, not the ones focused last
  ([027](decisions/027-ide-as-a-whole.md)).
- **C++:** lines an `#if`/`#ifdef` leaves out show faintly, from clangd's inactive regions
  (clangd 17+) or its `comment` tokens (older) ([026](decisions/026-ide-and-file-manager-requests.md)).
- **Checks:** see the commit; the Playwright tests use a fake clangd.
- **Not run natively:** dimming with a real clangd (17+ or older) in the desktop app.

## Testing selection, debug keys and values, floating panels, includes, centering (2026-11-10)

- **Testing:** Ctrl/Shift marks several tests (Ctrl+A, arrows, Escape), a marked row's ▶ or
  the bar's counted ▶ runs them together; Collapse All / Expand All folds every suite.
- **Debugging** ([012](decisions/012-debugging.md)): VS Code's keys (F5, F6, F10, F11,
  Shift+F11, Shift+F5, Ctrl+Shift+F5, F9), acting only while they can and not in a terminal,
  File Manager or drawing; the toolbar moves by its grip, its buttons name their keys. Locals
  that GDB cannot read together are read one at a time (reproduced with GDB 18.1: junk locals
  before their constructor failed the whole scope). Debug Hover hides the language server's
  hover beside it and evaluates a hovered selection.
- **Floating panels:** a panel moved past the window's edge no longer makes the page
  scrollable (the workspace area clips).
- **`#include` completion:** clangd already offers folders (checked with clangd 23); choosing
  one now opens the completions inside it, as in VS Code.
- **Centering:** Undo/Redo and Back/Forward bring an off-screen place to the middle of the view
  and leave an on-screen one still.
- **Checks:** vitest, the Testing, Run and Debug, floating panel, `#include` and centering
  Playwright tests (each new assertion fails without its change), `tsc`. The GDB and clangd
  behavior was checked by driving them over DAP/LSP from Node, not through the app.
- **Not run natively:** the debug keys (F10 and F11 in WebView2 and WebKitGTK), the toolbar drag,
  Locals and the hover against a real session in the desktop app, the floating panel at the
  window's edge, include completion with clangd in the app.

## Status bar cursor, Problems folding, minimap settings, commit changes (2026-11-10)

- **IDE status bar:** the code editor's `Ln, Col` at the right, before line ending and encoding.
- **Problems:** a file's row folds its problems, per project, as search results do.
- **Minimap:** width (40–240 px) and scale (1×–3×) in Settings → IDE → Editor. A drag no longer
  follows the line under the pointer while the minimap itself scrolls (which jumped back and
  forth): a press centers that line, then the drag moves the slider by the pointer's distance,
  scrolls apply once per frame and the theme colors are read only when they change.
- **Testing:** a suite's tests are indented under it.
- **Source Control graph:** a commit opens to its changed files, a file opens a read-only
  comparison with the parent ([026](decisions/026-ide-and-file-manager-requests.md)); a button
  shows or hides the authors.
- **Drawings in the IDE:** an Excalidraw drawing or Mermaid diagram opened from the Explorer, among
  the code editors, has the IDE's size for its tab and status bar (IDE zoom), as the code tabs
  beside it; floating panels keep their module's size.
- **Folding:** a block whose closing bracket starts its line folds up to the line before it, as in
  VS Code, so an `else` stays on its own line.
- **Checks:** `cargo test` (preferences, Git: commit files and text in a real repository), vitest
  for the folding ranges, the Source Control Playwright test (graph, comparison, authors), `tsc`.
- **Not run natively:** the minimap drag and the commit comparison in the desktop app.

## v0.15.0 release preparation

- Version 0.15.0 in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json` (and the lock
  files), and the README. A minor release: new features, no breaking change. Build the Windows
  installer with `npm.cmd run package:windows` (it ships ConPTY, [023](decisions/023-conpty.md));
  the release workflow also drafts the Linux `.deb` and AppImage.
- **Upgrading from v0.14.0:** nothing to migrate; no stored file changed its format. `-ide` still
  works beside the new `-i`. Behavior a user will notice: every terminal's environment now has
  `MOZAIK_REQUESTS` and `MOZAIK_TERMINAL`, and C++ code an `#ifdef` leaves out is faint.
- Main changes since v0.14.0: a starter CMake project in an empty folder, an IDE in a new window
  from Add to Workspace, `mozaik -i <folder>` and `mozaik -t <file>`
  ([030](decisions/030-cmake-starter-and-command-line.md)), Reveal in File Manager and Open in
  Integrated Terminal in the Explorer, files opening in their own IDE when two share a window
  ([027](decisions/027-ide-as-a-whole.md)), faint inactive C++ code
  ([026](decisions/026-ide-and-file-manager-requests.md)), and Escape closing Excalidraw's export
  dialog after an export.
- **Security check.** `npm audit` reports no vulnerabilities. `cargo audit` (1422 advisories, 565
  crates) reports none; its eight warnings are those of v0.14.0. No dependency changed since
  v0.14.0 (neither lock file, apart from Mozaik's own version).
  - **Unchanged:** the CSP, the network rules, the Tauri capabilities and the release workflow.
  - **What the review of the diff since v0.14.0 found.** It was read for new commands, process
    arguments, file writes, paths and what crosses between processes. Nothing needed a fix:
    - `project_create_cmake` writes only `CMakeLists.txt` and `main.cpp` in a validated project
      root that holds nothing but hidden entries, with `create_new`, so no file (or link in its
      place) is replaced or followed. The folder's name reaches `CMakeLists.txt` as letters,
      digits and `_` only.
    - `requests.rs`: the request folder is under the user's own local app data, one per process,
      replaced at start and removed at exit. A request is read only from a regular `.json` file
      (not a link) of at most 64 KiB, needs a valid terminal session ID and an absolute path, and
      only opens that path as text in the session's window, through the usual validated read; it
      runs nothing and opens nothing in another application. Writing one needs the folder and a
      session ID, which only processes started in that terminal get: they can already do what the
      user can, so this gives them nothing more. That includes a `\\host\share` path, which such a
      process could reach itself.
    - Open in Integrated Terminal passes a folder that goes through the existing
      `start_directory` check; the shell is still chosen from the detected list.
    - Inactive regions from clangd become line decorations only, bounded by the document.
- **Not changed, for a later decision**, as in v0.14.0: the release workflow uses actions by tag,
  the installer is not code-signed, the CSP keeps `style-src 'unsafe-inline'`, an `http://`
  SonarQube address sends the token unencrypted (the view warns), and the File Manager's program
  types are a deny list.
- **Checks run for this release:**
  - Rust: tests (129 passed, 1 ignored), Clippy with `-D warnings`, `cargo fmt --check`.
  - Front end: vitest (160), the full Playwright suite (134), the production offline test, the
    build and the format check.
  - Not done: the installer was not built, and nothing was run natively here. The steps in
    `docs/VALIDATION.md` after v0.11.0 and v0.12.0, for SonarQube, Markdown links and pictures,
    `mozaik -t`, the Explorer's new commands and inactive C++ code are still open.

## v0.14.0 release preparation

- Version 0.14.0 in `package.json`, `src-tauri/Cargo.toml` and `tauri.conf.json` (and the lock
  files), and the README. A minor release. Build the Windows installer with
  `npm.cmd run package:windows` (it ships ConPTY, [023](decisions/023-conpty.md)); the release
  workflow also drafts the Linux `.deb` and AppImage.
- **Upgrading from v0.13.0:** nothing to migrate. `ide-recent.json` now keeps a list and still
  writes `root`, so v0.13.0 reads it. Behavior a user will notice: other modules float beside an
  IDE, a second IDE opens beside the first, the command control in the top strip, the Markdown
  preview's links and pictures and the new dark themes.
- Main changes since v0.13.0: window names and the command control, floating modules beside an
  IDE and a second IDE ([027](decisions/027-ide-as-a-whole.md)), Markdown preview links, local
  pictures and a README's HTML layout, VS Code-like dark themes and recent projects in Add to
  Workspace: IDE ([029](decisions/029-markdown-links-and-themes.md)).
- **Security check.** `npm audit` reports no vulnerabilities. `cargo audit` (1422 advisories, 565
  crates) reports none; its eight warnings are those of v0.13.0. No dependency changed since
  v0.13.0 (neither lock file).
  - **Unchanged:** the CSP and the network rules. The renderer gained only Tauri's
    `core:window:allow-set-title`. One new command, `project_recents`, reads the app's own
    `ide-recent.json` and returns the folders that still exist.
  - **Release workflow** (changed after the v0.13.0 check, in that tag): the workflow's default
    stays `contents: read`; only the new `draft` job may write, and it builds nothing, it only
    creates a draft from the uploaded packages and checks each expected file.
  - **What the review of the diff since v0.13.0 found.** It was read for new commands,
    permissions, process arguments, HTML sinks and paths. The README HTML of the preview never
    reaches the page as markup: a fixed tag list becomes React elements with validated
    attributes only (sizes are numbers, px or %, spans 2–1000), links are spans, not `<a>`, and
    pictures are blobs in `<img>`, where an SVG's scripts do not run. No link or picture of a
    local document can name another computer, so a README cannot make Windows send the user's
    NTLM hash to a share; the code already refused it, and a test now covers eleven spellings
    (`\\server`, `//server`, `file://server`, percent-encoded, `\\?\UNC\`…).
- **Found and fixed by that review** ([029](decisions/029-markdown-links-and-themes.md)):
  - In a Text Editor's preview, a link to a file that is not text opened it in its default
    application with one click. The program list keeps `.exe`, `.bat` and the like out, but not
    types that act on their own (`.rdp` connects to a server and asks for a password, `.iqy`
    fetches a web query, `.docm` macros, `.iso` mounts), and a link's text and `title` can hide
    its target. Such a link now only shows a notice; the File Manager still opens these files,
    by their real name. A Playwright test fails without the fix. Links are new in this release,
    so no released version had this. (The IDE's preview already opened them as file tabs.)
- **Not changed, for a later decision**, as in v0.13.0: the release workflow uses actions by tag,
  the installer is not code-signed, the CSP keeps `style-src 'unsafe-inline'`, and an `http://`
  SonarQube address sends the token unencrypted (the view warns). The File Manager's list of
  program types is a deny list: `.rdp`, `.iqy`, `.docm`, `.iso`-like types still open there in
  their default application after the user's double click, as in every release.
- **Checks run for this release:**
  - Rust: tests (126 passed, 1 ignored), Clippy with `-D warnings`, `cargo fmt --check`.
  - Front end: vitest (157), the full Playwright suite (130), the production offline test, the
    build and the format check.
  - Not done: the installer was not built, and nothing was run natively here. The steps in
    `docs/VALIDATION.md` after v0.11.0 and v0.12.0, for SonarQube and for Markdown links and
    pictures are still open.

## Platform checks still required

- Windows 10/11 WebView2: input/IME, clipboard, native picker/drop, Right Ctrl/AltGr reporting,
  crash recovery, independent windows and installer smoke.
- Hyprland and GNOME Wayland: the same checks, compositor modifier conflicts,
  GTK file dialogs and WebKitGTK rendering. No Linux session is available in this workspace.
- Measure startup, idle memory/CPU, resizing and large files on each target; no arbitrary
  performance acceptance threshold.
