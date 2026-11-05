# AGENTS.md

This file is the working agreement for coding agents contributing to Mozaik. It applies to
the whole repository. Keep it tool-agnostic so it works with Codex, Claude, and other agents.

## Read before changing code

1. Read this file and inspect `git status` before editing. Preserve unrelated user changes.
2. Treat `.plans/TESSERA_V0.1_PLAN.md` as the V0.1 product specification,
   `.plans/Tessera_V0.2_Plan.md` as the V0.2 terminal module specification,
   `.plans/Tessera_v0.3_File_Manager_Plan.md` as the V0.3 File Manager specification,
   `.plans/Tessera_v0.4_Tasks_Plan.md` as the V0.4 Tasks specification,
   `.plans/Tessera_v0.5_Excalidraw_Plan.md` as the V0.5 Excalidraw specification,
   `.plans/Tessera_v0.6_Plan.md` as the V0.6 Mermaid, Notes and workspace key specification,
   `.plans/tessera-v0.7-plan.md` as the V0.7 IDE specification,
   `.plans/tessera-v0.8-plan.md` as the V0.8 debugging specification and
   `.plans/Mozaik_Code_Quality_Integration_Plan.md` as the code analysis (clang-tidy,
   SonarLint) specification. V0.1
   `[KESİN]` decisions are requirements; `[ÖNERİ]` items may change with a documented reason;
   resolve `[TBD]` items with the smallest testable decision that protects user data and scope.
3. Read the relevant files in `docs/decisions/` before changing architecture, interaction,
   editor, persistence, or recovery behavior.
4. Use `docs/STATUS.md` and `docs/VALIDATION.md` to distinguish implemented behavior from
   behavior that has actually been verified on a native platform.

The plan predates the implementation. It remains the specification, while the code and
decision records describe the current implementation. If they conflict, preserve explicit
product requirements and either fix the implementation or document a deliberate product
decision. Do not silently reinterpret the plan.

## Product boundaries

Mozaik V0.8 is an offline, minimalist desktop workspace built with Tauri 2, Rust, React,
TypeScript, Vite, CodeMirror 6, xterm.js, portable-pty, Excalidraw, Mermaid, an LSP client,
CMake and a DAP client.
It targets Windows and Linux Wayland.

These invariants must remain true:

- One OS window is one independent workspace. Every new window starts empty, except a window
  the user opens with the File Manager's **Open in IDE (New Window)** or `mozaik -ide <path>`,
  which starts with an IDE on that folder, and a window the user reloads with **Developer:
  Reload Window**, which reopens its IDE folder (`docs/decisions/004-file-manager.md`, `022`).
- Never restore a previous panel layout at startup. Crash recovery restores document content,
  not the workspace layout or original file automatically. The only reopening is explicit:
  the first Excalidraw (or Mermaid) opened in a session reopens the drawing (or diagram) files
  that were open before (see `docs/decisions/006-excalidraw.md` and `008-mermaid.md`), and a
  layout template the user opens from the palette, which lays out fresh modules only
  (`docs/decisions/018-layout-templates.md`).
- The trusted built-in plugins are Text Editor, Terminal, File Manager, Tasks, Excalidraw,
  Mermaid, Notes and the IDE. The IDE is one launcher entry whose panels (project sidebar,
  Code Editor, bottom panel with Problems/Output/Debug Console/Terminal/Run, status bar,
  Changes) open together or
  from it; only the sidebar is `listed`.
  Keep plugin type, instance, document, session, and view concepts separate. Do not add a
  runtime plugin loader or speculative SDK.
- The application is offline: no accounts, cloud sync, telemetry, updater, remote assets,
  analytics, CDN resources, or implicit network requests.
