# Tessera

Offline desktop workspace for Windows and Linux. Tauri 2 + Rust + React + TypeScript + Vite.
One window is one independent workspace; every launch starts empty.

## Development

Install Node.js 22.12+ and stable Rust. Windows also requires MSVC C++ build tools,
the Windows SDK and WebView2. Linux requires WebKitGTK 4.1 and GTK 3 development
packages (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
npm ci
npm run tauri dev
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:e2e
npm run test:production
# Windows installer (requires preinstalled WebView2 on the destination)
npm run tauri build -- --bundles nsis
# Linux packaging candidates, to run on Linux
# npm run tauri build -- --bundles deb,appimage
```

On PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.
`npm run dev` runs the UI in a browser; native file/window services require Tauri.
Production assets are bundled locally. No cloud, telemetry, updater or remote plugins. Shells run only in Terminal tabs you open.

## Using the workspace

Open the launcher with **Right Ctrl+K**, search for a tool, and press **Enter** to add it as
an automatic split or **Ctrl+Enter** to add it as a tab. **Ctrl+N** adds a Text Editor tab;
**Ctrl+Shift+N** adds an automatic split.
Drag tabs to merge, reorder or split. Hold **Right Ctrl** and drag the panel grip to move a
whole panel: drop at another panel's center to swap, or at an edge to split. Right
Ctrl+arrows moves focus spatially. Only Right Ctrl+K and Right Ctrl+arrows belong to the
workspace; every other key, including Left Ctrl+K, stays with the focused tool. Settings
(**Ctrl+,**) offers Left Ctrl or Left Alt instead, for keyboards without a Right Ctrl.
Right Alt (AltGr) is not offered because it types characters on many layouts.

Use **Ctrl+O**, **Ctrl+S**, **Ctrl+Shift+S**, **Ctrl+W**, **Ctrl+G** to open, save, save as,
close and go to line. Undo/redo and Tab indentation are available. Text/regex search,
multiple cursors, external plugins and layout restoration are out of scope.
Use **Ctrl+,** to open settings and **Ctrl+Alt+N** to create a new independent window.
The compact custom title bar contains only the Tessera mark and window controls.

Add a **Terminal** from the launcher to run your default shell (chosen in Settings) in an
interactive PTY that starts in your home directory. Several terminals run independently; moving
a terminal tab keeps its shell running, and closing the tab ends it. Ctrl+C copies a selection
and otherwise interrupts; Ctrl+Shift+C/V copy and paste (Ctrl+V also pastes on Windows).
While a terminal has focus, Ctrl+N/O/S/W go to the shell.

Add a **File Manager** to browse local folders in a Details view (Name, Size, Modified). It
opens in your home folder; folders open in place and files open in their default application
(programs and scripts are not launched). Use the breadcrumb or **Ctrl+L** to type a path,
**Backspace** for the parent folder and the filter box to narrow the current folder. Right-click
for Open, Cut, Copy, Paste, Rename, Pin/Unpin and Delete; the ⋯ menu adds New file, New folder,
Show hidden files and Delete permanently. Delete moves items to the Trash/Recycle Bin;
**Shift+Delete** deletes permanently after confirmation. Name collisions ask Replace, Keep Both
or Skip. Drag items onto a folder to move them. Pinned items are shared by all File Managers.
Every new File Manager starts in home: like other panels, it is not restored after a restart.

Add **Tasks** for a small personal task list. There is one Tasks panel per application; opening
it again focuses the existing one. The list picker switches between All Lists, the permanent
Inbox and your own lists, and offers New List and Manage Lists (rename, delete; a deleted
list's tasks move to the Inbox). Tasks are grouped into Todo, In Progress and Done; use
**+ Add Task** and **Enter** to add one at the end of a section (**Escape** cancels). Drag the
handle to reorder or change status, or use **Ctrl+Up/Down** on a focused task. Click a task to
edit its title, list, status, priority (Medium by default) and Markdown description, with
explicit Edit and Preview. **Delete** on a focused task and the Delete button ask first. Every
change is saved automatically to a local `tasks.json`; the selected list survives a restart.

Add **Excalidraw** to draw with the original Excalidraw editor (pinned 0.18.1), fully offline.
A new drawing opens as `Untitled` (`Untitled 2`, …) without a dialog. **Ctrl+S** asks where to
save it as a `.excalidraw` file; after that every change is saved automatically. **Ctrl+Shift+S**
saves to another file and **Ctrl+O** (or Open… in Excalidraw's menu) opens a drawing. A file is
open in only one tab: opening it again, also from the File Manager or by dropping it on the
window, focuses that tab. Images can be inserted, pasted or dropped onto a drawing and are
stored inside the file. Excalidraw's export dialog saves PNG and SVG through a native dialog
without touching the drawing. Excalidraw's own shortcuts work only while the drawing has focus;
Left Ctrl+K there edits a link. The first Excalidraw you open after a restart reopens the drawings
that were open before; the window itself still starts empty. Unsaved drawings are offered in
the recovery bar after a crash, and closing one asks Save, Discard or Cancel.

Add **Mermaid** to write diagrams as text: the source is on the left and the rendered diagram
on the right, updated as you type (drag the divider to resize). Mermaid 12.2.0 is bundled, so
no Java, PlantUML or network is needed. A syntax error shows the message and keeps your text
and the last good diagram. A new diagram opens as `Untitled`; **Ctrl+S** saves it as a `.mmd`
file and later changes are saved automatically. Open, Save, Save as and Export SVG/PNG are in
the panel's ⋯ menu; opening a `.mmd` file (also from the File Manager) that is already open
focuses its tab. Diagrams render in Mermaid's strict mode: scripts, HTML and click actions in a
file never run. Like drawings, the first Mermaid after a restart reopens the previous
diagrams.

Add **Notes** for quick, long Markdown pages that you never have to save or name as files. The
first run creates an empty **QuickNotes**; **+ New note** adds pages such as GitNotes or
LinuxNotes. There are no folders or categories. Drag the handle (or Ctrl+Up/Down) to reorder,
switch between **Edit** and **Preview**, and delete after confirmation. Typing is saved
automatically to a local `notes.json`; there is one Notes panel per application.

UTF-8, BOM and LF/CRLF are preserved. Unsupported/binary/mixed-ending files are rejected
with a message; files above 64 MiB are rejected for allocation safety. Large text uses
a measured lightweight editor mode. Recovery checkpoints are local and never autosave
the original file. After an unexpected process exit, recoverable documents are offered
without restoring the previous layout.

## Validation status

Windows builds and automated tests pass. This is an implementation candidate, **not a
completed cross-platform release qualification**: Windows native dialog/clipboard/drop,
installed-package flows, interactive terminal use, native File Manager operations (Trash,
openers, watchers, cross-volume moves), native Tasks storage and window focusing, native
Excalidraw and Mermaid dialogs, autosave, recovery and drops, native Notes storage, the Right
Ctrl workspace key in WebView2/WebKitGTK, and both required Wayland environments still need
manual testing.
The Windows installer does not download WebView2; install its runtime as a prerequisite.

`npm run format:check` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
run the formatting/static checks. `npm run benchmark:editor` reproduces the parser experiment.
On Linux, run `npx playwright install --with-deps chromium` before browser tests.

See [implementation status](docs/STATUS.md), [decisions](docs/decisions/001-foundation.md) and
the [terminal](docs/decisions/003-terminal.md), [File Manager](docs/decisions/004-file-manager.md),
[Tasks](docs/decisions/005-tasks.md), [Excalidraw](docs/decisions/006-excalidraw.md),
[workspace key](docs/decisions/007-workspace-shortcuts.md), [Mermaid](docs/decisions/008-mermaid.md)
and [Notes](docs/decisions/009-notes.md) designs.
