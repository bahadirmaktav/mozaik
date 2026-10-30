# 012: Debugging (V0.8)

Status: accepted. Implements `.plans/tessera-v0.8-plan.md`: C++ debugging of CMake run
targets after VS Code's Run and Debug, inside the existing IDE panels.

## What exists

| Part                    | Where                                          | Notes                                                       |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Adapters, launch, state | `src-tauri/src/debug.rs`                       | Detection, allowlisted DAP bridge, `debug.json`, app data   |
| Processes               | `lsp.rs` (`LanguageServers`) reused            | Same framing, window ownership and shutdown as clangd       |
| Session, DAP client     | `src/plugins/ide/debug.ts`                     | One session; breakpoints and watches per project root       |
| Pure rules              | `debugModel.ts`                                | Breakpoint kinds, hit counts, edits, hover expression       |
| Run and Debug view      | `RunAndDebug.tsx`, `DebugValues.tsx`           | Sidebar view with Variables, Watch, Call Stack, Breakpoints |
| Editor                  | `debugEditor.ts`                               | Breakpoint gutter, paused line, Debug Hover                 |
| Console, toolbar        | `DebugConsole.tsx`                             | Bottom panel view; floating toolbar over the workspace      |
| Program output          | `terminal/sessions.ts` output sessions, panels | Shown in the Run view's place as `Debug: <target>`          |

## Decisions

- **Adapters.** GDB's own DAP interpreter (`gdb --interpreter=dap`, GDB 14 or newer built
  with Python; checked with `python import gdb.dap`) and LLVM's `lldb-dap` (`lldb-vscode`
  before LLVM 18). Both are GPL/Apache tools the user installs; Tessera bundles, downloads or
  updates none (`cpptools`' OpenDebugAD7 is licensed for VS Code products only). GDB starts
  with `-iex "set debuginfod enabled off"` so it never asks a symbol server: Tessera stays
  offline. It loads its system init file, which registers the libstdc++ pretty-printers
  (MinGW and Linux distributions ship them); Tessera writes no STL formatter of its own.
- **Choosing.** The compiler comes from CMake's own record of the last configure
  (`CMakeFiles/<version>/CMakeCXXCompiler.cmake`), before a configure from the kit. GCC
  prefers GDB, Clang prefers LLDB (then GDB), Clang for the MSVC ABI only LLDB. An adapter is
  looked for next to the compiler (MinGW ships `gdb.exe` beside `g++.exe`), on the kit's and
  Tessera's `PATH`, then in known install folders. **Debug: Select Debugger** fixes GDB or
  LLDB for the project or picks a program in a native dialog; the choice is kept per project
  in app data.
- **MSVC.** A program built by MSVC (`CMAKE_CXX_COMPILER_ID` MSVC) is refused before any
  build, with that reason; MSVC builds keep working.
- **Debug = build, then debug.** Debug builds the run target (the CMake launch target shared
  with Run) and never configures, and does not ask to. A failed build stops there (Output →
  CMake). Non-executable targets are refused. **Restart** stops the session and debugs again,
  building first, the same way (GDB's DAP has no restart request).
- **One session** in the whole application, enforced in Rust; Debug while one runs says to
  stop it first.
- **Trust boundary.** Rust builds the `launch` request (CMake's program, Run's arguments and
  folder, the target's `debug.json` entry, the kit's environment over Tessera's). The
  renderer may send only the requests the UI needs (initialize, breakpoints, configuration
  done, threads, stack, scopes, variables, set variable, evaluate, continue, step, pause,
  disconnect, terminate, cancel); `launch`, `attach`, reverse requests and `evaluate` in the
  `repl` context (GDB and LLDB commands such as `shell`) are rejected. The Debug Console
  therefore evaluates expressions, not debugger commands.
- **Breakpoints** live in a gutter left of the diagnostics markers: click toggles, right-click
  adds a conditional, hit count or logpoint, or edits/disables/removes. They follow typing
  (two that meet merge), are kept per project root in `debug-state.json` (app data) with the
  watch list and "Deactivate Breakpoints", and survive sessions and restarts. The adapter's
  `verified` answer and message show in the gutter and the Breakpoints list. A breakpoint
  needing an ability the adapter lacks (conditions, hit counts, logpoints) is not set at all
  and says why — never set as a plain breakpoint.
- **Hit count** means "stop from the Nth hit on" (a positive number). GDB's DAP takes the
  number as an ignore count, so N − 1 is sent; lldb-dap ignores N − 1 hits itself, so N is
  sent. (Checked with GDB 16.3; lldb-dap's side is from its source, not run here.)
- **Variables, Watch, Hover** read children lazily by reference; containers announcing more
  than 100 indexed children are paged ("Show more"). Expansion is kept by the row's path of
  names across steps. Set Value (double-click) uses `setVariable` where supported. While the
  program runs, no frame, variable or watch value is shown; Watch says "not available".
- **Output split.** The program's stdout/stderr (DAP `output` events) go to an output-only
  terminal session (xterm, Tessera's terminal runtime) in the bottom panel's Run place,
  titled `Debug: <target>`; adapter messages, logpoints and evaluation results go to the
  Debug Console; CMake to Output → CMake. GDB's DAP gives the program `/dev/null` as stdin and
  reports its own messages on the same stream as the program, so they appear in the program
  output too. Tessera does not offer `runInTerminal`, which would mean running a command the
  adapter names; interactive program input is therefore not available in V0.8.
- **`.tessera/debug.json`** (project root, optional, version 1): per target `args`, `cwd`,
  `env`; strict JSON (unknown fields and other versions are errors), variables
  `${workspaceFolder}`, `${sourceDir}`, `${buildDir}`, `${env:NAME}` (any other is an
  error), relative `cwd` from the project root. Fields a target leaves out keep Run's
  arguments and folder. The executable is never written there. This is the one file the IDE
  writes into a repository — the plan's explicit choice, so a team can share it; personal
  state stays in app data. The visual editor (⚙ in Run and Debug) replaces one target's entry
  atomically, never rewrites a file that does not parse, and refuses while an editor holds
  unsaved changes to it.
- **Session end** hides the toolbar and paused line, clears frames, variables and watch
  values, and keeps the Run and Debug view, breakpoints, watch list and the Debug Console
  history (cleared by the next session or Clear). An adapter that exits unexpectedly ends the
  session with its last stderr lines in the console.
- **No shortcuts** were designed (the plan says so): every action is a `Debug: …` palette
  command, a toolbar or view button, or in the gutter and editor menus.

## Not verified natively

The Rust test drives this machine's GDB 16.3 (MinGW) over DAP: line, conditional and hit count
breakpoints, a logpoint, a pretty-printed `std::vector`, evaluation, the program's output and
exit. lldb-dap, Linux, and the desktop app's UI (gutter, toolbar, hover, console against a
real adapter) were not exercised in Tauri; see
[VALIDATION](../VALIDATION.md#v08-debugging-qualification).