- Shell execution exists only as user-driven interactive PTY sessions in the Terminal plugin
  and the IDE bottom panel's Terminal view (the same sessions, started in the project folder
  the first time that view is shown).
  The only other processes are language servers Rust knows by name (clangd), found on `PATH`
  or chosen in a native dialog, started when a project file needs them and stopped with their
  panel or window, the fixed `git` commands of `git.rs` (read-only ones, plus stage, unstage
  and discard of files the user picks in Source Control), and CMake (`cmake/`, see
  `docs/decisions/011-cmake.md`): the user-started configure/build/clean steps, the kit
  scan's fixed queries (`vswhere`, `<compiler> --version`, `vcvarsall.bat <arch> && set`) and
  a built executable target run in the bottom panel, and CTest (`cmake/ctest.rs`, see
  `docs/decisions/013-testing.md`): listing and running the build folder's tests from the
  IDE's Testing view. Rust builds every command line from the
  user's choices; the renderer supplies only names Rust checks (kit, preset, variant, target)
  and a run target's or test's arguments and test names, never a program. Nothing CMake runs on
  its own: no automatic configure or build, and tests are only listed when the Testing
  view is shown (Debug and test runs build their target first because the user asked). The
  debug adapters (`debug.rs`, see `docs/decisions/012-debugging.md`) are GDB's DAP
  interpreter and lldb-dap, found or chosen in a native dialog, one session in the whole
  application; Rust builds their launch request and passes on only the DAP requests the UI
  needs (no `launch`/`attach` from the renderer, no `repl` evaluation, no `runInTerminal`).
  Coverage (`coverage.rs`, see `docs/decisions/015-coverage.md`) only reads an LCOV or
  Cobertura report the user chose in a native dialog; Mozaik runs no coverage tool (a CMake
  target the user builds writes the report). clang-tidy (`analysis.rs`, see
  `docs/decisions/017-code-analysis.md`), found on `PATH` or chosen in a native dialog, runs
  on one file or the files of the active build folder's `compile_commands.json` when the user
  asks (or, if chosen in settings, on a C/C++ file just saved), a few at a time and
  cancellable; clangd gets `--clang-tidy` for the live checks. SonarLint is not shipped (its
  feasibility gate was not passed). A PowerShell terminal may run the one prompt file the
  user chose in Workspace Settings, after their profile (`docs/decisions/020-powershell-prompt.md`);
  Mozaik ships no prompt itself. Do not add background command runners, shell integration,
  terminal path/Git indicators, session persistence, SSH management, custom drawing tools,
  PlantUML or other external renderers, MSVC debugging, attach-to-process, remote or container
  debugging, several debug sessions, debugger downloads, test frameworks other than CTest's tests,
  coverage collection or merging, remote or container builds, other Git write operations (commit, push, branches), language server
  downloads, or other post-V0.8 modules.
