# 023: Ship Microsoft's current ConPTY on Windows

Status: accepted (nineteenth review). In Mozaik's terminals full-screen programs such as
opencode and Claude Code lost lines when scrolled back, while they worked in Windows Terminal.

## Context

On Windows a terminal talks to its shell through ConPTY. portable-pty uses the ConPTY built
into Windows (`kernel32.dll`) unless a `conpty.dll` lies beside the program. The built-in one
renders the console buffer again before sending it on, so a program that redraws more than a
screen at once, or clears and repaints its output, reaches xterm.js cut to the visible rows.
Windows Terminal and VS Code ship their own, newer `conpty.dll` with its `OpenConsole.exe`
host, which passes such output through, from Microsoft's
`Microsoft.Windows.Console.ConPTY` package (MIT).

## Decisions

- The Windows installer carries that package's `conpty.dll` beside `mozaik.exe` and its
  `x64\OpenConsole.exe` (the folder `conpty.dll` starts it from). portable-pty loads it
  instead of the built-in ConPTY; nothing in Mozaik's code changes, and a missing file falls
  back to the built-in one.
- `scripts/conpty.mjs` (`npm run conpty`) downloads the package at build time, pinned by
  version and SHA-256, into the ignored `src-tauri/conpty/`, and copies it beside the programs
  already in `src-tauri/target` for `tauri dev`. The application itself makes no request.
- Only the installer build lists the files (`src-tauri/tauri.conpty.conf.json`, used by
  `npm run package:windows`), so `cargo build` and `cargo test` keep working without them.
- x64 only, as the installer is. Linux PTYs need none of this.
- A newer package version is a reviewed change of the version and hash in the script.
