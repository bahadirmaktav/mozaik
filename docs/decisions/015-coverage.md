# 015: Coverage view

Status: accepted (ninth review). The user asked for an activity bar view that shows the
coverage output their CMake coverage targets write into the build folder, file by file and
line by line, with the sources opened read only. Coverage left the excluded features of
[decision 013](013-testing.md); collecting or merging coverage stays out.

## What exists

| Part    | Where                              | Notes                                                   |
| ------- | ---------------------------------- | ------------------------------------------------------- |
| Native  | `src-tauri/src/coverage.rs`        | Dialog, chosen path per project (`coverage.json`), read |
| Model   | `src/plugins/ide/coverageModel.ts` | LCOV and Cobertura, totals, line states, folder tree    |
| State   | `src/plugins/ide/coverage.ts`      | Report per project, reload on change, stale files, tabs |
| View    | `src/plugins/ide/CoverageView.tsx` | Activity bar **Coverage** (pie icon)                    |
| Tab     | `src/plugins/ide/CoverageFile.tsx` | One file, read only, among the code editors             |
| Adapter | `src/services/coverage.ts`         | `choose`, `report`, `forget`, `modified`                |

## Decisions

- **Mozaik reads a report; it runs no coverage tool.** Coverage needs an instrumented build,
  a test run and a tool that turns counters into a report (gcovr, llvm-cov, lcov,
  OpenCppCoverage), all project specific. The user's CMake target already does that (the
  build runs it like any target); Mozaik only reads the file it writes. Running gcov or
  llvm-cov from Mozaik would add processes the renderer cannot name and tool detection per
  compiler for no gain over a target the project owns.
- **Formats: LCOV and Cobertura**, chosen by content. Every common tool writes one of them
  (gcovr `--lcov`/`--cobertura`, `llvm-cov export -format=lcov`, lcov, OpenCppCoverage
  `cobertura`), so GCC, Clang and MSVC projects are covered. Records of the same file add up
  (several test programs in one LCOV file). Relative file names resolve against Cobertura's
  `<source>`, else the project root. A report is at most 64 MB and UTF-8.
- **Chosen once per project in a native dialog.** Rust keeps the path in app data, never in
  the repository; the renderer never names the file. The view reads it again when it is first
  shown in a session and whenever the file changes on disk (the report's folder is watched),
  so rebuilding the coverage target refreshes the view. Close Report forgets it; the file
  stays. Looking for reports in the build folder by name was left out: names and places
  differ per project, and one dialog is cheap.
- **Source files are read from disk into a read-only tab**, as the user suggested, rather than
  colouring the code editor: the code tab is for editing, and colours there would go stale
  with the first keystroke. The tab colours covered lines green, partly covered ones (some
  branches never taken) yellow and uncovered ones red, with hit counts in the gutter, ↑/↓ to
  the previous/next line that is not fully covered, and **Open in Editor** for the code tab
  at that line. A file whose modification time is newer than the report's is marked ● in the
  view and warned about in its tab, since its lines may have moved.
- **Totals**: lines are the report's executable lines; functions and branches only when the
  report has them. The view's tree compacts single-child folders and puts files outside the
  project (system headers, when a report includes them) in a folder of their own path.

## Considered alternatives

- Colouring the code editor (an overlay toggled from the view): useful while editing, but
  needs line tracking through edits; the read-only tab answers "what did the tests reach" and
  can gain an overlay later.
- An embedded HTML report (gcovr `--html-details`): every tool's HTML differs, would need a
  frame and scripts in the renderer, and cannot open the code.

## Not verified natively

The parsers are unit tested with LCOV (lcov 1 and 2 function records) and gcovr-style
Cobertura samples; the view and tab are browser-tested with a scripted backend. A real
gcovr report of debug-playground in the desktop app is
[VALIDATION](../VALIDATION.md#v08-debugging-qualification) item 77.
