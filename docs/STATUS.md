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
  preset project.
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
