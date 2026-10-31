# Mozaik user guide

Everything Mozaik does, tool by tool. The [README](../README.md) has the short version.

## The workspace

Open the launcher with **Ctrl+Shift+'** (the key right of the semicolon on US layouts, i on
Turkish Q), search for a tool, and press **Enter** to add it as
an automatic split, **Ctrl+Enter** to add it as a tab or **Ctrl+Shift+Enter** to add it as a
**floating panel** over the layout. A floating panel moves by its header, resizes at its
edges, takes tabs dropped on it and goes back into the layout with its dock button (or
`Dock Panel` in the palette; `Float Panel` floats the focused one). **Ctrl+N** adds a Text
Editor tab; **Ctrl+Shift+N** adds an automatic split.
Drag tabs to merge, reorder or split. Hold **Ctrl+Shift** and drag the panel grip to move a
whole panel: drop at another panel's center to swap, or at an edge to split. **Right
Ctrl+arrows** moves focus spatially; only these keys belong to the held workspace key, and
Settings offer Left Ctrl or Left Alt instead, for keyboards without a Right Ctrl. Right Alt
(AltGr) is not offered because it types characters on many layouts.

## Files, settings and the command palette

Use **Ctrl+O**, **Ctrl+S**, **Ctrl+Shift+S**, **Ctrl+W**, **Ctrl+G** to open, save, save as,
close and go to line. Undo/redo and Tab indentation are available. Long lines wrap at the
panel's width under their indentation, keeping one line number (Settings → Text Editor → Word
wrap). The Text Editor's own bar shows the cursor, line ending, encoding and unsaved state;
a drawing's bar its autosave state. A Text Editor panel's **+** offers **New File**, **Open
File…** and **Open Folder…**; as in Sublime Text, an opened folder shows at the left of that
panel and its files open as tabs there (✕ closes the folder). As in Sublime Text, a new Text
Editor is a page without a tab: start typing and it becomes an **Untitled** tab; closing the
last tab leaves the page (and the folder), and **Ctrl+Shift+C** closes the panel. The Text
Editor highlights files by their type and otherwise stays simple;
search, multiple cursors and language features are in the IDE's Code Editor. External plugins
and layout restoration are out of scope.
Use **Ctrl+Shift+,** to open Workspace Settings and **Ctrl+Alt+N** to create a new
independent window.
Settings have a search field and tabs: General, then one per module (Text Editor, IDE,
Terminal, File Manager, Tasks and Notes), each with its own shortcuts in folding sections.
Click a shortcut and press new keys to change it, × removes it and ↺ restores the default.
Nothing applies until **Save**; **Reset to Default** resets the tab shown. A **Window
opacity** slider (1% steps) fades the whole window; settings apply to every window. The
status line shows the Mozaik mark and the date and time. Every tab closes from its own × on hover.
There is no title bar: drag the thin strip above the panels to move the window and
double-click it to maximize. **Ctrl+Shift+C** closes the focused panel (in an IDE, after
asking, the whole IDE; in a terminal it copies) and **Ctrl+Shift+E** closes the window.
**Ctrl+Shift+P** opens the **command palette**: workspace commands (open, save, close, new
window, settings), **Add to Workspace: <tool>** for every tool (Enter, Ctrl+Enter or
Ctrl+Shift+Enter as in the launcher), and the commands of the tools
in the workspace (File Manager, Tasks, Notes, Mermaid, IDE, Code Editor, CMake, Debug, Test), the
focused tool's first. As in VS Code, **Ctrl+P** finds a file of the IDE project and
**Ctrl+Shift+O** (`@`) a symbol of the code file.

## Terminal

Add a **Terminal** from the launcher to run your default shell (chosen in Settings) in an
interactive PTY that starts in your home directory. Several terminals run independently; moving
a terminal tab keeps its shell running, and closing the tab ends it. Ctrl+C copies a selection
and otherwise interrupts; Ctrl+Shift+C/V copy and paste (Ctrl+V also pastes on Windows).
While a terminal has focus, Ctrl+N/O/S/W go to the shell.

## File Manager

