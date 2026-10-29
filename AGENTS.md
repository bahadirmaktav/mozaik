# AGENTS.md

This file is the working agreement for coding agents contributing to Tessera. It applies to
the whole repository. Keep it tool-agnostic so it works with Codex, Claude, and other agents.

## Read before changing code

1. Read this file and inspect `git status` before editing. Preserve unrelated user changes.
2. Treat `.plans/TESSERA_V0.1_PLAN.md` as the V0.1 product specification,
   `.plans/Tessera_V0.2_Plan.md` as the V0.2 terminal module specification,
   `.plans/Tessera_v0.3_File_Manager_Plan.md` as the V0.3 File Manager specification,
   `.plans/Tessera_v0.4_Tasks_Plan.md` as the V0.4 Tasks specification,
   `.plans/Tessera_v0.5_Excalidraw_Plan.md` as the V0.5 Excalidraw specification,
   `.plans/Tessera_v0.6_Plan.md` as the V0.6 Mermaid, Notes and workspace key specification and
   `.plans/tessera-v0.7-plan.md` as the V0.7 IDE specification. V0.1
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

Tessera V0.7 is an offline, minimalist desktop workspace built with Tauri 2, Rust, React,
TypeScript, Vite, CodeMirror 6, xterm.js, portable-pty, Excalidraw, Mermaid and an LSP client.
It targets Windows and Linux Wayland.

These invariants must remain true:

- One OS window is one independent workspace. Every new window starts empty.
- Never restore a previous panel layout at startup. Crash recovery restores document content,
  not the workspace layout or original file automatically. The only reopening is explicit:
  the first Excalidraw (or Mermaid) opened in a session reopens the drawing (or diagram) files
  that were open before (see `docs/decisions/006-excalidraw.md` and `008-mermaid.md`).
- The trusted built-in plugins are Text Editor, Terminal, File Manager, Tasks, Excalidraw,
  Mermaid, Notes and the IDE panels (IDE Project, Code Editor, Problems, Changes).
  Keep plugin type, instance, document, session, and view concepts separate. Do not add a
  runtime plugin loader or speculative SDK.
- The application is offline: no accounts, cloud sync, telemetry, updater, remote assets,
  analytics, CDN resources, or implicit network requests.
- Shell execution exists only as user-driven interactive PTY sessions in the Terminal plugin.
  The only other processes are language servers Rust knows by name (clangd), found on `PATH`
  or chosen in a native dialog, started when a project file needs them and stopped with their
  panel or window, and the fixed read-only `git` commands of `git.rs`. The renderer never
  supplies a program or arguments. Do not add background command runners, shell integration,
  terminal path/Git indicators, session persistence, SSH management, custom drawing tools,
  PlantUML or other external renderers, CMake/build/run, debuggers, test runners, Git write
  operations, language server downloads, or other post-V0.7 modules.
- The IDE is panels in the normal workspace, never a second tab or split system (see
  `docs/decisions/010-ide.md`). Code documents share the text document store and its save,
  conflict and recovery rules. Server or search edits change open documents in their editors
  (unsaved) and write closed files only after confirmation with a revision check. Project
  settings live in the app config directory, never in the user's repository. The Text Editor
  stays the simple editor: no search UI, multiple cursors or language features there.
- The File Manager browses local folders in one Details view. It never deletes permanently
  without an explicit confirmed action, never overwrites without a Replace decision, never
  opens executables or scripts, and keeps recursive name/content search, previews, archives, remote
  file systems and OS drag-and-drop out of scope (see `docs/decisions/004-file-manager.md`).
- Tasks is one application-wide panel over flat lists with a permanent Inbox, three statuses,
  manual order, priorities and a Markdown description, stored in one local JSON file owned by
  Rust. Never delete a task or list without confirmation, never overwrite a damaged or newer
  `tasks.json`, and keep search, filters, due dates, reminders, tags, subtasks, Kanban, task
  context menus, sync and SQLite out of scope (see `docs/decisions/005-tasks.md`).
- Excalidraw is the unmodified Excalidraw editor in a panel, pinned to an exact version. Its
  toolbar, canvas, menus and shortcuts stay as they are; only file actions that would write
  outside Tessera's save path are replaced. Drawings are local `.excalidraw` files with one
  tab per file, autosave only once bound to a file, revision checks and atomic saves. No
  collaboration, online services, web embeds or remote fonts (see
  `docs/decisions/006-excalidraw.md`).
