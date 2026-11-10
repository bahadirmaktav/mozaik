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
Drag tabs to merge, reorder or split. A Text Editor splits inside its own panel, as in Sublime
Text: **Split Right** / **Split Down** in a tab's right-click menu, or a text tab dragged to
an edge of a Text Editor, divides the panel into editor groups with a line between them.
Each group has its own tabs; a group goes away with its last tab, while Maximize and
**Ctrl+Shift+C** act on the whole Text Editor. Other tools are placed beside it, never
between its groups. Hold **Ctrl+Shift** and drag the panel grip to move a
whole panel: drop at another panel's center to swap, or at an edge to split. **Right
Ctrl+arrows** moves focus spatially; only these keys belong to the held workspace key, and
Settings offer Left Ctrl or Left Alt instead, for keyboards without a Right Ctrl. Right Alt
(AltGr) is not offered because it types characters on many layouts.

## Files, settings and the command palette

Use **Ctrl+O**, **Ctrl+S**, **Ctrl+Shift+S**, **Ctrl+W**, **Ctrl+G** to open, save, save as,
close and go to line. Undo/redo and Tab indentation are available. Long lines wrap at the
panel's width under their indentation, keeping one line number (Settings → Text Editor → Word
wrap). The Text Editor's own bar shows the active file's path at its left, then the cursor, line
ending, encoding and unsaved state;
a drawing's bar its autosave state. A Text Editor panel's **+** offers **New File**, **Open
File…** and **Open Folder…**; as in Sublime Text, an opened folder shows at the left of that
panel and its files open as tabs there (✕ closes the folder). As in Sublime Text, a new Text
Editor is a page without a tab: start typing and it becomes an **Untitled** tab; closing the
last tab leaves the page (and the folder), and its ✕ in the panel bar or **Ctrl+Shift+C**
closes the panel. The Text
Editor highlights files by their type and otherwise stays simple;
search, multiple cursors and language features are in the IDE's Code Editor. External plugins
and layout restoration are out of scope.
Use **Ctrl+Shift+,** to open Workspace Settings and **Ctrl+Alt+N** to create a new
independent window.
Settings have a search field and tabs: General, then one per module (Text Editor, IDE,
Terminal, File Manager, Tasks and Notes), each with its own shortcuts in folding sections.
Click a shortcut and press new keys to change it, × removes it and ↺ restores the default.
Nothing applies until **Save**; **Reset to Default** resets the tab shown. **Theme** chooses
the colors (Mozaik Dark, Mozaik Dim, Night Blue, Warm Dark, Mozaik Light, Paper, and after VS Code
Dark Modern, Dark+, Monokai, One Dark, Dracula, Solarized Dark, Abyss, Tomorrow Night Blue,
Kimbie Dark and High Contrast Dark); the
palette's **Preferences: Color Theme…** previews each theme as you move through the list. A **Window
opacity** slider (1% steps) fades the whole window; settings apply to every window. The
status line shows the Mozaik mark and the date and time. Every tab closes from its own × on hover.
There is no title bar: drag the thin strip above the panels to move the window and
double-click it to maximize. **Ctrl+Shift+C** closes the focused panel (in an IDE, after
asking, the whole IDE; in a terminal it copies) **Ctrl+Shift+E** closes the window and **Ctrl+Shift+M** minimizes it.
**Ctrl+Shift+P** opens the **command palette**: workspace commands (open, save, close, new
window, settings), **Add to Workspace: <tool>** for every tool (Enter, Ctrl+Enter or
Ctrl+Shift+Enter as in the launcher), and the commands of the tools
in the workspace (File Manager, Tasks, Notes, Mermaid, IDE, Code Editor, CMake, Debug, Test), the
focused tool's first. As in VS Code, **Ctrl+P** finds a file of the IDE project and
**Ctrl+Shift+O** (`@`) a symbol of the code file. **Developer: Reload Window** starts the
window again (after asking about unsaved files) and reopens its IDE folder. From a terminal,
`mozaik -i <path>` (also `-ide` or `--ide`; for example `mozaik -i .`) opens a window with an
IDE on that folder. `mozaik -t <file>` (also `--text`) run in a Mozaik terminal opens the file
in that window: as a Text Editor tab beside the terminal, or among the code editors when an
IDE terminal or coding agent ran it; run anywhere else, it opens a new window with the file.
With an IDE or other panels in the window, **Add to Workspace: IDE** with Ctrl+Shift+Enter
asks for a folder (Open Folder… or a recent one) and opens it in a **new window** with its IDE.