Add a **File Manager** to browse local folders in a Details view (Name, Size, Modified). It
opens in your home folder; folders open in place and files open in their default application
(programs and scripts are not launched). Use the breadcrumb or **Ctrl+L** to type a path,
**Backspace** for the parent folder and the filter box to narrow the current folder. Right-click
for Open, Cut, Copy, Paste, Rename, Pin/Unpin, Delete, New file and New folder (type a file's
name with its extension); the ⋯ menu has New file and New folder too, Show hidden files and
Delete permanently. Delete moves items to the Trash/Recycle Bin;
**Shift+Delete** deletes permanently after confirmation. Name collisions ask Replace, Keep Both
or Skip. Drag items onto a folder to move them. Pinned items are shared by all File Managers.
Every new File Manager starts in home: like other panels, it is not restored after a restart.

## Tasks

Add **Tasks** for a small personal task list. There is one Tasks panel per application; opening
it again focuses the existing one. The list picker switches between All Lists, the permanent
Inbox and your own lists, and offers New List and Manage Lists (rename, delete; a deleted
list's tasks move to the Inbox). Tasks are grouped into Todo, In Progress and Done; use
**+ Add Task** and **Enter** to add one at the end of a section (**Escape** cancels). Drag the
handle to reorder or change status, or use **Ctrl+Up/Down** on a focused task. Click a task to
edit its title, list, status, priority (Medium by default) and Markdown description, with
explicit Edit and Preview. **Delete** on a focused task and the Delete button ask first. Every
change is saved automatically to a local `tasks.json`; the selected list survives a restart.

## Excalidraw

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

## Mermaid

Add **Mermaid** to write diagrams as text: the source is on the left and the rendered diagram
on the right, updated as you type (drag the divider to resize). Mermaid 12.2.0 is bundled, so
no Java, PlantUML or network is needed. A syntax error shows the message and keeps your text
and the last good diagram. A new diagram opens as `Untitled`; **Ctrl+S** saves it as a `.mmd`
file and later changes are saved automatically. Open, Save, Save as and Export SVG/PNG are in
the panel's ⋯ menu; opening a `.mmd` file (also from the File Manager) that is already open
focuses its tab. Diagrams render in Mermaid's strict mode: scripts, HTML and click actions in a
file never run. Diagrams use the dagre layout; ELK (`layout: elk`) is not included. Like
drawings, the first Mermaid after a restart reopens the previous
diagrams.

## Notes

Add **Notes** for long Markdown pages kept as files. Choose a
**notes folder** (from the panel, or in Workspace Settings → Tasks and Notes): each note is a
`.md` file named by its title and each group a subfolder. The new-note and new-group buttons
(file and folder icons) open a name field in the selected group, as in a file explorer: type
the name and press Enter (Escape cancels); right-click a row (or use F2 and Delete) to rename it or move it to the
Trash after confirmation, and pick another **Group** on the page to move a note. Switch
between **Edit** and **Preview**; typing is saved to the note's file automatically. If another
program changed the file, choose **Reload from Disk** or **Overwrite**. There is one Notes
panel per application.

## IDE

Add the **IDE** from the launcher to work on code; the first IDE of a window reopens the folder
opened last. It opens as a project sidebar, an empty **Code Editor**, a bottom panel with
**Problems**, **Output** and **Terminal** views (the terminal starts in the project folder
the first time it is shown; + adds more terminals, ⌄ one with another shell) and a status bar under all of them with the Git branch and the error/warning
counts. The sidebar and the bottom panel have no close button: their ⌄/‹ button (or the shown
view's icon) minimizes them to their bar, and **Close IDE** in the sidebar's ⋯ menu (or
Ctrl+W) closes the whole IDE. The sidebar's icons switch between **Explorer** (the file tree
with Git states; what Git ignores is dimmed), **Search** (project search and replace) and
**Source Control** (Staged Changes and Changes: click a file to compare it, or stage,
unstage and discard it; the icon counts the changes; the current side of a comparison is
editable and its arrows revert single changes), above the Outline of the current file;
**Go to File…** (Ctrl+P) finds files by name. New files
and folders come from the tree's right-click menu. Files open in **Code Editor** tabs above
the bottom panel: syntax colours, folding, bracket matching, multiple cursors (Ctrl+D,
Alt+click, Ctrl+Alt+Up/Down, Shift+Alt+drag), Ctrl+L line selection, Ctrl+K Ctrl+C / Ctrl+K Ctrl+U
line comments, Ctrl+F search/replace and
Back/Forward. With [clangd](https://clangd.llvm.org) installed, C/C++ files get completion,
diagnostics (also in **Problems**), go to definition (F12 or Ctrl+click), references
(Shift+F12), rename (F2), header/source switching (Alt+O), quick fixes and formatting (also on
save, in Project Settings);
clangd uses the project's `compile_commands.json`. Without clangd everything else still
works. Every action is also in the editor's ⋯ and right-click menus. **Open Changes** compares
a file with the staged text. IDE messages (such as a definition not found) go to the
bottom panel's **Output → IDE** and briefly to the status bar. Code is saved only with
Ctrl+S; renames and replacements that reach closed files ask first. Git commits are not part
of the IDE.

## CMake

**CMake** projects (a `CMakeLists.txt` in the project, or in the folder named in Project
Settings) get CMake in the status bar and the command palette (`CMake: …`), after VS Code's
CMake Tools. Choose a kit (Visual Studio, MinGW GCC, Clang, clang-cl, GCC — found on this
system) and a variant, or presets when the project has `CMakePresets.json`. Configure only
runs when you ask; its targets then become build and run targets. Build and Clean show
their output in the bottom panel's **Output**, compiler errors also in **Problems**; Run
builds the run target and starts it in the panel's **Run** view (arguments and working
folder in Project Settings). The compilation database goes to clangd. The CMake program,
generator, build folder, parallel jobs and kits are in Workspace Settings → IDE.

## Run and Debug

**Run and Debug** (the sidebar's bug icon, the status bar's ⛭ or `Debug: …` in the palette)
debugs the CMake run target with GDB (14 or newer, with Python — MinGW and Linux GDBs are) or
LLVM's `lldb-dap`, whichever suits the compiler and is installed; **Select Debugger…** picks
another or a program on disk. Start Debugging builds the target first (it never configures).
Click left of a line number for a breakpoint; right-click there for conditions, hit counts
("from the Nth hit") and logpoints. While paused, the view shows Variables (STL containers
through the debugger's pretty-printers), Watch, Call Stack and Breakpoints, the paused line is
highlighted, hovering a name shows its value, a double-click sets a value, and the floating
toolbar continues, steps, restarts or stops. The program's output appears in the bottom panel's
**Debug: <target>** view; the **Debug Console** has the debugger's messages, logpoints and
evaluates expressions. The ⚙ button edits the target's arguments, working folder and
environment in `.mozaik/debug.json`, a file meant to be shared through Git (no secrets);
breakpoints and watches stay in Mozaik's own data. Programs built with MSVC cannot be debugged
(they still build), the debugged program gets no keyboard input, and debuggers are never
downloaded.

## Testing

**Testing** (the sidebar's flask icon or `Test: …` in the palette) lists the tests CTest
knows in the configured build folder (`add_test`, GoogleTest's `gtest_discover_tests`) by
GoogleTest suite (a `TEST_F`'s fixture) as soon as it is shown; ↻ looks again. A test, a
suite or all of them run with ▶ after their program is built (when "Build the target before
Run" is set), with ✓, a red ✗ and a grey ⊘ (skipped) results and a failed test's output under the
list (all of CTest's output in **Output → Tests**). The bug button debugs one test alone:
its program with the arguments that select it. Double-click a test to open its `TEST` line.
Tests run only when you ask.

## Coverage

**Coverage** (the pie icon, or `Coverage: …` in the palette) shows an LCOV (`.info`) or
Cobertura (`.xml`) report that a coverage build wrote, for example a CMake target running
gcovr or llvm-cov: line, function and branch totals, then the report's files by folder with
their line coverage. Pick the report once with **Open Coverage Report…**; it is read again
whenever the file changes, and files changed after the report are marked ●. A file opens as
a read-only tab beside the code with covered lines green, partly covered ones (branches
left) yellow, uncovered ones red and hit counts in the gutter; ↑/↓ jump between uncovered
lines and **Open in Editor** opens the line in its code tab. Mozaik runs no coverage tool.

## Your files are safe

UTF-8, BOM and LF/CRLF are preserved. Unsupported/binary/mixed-ending files are rejected
with a message; files above 64 MiB are rejected for allocation safety. Large text uses
a measured lightweight editor mode. Recovery checkpoints are local and never autosave
the original file. After an unexpected process exit, recoverable documents are offered
without restoring the previous layout.