- Mermaid renders local `.mmd` files with a pinned, lazy-loaded Mermaid at `securityLevel:
"strict"` with SVG labels; file directives must not lower security. Diagrams follow the drawing
  file rules (Save As for new ones, autosave once bound, one tab per file, revision checks) and
  export SVG/PNG through a native dialog (see `docs/decisions/008-mermaid.md`).
- Notes is one application-wide panel of independent Markdown pages (no folders, categories,
  sub-notes, tags, search or sync) in one versioned `notes.json` owned by Rust, seeded once
  with QuickNotes. Never delete a note without confirmation and never overwrite a damaged or
  newer `notes.json` (see `docs/decisions/009-notes.md`).
- Do not expose broad filesystem, process, shell, or navigation permissions to the renderer.
  Native capabilities belong behind narrow, validated Rust commands and minimal Tauri
  permissions.
- Never describe configuration, a successful build, browser tests, or CI YAML as proof that a
  native platform works. Record only tests that were actually run in that environment.

## Architecture map

- `src/workspace/model.ts`: pure, deterministic, serializable binary split-tree state and
  actions. Keep layout math and validity rules independent from React, DOM, and Rust IPC.
- `src/workspace/WorkspaceView.tsx`: recursive workspace rendering, panel/tab interaction,
  pointer capture, drop previews, splitters, spatial focus, and maximize presentation.
- `src/plugins/contract/`: the small typed built-in plugin contract. Extend it only for a
  current, concrete plugin requirement.
- `src/plugins/text-editor/`: document/view state, lazy CodeMirror adapter, syntax selection,
  and large-document policy. Hidden views may unmount; document text, selection, and undo state
  must survive tab switches.
- `src/plugins/terminal/`: session store independent of views, lazy xterm.js runtime whose
  emulator node is re-parented across remounts, input serialization, output acknowledgements,
  and the default shell setting. Only an explicit tab close may end a session.
- `src/plugins/file-manager/`: per-panel store (location, history, sort, filter, selection)
  independent of views, pure sort/filter/history/selection model, virtualized Details view,
  menus, conflict dialogs and internal drag. Responses carry request tokens; keep stale
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
  across views, Tessera menu items, and the `browser-fs-access` replacement that sends
  Excalidraw's exports to a native save dialog. Never let Excalidraw write a drawing itself.
- `src/plugins/mermaid/`: diagram store on `boundFiles`, CodeMirror source with live preview
  split, serialized race-checked rendering and SVG/PNG export (`render.ts`).
- `src/plugins/notes/` and `src/services/notes.ts`: shared notes document, unsaved drafts and
  immediate selection, list/page view with handle drag and Edit/Preview.
- `src/workspace/shortcuts.ts`: the physical workspace key and the only combinations it takes.
- `src/plugins/ide/`: IDE panels. `projects.ts` (per-panel root, lazy tree, Git state, search),
  `editors.ts` (view registry, reveal and back/forward history, diagnostics, results, the App
  host), `lsp.ts` (servers per project root, a workspace that keeps files open while their
  document is open, navigation, confirmed multi-file edits, formatting, symbols), pure
  `model.ts` and `paths.ts`, and the lazy views. `src/services/ide.ts` is its typed adapter.
- `src/services/drawings.ts`: typed adapter for the native drawing commands; Excalidraw and
  Mermaid pass a `kind`.
- `src/services/native.ts`: typed renderer adapter for native files, saves, conflicts,
  watchers, and recovery commands. Preserve its per-document save serialization and stale
  async-result checks.
- `src-tauri/src/files.rs`: validated reads, UTF-8/BOM/line-ending fidelity, revision checks,
  cross-process Tessera locks, and safe replacement.
- `src-tauri/src/recovery.rs`: local crash snapshots and live-session exclusion. Recovery data
  is separate from user files and layout state.
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
- `src-tauri/src/notes.rs`: versioned `notes.json`, idempotent QuickNotes seed, validation,
  ordering and locked atomic saves.
- `src-tauri/src/project.rs`: project roots, `.gitignore`-aware file walk, line search and
  revision-checked replace, per-project settings. `src-tauri/src/git.rs`: fixed read-only Git
  commands. `src-tauri/src/lsp.rs`: window-owned language server processes with framed stdio.
- `src-tauri/src/drawings.rs`: per kind (Excalidraw, Mermaid) validated reads, saves only to
  dialog-chosen or window-registered paths, PNG/SVG/library export, image reads for drops, and
  the open-files lists (`drawings.json`, `diagrams.json`) reopened by the next session.
- `src-tauri/src/terminal.rs`: window-scoped PTY sessions, ordered UTF-8 output channel with
  backpressure, hang-up then kill shutdown, shell detection, and window/app-exit cleanup.
  Only detected shells may be started; never accept an arbitrary executable from the renderer.
