# 003 — Terminal module (V0.2)

Specification: local `.plans/Tessera_V0.2_Plan.md` (gitignored like the V0.1 plan).

## Ownership

- Rust `terminal::TerminalSessions` owns every PTY, shell child, reader, writer and waiter
  thread through `portable-pty` 0.9 (Linux PTY, Windows ConPTY). No pipe-based command
  runner and no network/WebSocket server are used.
- The session ID is the tab instance ID (a UUID created by the renderer and validated in
  Rust). Sessions are scoped to the creating window label; other windows cannot write to,
  resize or close them.
- The renderer's session store (`src/plugins/terminal/sessions.ts`) is separate from React
  views. The xterm.js `Terminal` and its DOM node live in the lazily loaded runtime and are
  re-parented when a view mounts. Moving a tab, hiding it or remounting a view therefore
  keeps the same shell, screen, scrollback and pending output. Only an explicit tab close
  (`dispose`) ends the session; view `useEffect` cleanup only detaches the DOM node.
- The plugin contract gained `title`, `modified` and `subscribe` so the workspace no longer
  assumes every tab is a text document. No runtime plugin loader was added.

## I/O

- Output bytes are decoded incrementally as UTF-8 (split characters are joined, invalid
  bytes become U+FFFD) and sent in order through one Tauri `Channel` per session. The same
  thread sequence delivers the exit event after the remaining output, so ordering holds.
- Backpressure: Rust counts unacknowledged output in UTF-16 units and stops reading above
  512 Ki units; the renderer acknowledges in 32 Ki batches from xterm.js write callbacks.
  A flooding program blocks on its own PTY instead of freezing the UI. Hidden tabs keep
  processing output into their scrollback, so nothing is dropped beyond the scrollback.
- Scrollback is 5,000 lines per terminal. This is a provisional bound, not a measurement.
- Input is serialized per session in the renderer (one IPC write in flight, later keystrokes
  batched) and written by a dedicated Rust thread, so typing order is preserved.
- xterm.js fits locally on every resize frame; the PTY resize IPC is debounced by 80 ms so
  split dragging does not run IPC per frame.
- Output is rendered only by xterm.js. No link addon is loaded and terminal text is never
  injected as HTML.

## Lifecycle

- Shell exit: the session becomes `exited`, xterm.js shows the exit code or signal, and the
  shell is not restarted. On Windows the waiter closes the pseudoconsole after the child exits
  because ConPTY otherwise keeps the output pipe open.
- Tab close: idempotent `close_terminal`. Closing the master hangs up the terminal (Linux
  SIGHUP to the foreground process group, Windows `CTRL_CLOSE_EVENT` to console clients);
  Linux also sends SIGHUP to the shell. After 1.5 s the shell is killed (SIGKILL only while
  the child has not been reaped, TerminateProcess on Windows). Programs that detach from the
  terminal can outlive this policy; orphan behavior must be checked natively.
- Window destroyed: all of that window's sessions close. Application exit: all sessions
  close and Mozaik waits for those shutdowns before exiting.
- A failed start (missing shell, spawn error, browser without IPC) is shown in the view
  and in the tab title; nothing is retried silently.

## Shells and working directory

- Linux: `/etc/shells` plus the user database login shell (`getpwuid_r`). `$SHELL` is only
  used as a preference when it is listed in `/etc/shells`. Default: login shell.
- Windows: `pwsh.exe` from `PATH` or Program Files, Windows PowerShell, `cmd.exe`, and Git
  Bash when installed. Default: PowerShell 7, then Windows PowerShell, then CMD.
- Shells start with argument arrays (`-NoLogo` for PowerShell, `--login -i` for Git Bash),
  never a concatenated command string. The renderer can only choose a detected shell ID;
  arbitrary executables are rejected. Unix sessions set `TERM=xterm-256color` and
  `COLORTERM=truecolor`; profiles and prompts are untouched.
- The Settings choice is stored natively in `shell.json`. Without a choice, the detected
  default is resolved at each start (not frozen). A stored shell that disappears causes an
  explicit error; the view offers a one-off start with the system default.
- Terminals start in the home directory; an inaccessible home directory is an explicit error.
  Since V0.7 the IDE bottom panel's terminal starts in its project folder (an existing
  absolute directory, validated by Rust).

## Keyboard

- Ctrl+C copies when text is selected, otherwise it reaches the shell (SIGINT). Ctrl+Shift+C
  always copies. Ctrl+Shift+V pastes on all platforms; Ctrl+V pastes on Windows and stays
  the shell's quoted insert on Linux. Pasting uses the native paste event (bracketed paste
  handled by xterm.js), so no clipboard-read permission is needed.
- With a terminal focused, Ctrl+N/O/S/W go to the shell. Ctrl+K, Ctrl+Shift+N, Ctrl+,,
  Ctrl+Alt+N and the held workspace modifier with arrows stay workspace shortcuts, so readline
  Ctrl+K (kill line) and Alt+arrow word motion are unavailable. Close a terminal with its
  tab's close button; choose another workspace modifier if Alt conflicts. Since V0.6 only the
  physical workspace key (Right Ctrl by default) with K or arrows is taken, so Left Ctrl+K and
  Alt+arrows reach the shell ([decision 007](007-workspace-shortcuts.md)).

## Deferred

Path/Git indicators, OSC 7 cwd tracking, shell integration, session persistence across
restarts, SSH management, link opening and terminal theming beyond the base tokens.