**Layout templates** keep an arrangement of tools to open again. Run **Save Layout as
Template…** and type its name where the palette was, then press Enter: the tools of the window and their places are kept (not their
files, folders or sessions). **Open Layout Template…** closes the window's panels after
asking (and asking about unsaved files) and opens the same tools, fresh, in the same
places; **Delete Layout Template…** removes one. Templates are shared by all windows.

In Settings → General, **Command Palette → Size** enlarges or shrinks the palette and the
launcher. F5 and Ctrl+R do not reload the window; **Developer: Reload Window** does, after
asking about unsaved files.

## Terminal

Add a **Terminal** from the launcher to run your default shell (chosen in Settings) in an
interactive PTY that starts in your home directory. Several terminals run independently; moving
a terminal tab keeps its shell running, and closing the tab ends it. Ctrl+C copies a selection
and otherwise interrupts; Ctrl+Shift+C also copies a selection and otherwise closes the panel,
like in other tools; Ctrl+Shift+V pastes (Ctrl+V also pastes on Windows).
While a terminal has focus, Ctrl+N/O/S/W go to the shell. The **+** in a Terminal panel's bar
lists the shells found on your system (the default one marked) and adds the one you pick as a
new tab; a double click on the tab strip adds one with the default shell. Right-click a
terminal tab and choose **Rename** to name it (an empty name gives back the shell's).

## File Manager

Add a **File Manager** to browse local folders in a Details view (Name, Size, Modified). It
opens in your home folder; folders open in place. A double click (or Enter) opens a text file as
a tab of the Text Editor in the workspace, or as a tab beside the File Manager when there is none;
you can also drag files onto a Text Editor. Images, PDFs, archives and other files that are not
text open in their default application (programs and scripts are not launched). Use the breadcrumb or **Ctrl+L** to type a path,
**Backspace** for the parent folder. The search box finds names in the shown folder and its
subfolders as you type, like a file explorer's search (`*` and `?` are wildcards); results show
their folder and Escape clears it. The computer icon at the start of the path (also **Up** from
a drive) opens **This PC** (Computer on Linux) with the drives or mounted disks and their free
space; click one to open it. Right-click
for Open, Cut, Copy, Paste, Rename, Pin/Unpin, Delete, New file and New folder; the ⋯ menu has
New file and New folder too, Show hidden files and Delete permanently. As in a file explorer, a
new file or folder is named in a row at the top of the list and **F2** renames in the row: type
the name (a file's with its extension), **Enter** confirms and **Escape** cancels. Delete moves items to the Trash/Recycle Bin;
**Shift+Delete** deletes permanently after confirmation. Name collisions ask Replace, Keep Both
or Skip; pasting into the items' own folder adds numbered copies (`name (2).txt`) without
asking. **Ctrl+Z** undoes the last copy, move, rename, new item or delete (copies and new items
go to the Trash, deleted items come back from it) and **Ctrl+Y** redoes it; the File Managers
and the IDE Explorer share this history. A permanent delete cannot be undone. Drag items onto a folder to move them. **Open in Terminal** (right-click) starts a
terminal in the right-clicked folder, or the folder shown, as a tab of your Terminal (or a new
one beside); **Open in IDE (New Window)** opens a new Mozaik window with an IDE on that folder.
Pinned items are shared by all File Managers; the ✎ button in their list gives a pin its own
name. Settings → File Manager → **Show pinned items** keeps them behind the pin button or always
in a list at the left of the panel, whose right-click menu opens, renames, moves and unpins them;
drag its dividing line to resize it (each panel keeps its own width until it closes).
A Windows shortcut (`.lnk`) opens what it points at: a folder here, a file like any other file. A
shortcut to a program is not run, and the panel says so; nor does one go to a network path (go there
through the path box). Cut items look faded until they are
pasted; **Escape** calls off a cut. Cut, copied and pasted items work between all windows of
Mozaik and with the IDE Explorer. The list leaves room under its last row, to right-click there.
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
Priorities are colored (High red, Medium amber, Low green); under **All Lists** each task
starts with its list as a colored label (Inbox gray, other lists a fixed color each).

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
between **Edit** and **Preview**; Edit has the editing shortcuts of the text and code editors
(Ctrl+D, Ctrl+L, Ctrl+Alt+Up/Down, Alt+click, Ctrl+F); typing is saved to the note's file automatically. If another
program changed the file, choose **Reload from Disk** or **Overwrite**. There is one Notes
panel per application.

## IDE

Add the **IDE** from the launcher to work on code; the first IDE of a window reopens the folder
opened last. **Add to Workspace: IDE** in the command palette asks first: **Empty Project** (an IDE
without a folder), then the ten folders opened last, newest first, to open one at once. It opens as a project sidebar, an empty **Code Editor**, a bottom panel with
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
and folders come from the tree's right-click menu or the buttons that appear on the project's
title when you point at it (New File, New Folder, Refresh, Collapse Folders); their names, and
**F2** renames, are typed in the tree's row. A click on the empty space below the rows clears
the selection. Files show icons by their kind: **Preferences: File Icon Theme** in the palette
(or Settings → IDE → Explorer) chooses Seti (VS Code's glyphs), Seti with Folders (folders
such as src, include, tests and build also show a badge of their kind), Minimal or None, showing each at once while you move through the list. The gear at the bottom of the
activity bar opens Workspace Settings on the IDE tab. **Ctrl+Z**/**Ctrl+Y** undo and redo file
operations, as in the File Manager. Ctrl+click and Shift+click (or Shift+arrows) mark several rows;
**Ctrl+X**, **Ctrl+C** and **Ctrl+V** cut, copy and paste them (also to and from a File
Manager), and dragging rows onto a folder moves them, with the dragged items next to the
pointer. Files open in **Code Editor** tabs above
the bottom panel (`.excalidraw` drawings and `.mmd` diagrams open in Excalidraw or Mermaid,
as a tab among them): syntax colours, folding, bracket matching, multiple cursors (Ctrl+D,
Alt+click, Ctrl+Alt+Up/Down, Shift+Alt+drag), Ctrl+L line selection, Ctrl+K Ctrl+C / Ctrl+K Ctrl+U
line comments, Ctrl+F search/replace and
Back/Forward. With [clangd](https://clangd.llvm.org) installed, C/C++ files get completion,
diagnostics (also in **Problems**), go to definition (F12 or Ctrl+click), references
(Shift+F12), rename (F2), header/source switching (Alt+O), quick fixes and formatting (also on
save, in Project Settings);
clangd uses the project's `compile_commands.json`. Without clangd everything else still
works. CMake files are highlighted and complete CMake's commands, keywords and variables and
the targets and variables the file defines, without a server. Every action is also in the editor's ⋯ and right-click menus. **Open Changes** compares
a file with the staged text. IDE messages (such as a definition not found) go to the
bottom panel's **Output → IDE** and briefly to the status bar. Code is saved only with
Ctrl+S; renames and replacements that reach closed files ask first. **IDE: Zoom In** and **Zoom
Out** (Ctrl+Shift++ and Ctrl+Shift+-) enlarge or shrink the whole IDE, as in VS Code: code,
sidebar, tabs, bottom panel, terminals and status bar. Settings → IDE → Font size sets the
same size; other modules keep theirs. Git commits are not part
of the IDE.

A click on a file in the Explorer shows it and keeps the focus on the row, so **F2**, Delete and the
clipboard keys act on it; a double click or Enter goes to the editor. The Explorer's menu has **Reveal in
File Manager** (the folder, or a file's folder, in a floating File Manager), **Open in Integrated
Terminal** (a new terminal of the bottom panel started there), **Copy Path** and **Copy Relative
Path**. Cut files look faded and **Escape** calls off a cut.

**Search** works like VS Code's: the arrow beside the box shows **Replace**, the box has Match Case,
Whole Word, Regular Expression and **Search Files Ignored by Git**, and results fold by file.

**Source Control** has a Refresh button and asks Git each time it opens. Ctrl+click, Shift+click and
Shift+arrows mark several files (Ctrl+A marks all); the buttons and the right-click menu of a marked
file act on all of them. The **Graph** section below shows the history of every branch and tag. A
click on a commit lists the files it changed; a click on a file compares it with the commit's parent
in a read-only tab among the code editors. The person button in the Graph's bar shows or hides the
authors.

The code editor marks lines that differ from Git's staged text beside the line numbers: green for
added, blue for changed, a red mark where lines were deleted; a click opens the comparison. The
**minimap** at its right shows the code as faint lines, the same changes as colored bands and the
lines with errors as red bands with a solid right edge. A click brings that line to the middle and a
drag then moves the slider, as in VS Code. Settings → IDE → Editor turns it off and sets its width
and scale (1×–3×); the scrollbar lies right of it. The IDE status bar shows the cursor's line and
column. Folding a block whose `}` starts its line keeps that line, so folding the `if` of
`} else {` leaves the `else` in view. The Problems view folds a file's problems under its row, and
the Testing view indents a suite's tests under it. Definitions, search results and Find matches land in the
middle of the view; Undo, Redo, Back and Forward (Alt+←/→) bring a place that is off screen to
the middle too and leave one on screen where it is, as in VS Code. In an `#include`, choosing a
folder from the completions (clangd lists folders such as `boost/` beside the headers) lists
what is in it next. Right-click also has **Cut**, **Copy** and **Paste**.

A Markdown file shows **Source**, **Split** and **Preview** buttons, in the Code Editor's bar and the
Text Editor's status bar; **Ctrl+Shift+V** steps through them. The preview follows unsaved text and
shows a README's HTML layout (centered pictures, tables, captions). A link to a heading scrolls to it,
a link to a local file opens that file (as code in the IDE), and local pictures show; web links and
pictures stay text, since Mozaik is offline. A link never starts another application: open a file that
is not text from the File Manager.

**Preferences: C++ Highlight Theme** (or Settings → IDE → Editor) chooses colors for C and C++ apart
from the color theme: VS Code's, Visual Studio's, One or Monokai, each following whether the color
theme is dark or light. With clangd they also tell classes, parameters, enumerators and macros apart.

In Settings → IDE → Code Analysis, **Compiler warnings** (default `-Wall -Wextra`) are added for clangd
and clang-tidy, so an unused variable is reported without changing your build. **Checks without a
.clang-tidy** are what clang-tidy checks in a project with no `.clang-tidy` of its own. While you edit,
clangd reads only a project's own file, so turn on **Analyze on save** to see these checks as you work.

The **Claude Code** and **Codex** icons in a code panel's header open a panel of agent sessions beside
the code. Each press runs `claude` or `codex` in your default shell, in the project folder; the shell
stays open after it. Install the agents yourself: Mozaik downloads nothing.

## CMake

**CMake** projects (a `CMakeLists.txt` in the project, or in the folder named in Project
Settings) get CMake in the status bar and the command palette (`CMake: …`), after VS Code's
CMake Tools. Choose a kit (Visual Studio, MinGW GCC, Clang, clang-cl, GCC — found on this
system) and a variant, or presets when the project has `CMakePresets.json`. Configure only
runs when you ask; its targets then become build and run targets. Build and Clean show
their output in the bottom panel's **Output**, compiler errors also in **Problems**; Run
builds the run target and starts it in the panel's **Run** view (arguments and working
folder in Project Settings). The compilation database goes to clangd. The CMake program,
generator, build folder, parallel jobs and kits are in Workspace Settings → IDE. In an empty
project folder, **CMake: New Project in Empty Folder** (or **New CMake Project** in the
sidebar's `⋯` menu) writes a `CMakeLists.txt` and a `main.cpp` it builds as an executable;
hidden entries such as `.git` may already be there, nothing is ever replaced.

Workspace Settings → IDE → **Features** turns the IDE's features on and off, as extensions
are in VS Code: Language Server (clangd), Source Control (Git), CMake, Run and Debug, Testing,
Coverage, Code Analysis (clang-tidy), SonarQube, TODOs and Coding Agents (Claude Code, Codex). A
feature that is off leaves the sidebar,
status bar, bottom panel, palette and menus, and starts no process; Run and Debug and Testing
need CMake.

## Run and Debug

**Run and Debug** (the sidebar's bug icon, the status bar's ⛭ or `Debug: …` in the palette)
debugs the CMake run target with GDB (14 or newer, with Python — MinGW and Linux GDBs are) or
LLVM's `lldb-dap`, whichever suits the compiler and is installed; **Select Debugger…** picks
another or a program on disk. Start Debugging builds the target first (it never configures).
Click left of a line number for a breakpoint; right-click there for conditions, hit counts
("from the Nth hit") and logpoints. While paused, the view shows Variables (STL containers
through the debugger's pretty-printers), Watch, Call Stack and Breakpoints, the paused line is
highlighted, hovering a name (or a selection) shows its value in place of the language
server's hover, a double-click sets a value, and the floating toolbar continues, steps,
restarts or stops. VS Code's keys work too: F5 starts or continues, F6 pauses, F10 steps over,
F11 into, Shift+F11 out, Shift+F5 stops, Ctrl+Shift+F5 restarts and F9 toggles a breakpoint
(not inside a terminal, File Manager or drawing). Drag the toolbar by its grip to move it;
double-click the grip to put it back. A local the debugger cannot read yet (one not constructed
at that line) shows its reason instead of hiding the other locals. The program's output appears in the bottom panel's
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
Ctrl+click and Shift+click mark several tests (Ctrl+A all, Ctrl+click on a suite its tests);
▶ on a marked test, or the counted ▶ in the bar, runs them all. **Collapse All** in the bar
folds every suite. Tests run only when you ask.

## Coverage

**Coverage** (the pie icon, or `Coverage: …` in the palette) shows an LCOV (`.info`) or
Cobertura (`.xml`) report that a coverage build wrote, for example a CMake target running
gcovr or llvm-cov: line, function and branch totals, then the report's files by folder with
their line coverage. Pick the report once with **Open Coverage Report…**; it is read again
whenever the file changes, and files changed after the report are marked ●. A file opens as
a read-only tab beside the code with covered lines green, partly covered ones (branches
left) yellow, uncovered ones red and hit counts in the gutter; ↑/↓ jump between uncovered
lines and **Open in Editor** opens the line in its code tab. Mozaik runs no coverage tool.

## SonarQube

**SonarQube** (the sidebar's arcs icon) shows the issues of the analysis your CI made on a SonarQube
server. Enter the server address, project key and a user token (My Account → Security on the server);
the address and key come from `sonar-project.properties` when it has them. The token is kept in the
system's credential store (Windows Credential Manager, the Secret Service on Linux), never in the
project. Mozaik picks the analysis of the current branch's merge request, else the branch, else the
main branch (**Main branch** forces it), and shows the Quality Gate and issues in the view, in
**Problems** and in the code. While you edit, issues move with their lines; one whose lines you changed
waits under **Changed, awaiting CI**, because only the next analysis can say it is fixed. After CI
analyzes again, **Refresh** says how many were fixed and how many are new. Mozaik only reads from the
server, only on Connect and Refresh, sends no code and runs no scanner.

## Your files are safe

UTF-8, BOM and LF/CRLF are preserved. Unsupported/binary/mixed-ending files are rejected
with a message; files above 64 MiB are rejected for allocation safety. Large text uses
a measured lightweight editor mode. Recovery checkpoints are local and never autosave
the original file. After an unexpected process exit, recoverable documents are offered
without restoring the previous layout.
