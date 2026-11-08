# 030: A starter CMake project, a floating IDE in a new window, `mozaik -i` and `mozaik -t`

Status: accepted. The user asked for an IDE command that creates an empty CMake project, for
Add to Workspace: IDE with Ctrl+Shift+Enter to open the chosen project in a new window while
the window is in use, for `-i`/`--ide` beside `-ide`, and for `mozaik -t <file>` (`--text`) to
open a file from a terminal: in that Terminal's panel, or among the code editors when an IDE
terminal ran it.

## Starter CMake project

- **CMake: New Project in Empty Folder** (palette, while the IDE's folder has no
  `CMakeLists.txt`) and **New CMake Project** in the sidebar's `⋯` menu ask Rust
  (`project_create_cmake`) to write a `CMakeLists.txt` (CMake 3.16, C++17,
  `CMAKE_EXPORT_COMPILE_COMMANDS`, one `add_executable` named after the folder: its ASCII
  letters, digits and `_`, `app_` before a leading digit, `app` when nothing is left) and a
  `main.cpp` that prints a greeting. `main.cpp` then opens and the status bar shows CMake.
- **Only an empty folder.** Hidden entries (`.git`, `.gitignore`, `.vscode`) may be there;
  any other entry refuses with a message. Files are created with `create_new`, so nothing is
  ever replaced. These are the user's source files, written on their explicit command; project
  settings still live in the app config directory.
- Nothing runs: configure and build stay the user's steps (decision [011](011-cmake.md)).

## A floating IDE in a new window

- An IDE keeps its window to itself and a window holds at most two (decision
  [027](027-ide-as-a-whole.md)). With Ctrl+Shift+Enter (a floating panel) on **Add to
  Workspace: IDE** in the palette or the launcher, in a window that already shows panels,
  the IDE does not try to join it: **Open Project in New Window** lists Open Folder… (the
  native folder dialog) and the recent folders, and the choice opens a new window with an IDE
  on it, as File Manager's Open in IDE (New Window) does. The IDE limit does not apply, since
  nothing is added here. In an empty window, Ctrl+Shift+Enter keeps opening the IDE there.

## Command line

- **`mozaik -i <path>`**, also `-ide` and `--ide`, as before (decision
  [022](022-reload-and-command-line.md)). When both are given, the IDE wins over `-t`.
- **`mozaik -t <file>`** (also `--text`), the path resolved against the current folder:
  - **In a Mozaik terminal** the file opens in the window that owns the terminal: as a Text
    Editor tab in that Terminal's panel, or, when an IDE bottom-panel terminal or a coding agent
    ran it, among the IDE's code editors. No new window or process stays.
  - **Elsewhere** (or after the Mozaik that started the shell ended) Mozaik starts as usual and
    its first window opens the file in a Text Editor, through the same one-time window start as
    `-i` (`take_window_start` now returns `{ kind: "ide" | "text", path }`).
  - Only text files open; another file shows the usual notice and opens no application.
- **How the request reaches the running Mozaik** (`requests.rs`). Mozaik has no single-instance
  mechanism and opens no socket (the application is offline). Each process makes a folder of
  its own, `requests/<process id>` under the app's local data, and watches it. Every terminal
  session it starts gets `MOZAIK_REQUESTS` (that folder) and `MOZAIK_TERMINAL` (the session's
  random ID) in its environment. `mozaik -t` with both set writes `<uuid>.part`, renames it to
  `<uuid>.json` (`{ terminal, path }`) and exits; the watcher reads and removes each complete
  request (at most 64 KiB, a valid session ID and an absolute path) and sends `text-request` to
  the window that owns that session; a request for a session that no longer exists is dropped.
  The folder is removed at exit and replaced at start, so a request never reaches another
  process. The session ID is known only to the shell's processes, so another local program
  cannot aim at a window without it; what a request can do is what the user can do in the
  window: open a text file through the usual validated read.