- The IDE is panels in the normal workspace, never a second tab or split system (see
  `docs/decisions/010-ide.md`). Its built-in features can be turned off in Settings → IDE →
  Features (`features.ts`, `docs/decisions/024-ide-features.md`); they stay trusted code, not
  loaded plugins. Sidebar, bottom panel and status bar are docked tools: alone
  in their panel, with their own bar instead of a tab strip, no close or maximize, and
  minimized to that bar (the sidebar to its activity bar). Sidebar and bottom panel switch views
  (Explorer/Search/Source Control/Run and Debug/Testing/Coverage/TODOs, Problems/Output/Debug Console/Terminal/Run);
  sidebar views stack folding, resizable sections whose state survives switching views; files
  are never inner tabs. The bottom
  panel sits under the code editors, not under the sidebar; the status bar under the whole IDE.
  Source Control groups Staged Changes and Changes; it stages, unstages and discards (confirmed,
  untracked files to the Trash) but never commits. Changes, search results and a coverage report's files
  (read only) open as tabs among the code editors; a working tree comparison edits the file's document (its code tab opens
  behind it) and reverts single changes. While an IDE is open its code editor area stays (an
  empty area without a tab replaces the last closed tab; a double click on its tab bar adds a
  new file); closing the last IDE closes its code editors and
  comparisons too. IDE messages go to Output → IDE and the status bar, not workspace notices.
  Code documents share the text document store and its save,
  conflict and recovery rules. Server or search edits change open documents in their editors
  (unsaved) and write closed files only after confirmation with a revision check. Project
  settings live in the app config directory, never in the user's repository; the one
  exception is the optional, shareable `.mozaik/debug.json` (a target's args, cwd and env,
  written only by the user's Save in the debug configuration dialog). Breakpoints, watches
  and debugger choices stay in app data. The Text Editor
  stays the simple editor (word wrap and its own status bar, see
  `docs/decisions/002-editor-and-data.md`): it shares the Code Editor's editing shortcuts and
  Find / Replace (`docs/decisions/016-tabs-and-editors.md`) and may show a folder at the left
  of its panel (a plain tree that opens files, as in Sublime Text), but no language features,
  Git or file operations there.
- The File Manager browses local folders in one Details view. It never deletes permanently
  without an explicit confirmed action, never overwrites without a Replace decision, never
  runs executables or scripts (it opens text files as Text Editor tabs, other files in their
  default application), searches names (not contents) in the shown folder and its subfolders
  from its search box, lists drives on its This PC page, and keeps content search, previews,
  archives, remote
  file systems and OS drag-and-drop out of scope (see `docs/decisions/004-file-manager.md`).
- Tasks is one application-wide panel over flat lists with a permanent Inbox, three statuses,
  manual order, priorities and a Markdown description, stored in one local JSON file owned by
  Rust. Never delete a task or list without confirmation, never overwrite a damaged or newer
  `tasks.json`, and keep search, filters, due dates, reminders, tags, subtasks, Kanban, task
  context menus, sync and SQLite out of scope (see `docs/decisions/005-tasks.md`).
- Excalidraw is the unmodified Excalidraw editor in a panel, pinned to an exact version. Its
  toolbar, canvas, menus and shortcuts stay as they are; only file actions that would write
  outside Mozaik's save path are replaced. Drawings are local `.excalidraw` files with one
  tab per file, autosave only once bound to a file, revision checks and atomic saves. No
  collaboration, online services, web embeds or remote fonts (see
  `docs/decisions/006-excalidraw.md`).
- Mermaid renders local `.mmd` files with a pinned, lazy-loaded Mermaid at `securityLevel:
"strict"` with SVG labels; file directives must not lower security. Diagrams follow the drawing
  file rules (Save As for new ones, autosave once bound, one tab per file, revision checks) and
  export SVG/PNG through a native dialog (see `docs/decisions/008-mermaid.md`).
- Notes is one application-wide panel over a notes folder chosen in Workspace Settings:
  each note is a `.md` file named by its title and each group a subfolder (hidden entries
  skipped; no tags, search, links or sync). Rust resolves every path inside that folder, saves with revision checks and atomic replaces, never replaces an existing
  name, and only moves notes or groups to the Trash after confirmation. A note changed on disk
  while it has unsaved text waits for Reload or Overwrite (see `docs/decisions/009-notes.md`).
- Do not expose broad filesystem, process, shell, or navigation permissions to the renderer.
  Native capabilities belong behind narrow, validated Rust commands and minimal Tauri
  permissions.
- Never describe configuration, a successful build, browser tests, or CI YAML as proof that a
  native platform works. Record only tests that were actually run in that environment.

## Architecture map

- `src/workspace/model.ts`: pure, deterministic, serializable binary split-tree state (a
  split marked `group` divides a Text Editor into editor groups), the floating panels over
  it, and actions. Keep layout math and validity rules independent from React, DOM, and Rust IPC.
- `src/workspace/templates.ts`, `src/services/layouts.ts` and `src-tauri/src/layouts.rs`:
  layout templates (modules and their places, no content) in `layouts.json`.
- `src/workspace/WorkspaceView.tsx`: recursive workspace rendering, panel/tab interaction,
  pointer capture, drop previews, splitters, spatial focus, and maximize presentation.
- `src/plugins/contract/`: the small typed built-in plugin contract. Extend it only for a
  current, concrete plugin requirement.
- `src/plugins/text-editor/`: document/view state, lazy CodeMirror adapter, syntax selection,
  large-document policy, and the per-panel folder sidebar (`folders.ts`, `FolderSidebar.tsx`). Hidden views may unmount; document text, selection, and undo state
  must survive tab switches. `places.ts` keeps where a file was left (cursor and scroll) in the
  window's memory, for the Text and Code Editors.
- `src/plugins/terminal/`: session store independent of views, lazy xterm.js runtime whose
  emulator node is re-parented across remounts, input serialization, output acknowledgements,
  and the default shell setting. Only an explicit tab close may end a session.
- `src/plugins/file-manager/`: per-panel store (location, history, sort, filter, selection)
  independent of views, pure sort/filter/history/selection model, virtualized Details view,
  menus, conflict dialogs, internal drag and the window's Undo/Redo history of file
  operations (`history.ts`). Responses carry request tokens; keep stale
  listings from overriding newer navigation.
- `src/services/filesystem.ts` and `src/services/pins.ts`: typed adapters for the native
  File Manager commands and the shared pin registry. They must not depend on a panel.
- `src/plugins/tasks/`: shared tasks document, per-view screen/collapse state and unsaved
  drafts, pure grouping, list/detail view with handle drag. Show saved state only; a draft
  stays until the exact text was saved.
- `src/services/tasks.ts`: typed adapter for the native tasks commands.
- `src/components/Menu.tsx`: shared popup menu. `src/components/Markdown.tsx` with
  `parseMarkdown.ts`: the safe Markdown preview shared by Tasks and Notes.
- `src/plugins/shared/`: `boundFiles.ts`, the store factory for files that autosave once bound
  (identity, path, dirty/saving/conflict state, queued saves, session reopen), used by
  Excalidraw and Mermaid; `order.ts`, order anchors for manual reordering.
- `src/plugins/excalidraw/`: drawing store (identity, path, serialized scene, dirty/saving/
  conflict state, queued autosave, session reopen), one React root per drawing re-parented
  across views, Mozaik menu items, and the `browser-fs-access` replacement that sends
  Excalidraw's exports to a native save dialog. Never let Excalidraw write a drawing itself.
- `src/plugins/mermaid/`: diagram store on `boundFiles`, CodeMirror source with live preview
  split, serialized race-checked rendering and SVG/PNG export (`render.ts`).
- `src/plugins/notes/` and `src/services/notes.ts`: the notes folder listing, note texts read
  on demand, unsaved drafts with conflict state, folder watches, and the group tree/page view with
  Edit/Preview.
- `src/workspace/shortcuts.ts`: the physical workspace key and the only combinations it takes.
  `src/workspace/keybindings.ts`: the registry of every Mozaik shortcut and the user's changes
  (`matches`), edited in `ShortcutSettings.tsx`; `src/services/preferences.ts` and
  `src-tauri/src/preferences.rs` keep them, the window opacity, the fonts (`fonts.ts`: the
  General font and one per module, see `docs/decisions/019-fonts.md`), the PowerShell prompt
  file and the start folders of new terminals and File Managers (empty is home) for all
  windows. `examples/powershell/` holds an example prompt file.
  `src/workspace/Settings.tsx`: Workspace Settings, a search over tabs (General, then one per
  module: Text Editor, IDE, Terminal, File Manager, Tasks and Notes) with folding sections;
  each module's shortcuts are in its tab. Changes are a draft until Save; Reset to Default
  resets the shown settings. Programs chosen in a native dialog apply at once.
- `src/plugins/ide/`: IDE panels. `projects.ts` (per-panel root, lazy tree, Git state, search),
  `panels.ts` (a project's bottom panel: its view, output channel and terminals, created
  lazily; its status bars), `quick.ts` (the palette's file and symbol modes), `diffs.ts` and
  `Diff.tsx` (staged or working tree comparisons), `syntax.ts` (highlighting by file name; `cmakeLanguage.ts` for CMake with completion),
  `editors.ts` (view registry, reveal and back/forward history, diagnostics, results, the App
  host), `lsp.ts` (servers per project root, a workspace that keeps files open while their
  document is open, navigation, confirmed multi-file edits, formatting, symbols), pure
  `model.ts` and `paths.ts`, and the lazy views. `src/services/ide.ts` is its typed adapter.
  `cmake.ts` (per-project CMake state, pick lists, configure/build/run actions), `channels.ts`
  and `Output.tsx` (output channels IDE and CMake), pure `buildOutput.ts` (compiler/CMake problems,
  bounded lines) and `IdeSettings.tsx`; `src/services/cmake.ts` is the CMake adapter.
  Debugging: `debug.ts` (the one session, DAP client, breakpoints and watches per project),
  pure `debugModel.ts`, `debugEditor.ts` (breakpoint gutter, paused line, Debug Hover),
  `RunAndDebug.tsx`, `DebugValues.tsx` and `DebugConsole.tsx` (console and floating
  toolbar); `src/services/debug.ts` is its adapter. Testing: `testing.ts` (per-project
  tests and results), pure `testModel.ts` (grouping, CTest output) and `TestingView.tsx`. Coverage:
  `coverage.ts` (per-project report, reload on change, stale files, coverage tabs), pure
  `coverageModel.ts` (LCOV and Cobertura, totals, folder tree), `CoverageView.tsx` and the
  read-only `CoverageFile.tsx` tab; `src/services/coverage.ts` is its adapter. Analysis:
  `analysis.ts` (clang-tidy runs per project, stale findings, fix previews), pure
  `analysisModel.ts` (providers, grouping, Problems filter, combined fixes, preview hunks),
  `Problems.tsx` and `FixPreview.tsx`; `src/services/analysis.ts` is its adapter.
- `src/services/drawings.ts`: typed adapter for the native drawing commands; Excalidraw and
  Mermaid pass a `kind`.
- `src/services/windows.ts`: new windows (`new_workspace` in `lib.rs`, optionally with a
  folder for its IDE) and the folder a window was opened for (`take_window_start`, once).
- `src/services/native.ts`: typed renderer adapter for native files, saves, conflicts,
  watchers, and recovery commands. Preserve its per-document save serialization and stale
  async-result checks.
- `src-tauri/src/files.rs`: validated reads, UTF-8/BOM/line-ending fidelity, revision checks,
  cross-process Mozaik locks, and safe replacement.
- `src-tauri/src/recovery.rs`: local crash snapshots and live-session exclusion. Recovery data
  is separate from user files and layout state.
- `src-tauri/src/coverage.rs`: the coverage report chosen per project in a native dialog
  (path in app data `coverage.json`), read with a size limit, and source file times.
- `src-tauri/src/rename.rs`: copies the data of the former name (Tessera) once at start
  (see `docs/decisions/014-mozaik.md`).
- `src-tauri/src/watching.rs`: reference-counted directory watches and disk-change events.
  Documents and File Manager views share it; events carry the changed paths.
- `src-tauri/src/directory.rs`: lexical path resolution, non-recursive listings, name
  validation, protected paths, no-replace rename, create/rename and default-app opening.
- `src-tauri/src/operations.rs`: conflict planning and staged copy/move, Trash without
  permanent fallback, confirmed permanent delete and cancellation.
- `src-tauri/src/pins.rs`: app-wide pinned items with locking and missing-target state.
- `src-tauri/src/tasks.rs`: versioned `tasks.json`, domain validation, load repair, locked
  read-modify-write with atomic save. `src-tauri/src/panels.rs`: the per-process owner of
  single-panel plugins (Tasks, Notes).
- `src-tauri/src/notes.rs`: the notes folder (`notesFolder` preference): scan, path
  resolution inside it, revision-checked note saves, no-replace create/rename/move and Trash.
- `src-tauri/src/project.rs`: project roots, `.gitignore`-aware file walk, line search and
  revision-checked replace, per-project settings (including CMake choices).
  `src-tauri/src/cmake/`: kits, presets, File API targets, configure/build jobs with
  cancellable process trees, run targets, CTest (`ctest.rs`) and clangd's compilation
  database.
  `src-tauri/src/debug.rs`: debug adapter detection (compiler from CMake's record), the
  allowlisted DAP bridge on `lsp.rs`'s processes, launch requests, `.mozaik/debug.json`
  and per-project `debug-state.json` in app data.
  `src-tauri/src/git.rs`: fixed Git commands (status, committed and staged text, stage,
  unstage, discard with literal pathspecs). `src-tauri/src/lsp.rs`: window-owned language server processes with framed stdio.
  `src-tauri/src/analysis.rs`: clang-tidy detection and settings (`analysis.json`), runs on
  `cmake::jobs` with `--export-fixes` read by a small LLVM-YAML reader, text fallback,
  protocol positions and SHA-256 checks before fixes apply.
- `src-tauri/src/drawings.rs`: per kind (Excalidraw, Mermaid) validated reads, saves only to
  dialog-chosen or window-registered paths, PNG/SVG/library export, image reads for drops, and
  the open-files lists (`drawings.json`, `diagrams.json`) reopened by the next session.
- `src-tauri/src/terminal.rs`: window-scoped PTY sessions, ordered UTF-8 output channel with
  backpressure, hang-up then kill shutdown, shell detection, and window/app-exit cleanup.
  Only detected shells may be started; never accept an arbitrary executable from the renderer.
  The Windows installer ships Microsoft's ConPTY beside `mozaik.exe` (`scripts/conpty.mjs`,
  `docs/decisions/023-conpty.md`).
- `src/styles/tokens.css`: visual tokens. Prefer tokens over scattered color/spacing literals.
  `src/workspace/themes.ts`: the color themes that replace them (`docs/decisions/021-themes-and-zoom.md`).
- `tests/e2e/`: browser interaction coverage. It does not replace native WebView2/WebKitGTK
  testing.

Keep state ownership clear: transient workspace interaction lives in React, editor documents
live in the plugin runtime, and filesystem/recovery/PTY operations live in Rust. Do not introduce
Rust IPC into pointer-move, drag, split-resize, or other hot UI paths.

## Interaction and visual rules

- Preserve deterministic 50/50 initial splits, plugin minimum sizes, rejected invalid splits,
  empty-panel cleanup, ratios after resize, spatial focus, and maximize/restore semantics.
  A plugin's `dock` makes a docked tool: it never shares a panel and collapses to a fixed bar
  size along its split; `fixed` keeps it there.
- Tab drags are always available. A tab closes with the middle button; its right-click menu
  has Close, Close Others, Close All, Split Right and Split Down (split moves the tab; an
  editor alone opens a new empty one; a Text Editor splits into editor groups inside its
  panel, as in Sublime Text, divided by a line, closed and maximized together, and never
  holding other modules), and a Text Editor panel adds tabs from its `+` menu (New File, Open File) or a
  double click on its tab strip; with no tab left it stays a page to write on, which an
  Untitled tab replaces once typed in, and only Close Panel removes it (see
  `docs/decisions/016-tabs-and-editors.md`). Whole-panel drag starts only while Ctrl+Shift is held,
  then continues under pointer capture even if the keys are released.
- Floating panels (`Workspace.floating`) lie over the split tree: opened with
  Ctrl+Shift+Enter in the launcher or on a palette Add command (Enter splits, Ctrl+Enter adds
  a tab), moved by their header without a modifier, resized at their edges, docked back with
  their button or Dock Panel. Tabs dropped on them join them; docked tools never float.
- The workspace key is a physical key (`KeyboardEvent.code`): Right Ctrl by default, Left Ctrl
  and Left Alt as alternatives; Right Alt/AltGr is not offered. Only key+arrows (focus) are
  taken, in the capture phase; every other combination stays with the focused module.
  Exclude AltGraph, clear held state on blur, hidden windows and missed keyups, and never add
  an F12 or mode toggle (see `docs/decisions/007-workspace-shortcuts.md`). The launcher
  (Ctrl+Shift+', VS Code's oem_7 key position: `'` on US, i on Turkish Q), Workspace
  Settings (Ctrl+Shift+,, the comma key), Close Panel (Ctrl+Shift+C; a part of an
  IDE closes the whole IDE after asking), Close Window (Ctrl+Shift+E) and Minimize Window
  (Ctrl+Shift+M) are ordinary shortcuts and palette commands.
- There is no title bar: a thin canvas strip above the panels moves the window and
  double-click maximizes it; there are no window buttons (Ctrl+Shift+E closes, Ctrl+Shift+M
  minimizes) and the Mozaik mark sits at the left of the status line, which shows only the
  mark and the clock (a tool's own state is in its own bar). Add no title
  bar or toolbar buttons. Workspace actions are commands of the command palette
  (`src/components/CommandPalette.tsx`), opened only by its shortcut: Ctrl+Shift+P (`>`
  commands), Ctrl+P (files of the IDE project) and Ctrl+Shift+O (`@` symbols of the code
  file), as in VS Code. The palette lists the workspace actions, `Add to Workspace: <tool>`
  for every launcher entry, and the commands of the modules in the workspace: a view
  registers its menu actions with `useCommands` (`src/workspace/commands.ts`). Commands list
  the five run last first (remembered in the WebView's local storage), then the rest by match
  and alphabetically, as in VS Code. In a drawing
  Ctrl+Shift+P, Ctrl+Shift+, and Ctrl+Shift+E stay Excalidraw's; in a terminal Ctrl+Shift+C
  copies a selection and otherwise closes the panel (see `docs/decisions/007-workspace-shortcuts.md`).
- Every shortcut Mozaik defines lives in `keybindings.ts` and is rebindable in Workspace
  Settings; handlers call `matches(event, id)` instead of testing keys. Workspace-key
  shortcuts are written `Mod+…`. Fixed entries (mouse, terminal copy/paste) are listed only.
  With Shift a punctuation key is named unshifted, by its position on the user's layout; a
  key in brackets (`[Quote]`) is a physical position. Default shortcuts include Ctrl+Shift+'
  launcher, Right Ctrl+arrows focus, Ctrl+Shift+C
  close panel, Ctrl+Shift+E close window, Ctrl+Shift+M minimize window, Ctrl+N tab,
  Ctrl+Shift+N auto split, Ctrl+O open, Ctrl+S save, Ctrl+Shift+S save as, Ctrl+W close,
  Ctrl+G go to line, Ctrl+Shift+, settings, Ctrl+Shift+P palette, Ctrl+P go to file,
  Ctrl+Shift+O go to symbol, Ctrl+Alt+N new window and Ctrl+Shift++/- IDE zoom. Inside a terminal Ctrl+N/O/S/W/P
  reach the shell and Ctrl+C copies only with a selection (see `docs/decisions/003-terminal.md`).
  A focused File Manager adds Ctrl+L path, F5 refresh, Backspace up, F2 rename, Delete Trash,
  Shift+Delete permanent delete, Ctrl+A/C/X/V and Ctrl+Z/Ctrl+Y (undo/redo of file operations,
  one history shared with the IDE Explorer, `docs/decisions/025-file-undo.md`); none of them
  act inside text fields. A
  focused Tasks row adds Delete (confirmed) and Ctrl+Up/Down reorder; Tasks adds no Ctrl+N.
  In a drawing, Excalidraw's own shortcuts apply only while it has focus; Ctrl+O/S/Shift+S
  open and save drawings through Mozaik and Left Ctrl+K stays Excalidraw's link shortcut;
  Mermaid uses the same Ctrl+O/S/Shift+S. A focused Notes row adds Delete (Trash, confirmed) and
  F2 (rename); a note's editor has the Text Editor's editing shortcuts and Find / Replace. The Code Editor keeps CodeMirror's standard keys without its Ctrl+Alt
  bindings (AltGr) and adds F12, Shift+F12, F2, Ctrl+L (expand line selection),
  Ctrl+Alt+Up/Down (add cursor; arrows type nothing under AltGr), Ctrl+D (add next match),
  Alt+Left/Right (back/forward), Alt+O (switch header/source), the chords Ctrl+K Ctrl+C and
  Ctrl+K Ctrl+U (add/remove line comment; the key after Ctrl+K is never typed), Ctrl+click
  (definition) and Alt+click (add cursor); IDE actions also live in menus. Ctrl+` toggles the IDE terminal
  (read by key position). CMake
  and Debug actions are palette commands and status bar, view or toolbar buttons without
  default shortcuts (the V0.8 plan designs none); breakpoints are set in the code gutter. Check
  OS/WebView and shell conflicts before adding shortcuts. No WebView context menu appears
  where a tool defines none.
- Keep the dark UI compact and token-based. Editor content stays opaque by default; only the
  user's window opacity setting fades the whole window (dialogs stay opaque). Respect reduced
  motion, keyboard focus visibility, dialog focus, and accessible names.

## Document and file safety

User data correctness has priority over convenience.

- Text documents are saved only by an explicit save action. Recovery checkpoints are not
  autosave. Excalidraw drawings and Mermaid diagrams bound to a file autosave (V0.5, V0.6); a new
  drawing or diagram is written only through Save As. Tasks saves automatically to its app data
  file; a Notes note saves automatically to its own Markdown file in the notes folder.
- Keep the exact text that completed a save so typing during a native dialog/save remains dirty.
- Never silently overwrite a stale, externally changed, deleted, or already-open destination.
- Preserve UTF-8 with or without BOM and LF/CRLF. Reject binary data, invalid UTF-8, mixed line
  endings, and CR-only files with a clear error instead of rewriting them.
- Save through a same-directory temporary file, sync it, preserve supported permission bits,
  and atomically replace the destination. Keep revision checks and cooperating-writer locks.
- Clean documents may reload after an external change. Dirty documents retain local edits and
  require an explicit conflict decision.
- Keep recovery snapshots local, validate recovery identifiers, exclude live sessions, wait for
  pending writes during clean close, and never delete corrupt snapshots silently.
- Large-document thresholds must be based on measurements. Do not claim native performance from
  a Node parser benchmark or browser run.

## Development workflow

Use the repository's existing libraries and patterns before adding dependencies. Avoid broad
refactors unless the requested behavior needs them. When a product or architectural choice is
not obvious, record the reason briefly in `docs/decisions/` and update `docs/STATUS.md` or
`docs/VALIDATION.md` when verification status changes.

On Windows PowerShell, use `npm.cmd`/`npx.cmd` if script execution policy blocks the `.ps1`
wrappers. Useful commands:

```text
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:production
npm.cmd run format:check
npm.cmd run benchmark:editor
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm.cmd run tauri dev
npm.cmd run package:windows
```

Choose checks in proportion to the change:

- Pure workspace/service logic: targeted tests, then `npm.cmd test` and `npm.cmd run build`.
- UI or keyboard/pointer behavior: build plus the relevant Playwright scenario; run the full
  E2E suite for shared interaction changes.
- Rust/native behavior or permissions: `cargo fmt`, tests, Clippy, and a Tauri build when config
  or capabilities change.
- Offline/bundling changes: production offline test.
- Packaging is required for release/package work, not for every CSS or documentation change.

Do not add tests that merely mirror implementation details. Add or update tests for layout
invariants, race/data-loss risks, and user-observable interactions. Keep generated output out of
Git: `node_modules`, `dist`, `src-tauri/target`, generated schemas, Playwright reports, and test
artifacts are ignored intentionally.

## Commits and handoff

Make small, coherent commits at verified milestones, without waiting to be asked. Use English
Conventional Commit messages, for example `feat: add ...`, `fix: prevent ...`, `test: cover ...`,
`docs: clarify ...`, or `style: align ...`. Do not add `Co-Authored-By` or any other attribution
trailer. Do not include unrelated user changes or rewrite existing history unless the user
explicitly asks.

Before handing off:

- Run the checks appropriate to the changed layers and report their actual results.
- Run `git diff --check` and inspect `git status`.
- Update documentation when behavior, shortcuts, constraints, artifacts, or validation status
  changed.
- State any remaining native/platform checks plainly. Never mark Windows, Hyprland, GNOME
  Wayland, installer, clipboard, IME, drag/drop, file-dialog, or crash-recovery flows as verified
  without exercising those exact flows.
