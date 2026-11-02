# 022: Reload Window and `mozaik -ide <path>`

Status: accepted (eighteenth review). The user asked for VS Code's Reload Window in the
palette, to close and reopen the IDE, and for `mozaik -ide <path>` to open a window with an
IDE on a folder (`mozaik -ide .` for the current folder).

## Decisions

- **Developer: Reload Window** asks about unsaved files as closing the window does, clears the
  window's recovery snapshots, ends what the window started in Rust (terminals, language
  servers, CMake and clang-tidy jobs, the debug session, watches, single-panel ownership:
  the same release as a closed window) and reloads the page. The layout is not restored; if
  an IDE was open, the reloaded page opens an IDE on its folder, through the same one-time
  window start as File Manager's **Open in IDE (New Window)** (decision
  [004](004-file-manager.md)). This is an explicit user action, not a startup restore.
- **`mozaik -ide <path>`** (also `--ide`) starts Mozaik with its first window opening an IDE
  on the folder, resolved against the current folder and checked like any project root; a
  missing folder is reported on stderr and the window starts empty. Mozaik has no
  single-instance mechanism, so this starts another Mozaik process with its own window, as
  starting Mozaik twice already did; files, tasks and drawings use their cross-process locks.
  The installer does not add Mozaik to `PATH`; add its install folder to call it by name.
