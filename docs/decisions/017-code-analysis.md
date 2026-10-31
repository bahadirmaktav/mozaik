# 017 — Code analysis: clang-tidy, and SonarLint deferred

Status: accepted (2026-10-31). Specification: `.plans/Mozaik_Code_Quality_Integration_Plan.md`.

## Context

The plan adds static analysis to the IDE in three stages: clang-tidy (live in clangd and as a
program on one file or the whole project), then an optional standalone SonarLint behind a
feasibility gate, then shared result handling (grouping, filters, stale results). It reuses
the IDE's clangd, CMake, Problems and Output instead of a separate Code Quality module.

## Decisions

### Stage 1 — clang-tidy

- **Live checks.** clangd starts with `--clang-tidy` (or `--clang-tidy=false` when the
  setting is off), so the checks of the project's `.clang-tidy` / `.clangd` appear while
  editing with the source `clang-tidy` and the check name as code. Mozaik never writes those
  files. clangd's code actions (Quick Fix…) already offer their fixes.
- **Runs** (`src-tauri/src/analysis.rs`). `Analysis: Run Current File` and
  `Analysis: Run Entire Project` start `clang-tidy -p <build> --export-fixes=<cache file>
<file>` per file, built in Rust as an argument list (no shell). The build folder is the one
  the project's CMake choices resolve to (kit or preset, variant, build folder template); its
  `compile_commands.json` must exist. Without it the run fails with an explanation; nothing
  configures the project. A project run takes the database's unique files inside the project
  and outside the build folder. The kit's environment (Visual Studio's variables) applies.
- **Processes.** Each file is one process on `cmake::jobs::Jobs` (a cancellable process tree,
  hidden console). `maxParallelJobs` (default 2, 1–16) workers share the file list.
  `Analysis: Cancel` and the status bar's ✕ stop the run and its processes; closing the
  window or the app does too. One analysis per project and window.
- **Results.** The fixes file (machine-readable YAML) is the source of findings: rule, level,
  message, notes and replacements. Byte offsets become protocol positions (UTF-16 columns,
  without a UTF-8 BOM). A small reader handles exactly LLVM's YAML output (block maps and
  lists, plain, single- and double-quoted scalars); when the file is missing or unreadable the
  text output (`file:line:col: warning: … [check]`) is the fallback, without fixes. The YAML
  goes to the app's cache folder and is deleted after reading. At most 1000 findings per file.
- **Scope and staleness.** A file run replaces that file's findings, a project run all of the
  project's (also when cancelled: old results are gone, the files done so far stay). Findings
  are marked stale when the document's text differs from the text they were found in (an
  unsaved edit counts), or when the project's build folder is no longer the one they used.
- **Fixes.** A finding with replacements has **Fix…** in Problems; `Analysis: Apply Fixes in
Current File` combines a file's fixes and leaves out any that touches an earlier one. Both
  show a diff preview first. Nothing applies when a target file has unsaved changes or its
  SHA-256 differs from the analyzed text (`analysis_check`). Applying uses the IDE's workspace
  edit: open files change in their editors (undoable, unsaved), closed files are written after
  confirmation with a revision check. Stale findings offer no fix.
- **Program.** A program chosen in a native dialog wins, else `PATH`, the usual LLVM folders,
  then the folder of the clangd in use. Settings show its path and `--version`. Mozaik
  downloads nothing.
- **Settings** (app config `analysis.json`, Workspace Settings → IDE → Code Analysis):
  clang-tidy checks on/off, parallel analyses, analyze on save. `autoAnalysis` defaults to
  **off**, not the plan's `onSave`: clangd already checks open files live, and Mozaik runs no
  tool on its own unless the user chose it. With "The saved file" only the saved C/C++ file of
  a project is analyzed after its save; a project is never analyzed automatically.

### Stage 2 — SonarLint: not shipped (gate not passed)

The plan makes a working, offline, standalone C/C++ prototype a precondition: the language
server version and its non-standard JSON-RPC messages, a Java runtime on Windows and Linux,
and the CFamily analyzer's availability, licence and redistribution terms, with a real finding
returned without a server. None of that could be verified here: the C/C++ (CFamily) analyzer
comes with SonarSource's own IDE extensions under SonarSource's terms, whether it may be used
or redistributed with another client could not be confirmed, and no installation was
available to run a prototype. Following the plan's go/no-go clause, there is no
SonarLint setting, command or process; clang-tidy ships on its own. Revisit only with a
documented prototype and a licence review.

### Stage 3 — shared handling

- Problems lists clangd, live clang-tidy, clang-tidy runs and CMake build problems together.
  Items at the same place with the same rule and message are one row naming every source
  (`clang-tidy (live) · clang-tidy (run)`); a grouped row is stale only when every report is.
  Nothing else is merged.
- Problems has a filter: words over message, rule and file; source; severity. It is kept per
  project while the bottom panel switches views.
- Output → **Analysis** holds each command line and clang-tidy's output; the status bar shows
  `clang-tidy n/m` with ✕ while running, then current, stale, cancelled or failed.
- Closing a project drops its findings and cancels its run.

## Not done (with reasons)

- Editor decorations for findings of runs: clangd shows the live clang-tidy findings in the
  editor already; runs are in Problems, which navigates to them.
- Measured limits on large projects and the native test matrix (Windows MinGW, Linux GCC and
  Clang) are open; see `docs/VALIDATION.md`.
- SonarQube/SonarCloud, Connected Mode, `.sonarlint` bindings, other analyzers: out of scope.