- `src/styles/tokens.css`: visual tokens. Prefer tokens over scattered color/spacing literals.
- `tests/e2e/`: browser interaction coverage. It does not replace native WebView2/WebKitGTK
  testing.

Keep state ownership clear: transient workspace interaction lives in React, editor documents
live in the plugin runtime, and filesystem/recovery/PTY operations live in Rust. Do not introduce
Rust IPC into pointer-move, drag, split-resize, or other hot UI paths.

## Interaction and visual rules

- Preserve deterministic 50/50 initial splits, plugin minimum sizes, rejected invalid splits,
  empty-panel cleanup, ratios after resize, spatial focus, and maximize/restore semantics.
- Tab drags are always available. Whole-panel drag starts only while the workspace key is
  held, then continues under pointer capture even if the key is released.
- The workspace key is a physical key (`KeyboardEvent.code`): Right Ctrl by default, Left Ctrl
  and Left Alt as alternatives; Right Alt/AltGr is not offered. Only key+K (launcher) and
  key+arrows (focus) are taken, in the capture phase; every other combination stays with the
  focused module. Exclude AltGraph, clear held state on blur, hidden windows and missed
  keyups, and never add an F12 or mode toggle (see `docs/decisions/007-workspace-shortcuts.md`).
- The custom title bar is visually continuous with the canvas: canvas background, no lower
  divider, small Tessera mark, draggable open area, the centred command palette field and
  minimize/maximize/close controls. Workspace actions reach the title bar only as palette
  commands (`src/components/CommandPalette.tsx`); add no other title bar or toolbar buttons.
  The palette has no shortcut yet (see `docs/decisions/007-workspace-shortcuts.md`).
- Current shortcuts include Right Ctrl+K launcher, Right Ctrl+arrows focus, Ctrl+N tab,
  Ctrl+Shift+N auto split, Ctrl+O open, Ctrl+S save, Ctrl+Shift+S save as, Ctrl+W close,
  Ctrl+G go to line, Ctrl+, settings, and Ctrl+Alt+N new window. Inside a terminal Ctrl+N/O/S/W
  reach the shell and Ctrl+C copies only with a selection (see `docs/decisions/003-terminal.md`).
  A focused File Manager adds Ctrl+L path, F5 refresh, Backspace up, F2 rename, Delete Trash,
  Shift+Delete permanent delete and Ctrl+A/C/X/V; none of them act inside text fields. A
  focused Tasks row adds Delete (confirmed) and Ctrl+Up/Down reorder; Tasks adds no Ctrl+N.
  In a drawing, Excalidraw's own shortcuts apply only while it has focus; Ctrl+O/S/Shift+S
  open and save drawings through Tessera and Left Ctrl+K stays Excalidraw's link shortcut;
  Mermaid uses the same Ctrl+O/S/Shift+S. A focused Notes row adds Delete (confirmed) and
  Ctrl+Up/Down reorder. The Code Editor keeps CodeMirror's standard keys and the LSP client's
  F12, Shift+F12 and F2 inside the editor, without Ctrl+Alt bindings (AltGr); the IDE keymap is
  deliberately deferred, so IDE actions also live in menus. Check OS/WebView and shell conflicts
  before adding shortcuts.
- Keep the dark UI compact and token-based. Editor content must remain opaque. Respect reduced
  motion, keyboard focus visibility, dialog focus, and accessible names.

## Document and file safety

User data correctness has priority over convenience.

- Text documents are saved only by an explicit save action. Recovery checkpoints are not
  autosave. Excalidraw drawings and Mermaid diagrams bound to a file autosave (V0.5, V0.6); a new
  drawing or diagram is written only through Save As. Notes and Tasks save automatically to
  their own app data files.
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
npm.cmd run tauri build -- --bundles nsis
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

Make small, coherent commits at verified milestones. Use English Conventional Commit messages,
for example `feat: add ...`, `fix: prevent ...`, `test: cover ...`, `docs: clarify ...`, or
`style: align ...`. Do not include unrelated user changes or rewrite existing history unless the
user explicitly asks.

Before handing off:

- Run the checks appropriate to the changed layers and report their actual results.
- Run `git diff --check` and inspect `git status`.
- Update documentation when behavior, shortcuts, constraints, artifacts, or validation status
  changed.
- State any remaining native/platform checks plainly. Never mark Windows, Hyprland, GNOME
  Wayland, installer, clipboard, IME, drag/drop, file-dialog, or crash-recovery flows as verified
  without exercising those exact flows.
