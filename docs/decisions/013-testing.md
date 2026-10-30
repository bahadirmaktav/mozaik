# 013: Testing view (CTest)

Status: accepted (eighth V0.7 review). The user asked for a Testing view like VS Code's,
with tests grouped by GoogleTest suite and fixture, run alone or together, and a test
debugged alone, ahead of a planned test runner/debugger. So CTest left the excluded features
of [decision 011](011-cmake.md); other test frameworks' adapters, test history and continuous
runs stay out (coverage reports are read since [decision 015](015-coverage.md)).

## What exists

| Part   | Where                                      | Notes                                                        |
| ------ | ------------------------------------------ | ------------------------------------------------------------ |
| CTest  | `src-tauri/src/cmake/ctest.rs`             | `ctest` beside the CMake program, in the active build folder |
| Model  | `src/plugins/ide/testModel.ts`             | Grouping, CTest output → results, definition search          |
| State  | `src/plugins/ide/testing.ts`               | Per project: tests, results, discovering/building/running    |
| View   | `src/plugins/ide/TestingView.tsx`          | Activity bar **Testing** (flask icon)                        |
| Debug  | `debug.ts` `startDebugging(project, test)` | `debug_launch` takes the test's arguments                    |
| Output | `channels.ts`                              | **Output → Tests**                                           |

## Decisions

- **CTest is the source of tests.** `ctest --show-only=json-v1` lists what the build folder
  registered: plain `add_test` and GoogleTest's `gtest_discover_tests` (its `PRE_TEST` mode
  runs the test programs with `--gtest_list_tests` while listing). Mozaik parses no source
  and runs no program to find tests itself. A test belongs to the executable target whose
  File API artifact is its command's program.
- **Listed when the view is shown, run when asked.** Showing the Testing view lists the
  tests until CTest has answered once (ninth review: the user asked not to press Find Tests);
  ↻ (Refresh Tests) lists them again. Tests run only from ▶ and `Test: …` palette commands.
  Nothing lists or runs tests when a project opens, a build ends or a file changes. Both steps use the CMake job of the project and window, so a build and a
  test run never overlap and Cancel ends the whole process tree.
- **Grouping**: the GoogleTest suite from the test name `Suite.Test` (a `TEST_F`'s suite is
  its fixture; a `TEST_P`'s is `Prefix/Suite` with `Test/(params)`), then tests. The test
  program is not a level (ninth review: suites already separate the tests; a test's tooltip
  names its program). Names without a dot sit at the top level. CTest's order is kept.
- **Running**: a test, a suite or all. Chosen tests go to CTest as one exact
  `-R ^(name|…)$` filter (escaped; under Windows' command-line limit, otherwise "run them
  all"); all tests run without a filter. When Workspace Settings → IDE → "Build the target
  before Run" is set (default), the tests' program is built first, or everything when they
  span several programs. `--output-on-failure` and multi-config `-C <variant>` are passed.
- **Results** come from CTest's output lines (`Start n: name`, `i/n Test #n: name …
Passed|***Failed|Not Run (Disabled)|Skipped|***Exception…  0.01 sec`), not from a report
  file. Names may hold spaces and parentheses (value-parameterized tests). The lines CTest
  prints after a failed test are that test's output, shown under the list when the test is
  selected. Tests that did not run (cancelled, a CTest error) show their earlier result.
  A failed test shows a red cross, a skipped one (`GTEST_SKIP`, `DISABLED_` or the `DISABLED`
  property) a grey slashed circle; `Not Run` without a reason (a missing program) failed.
- **Debug a test**: only a test of one of the project's executable targets. The program is
  built, then debugged with the test's own CTest arguments in place of the target's
  (`--gtest_filter=…` and `--gtest_also_run_disabled_tests` from `gtest_discover_tests`), so
  a disabled test can be debugged. The working folder and environment are the target's
  (Project Settings, `.mozaik/debug.json`); Restart keeps the test.
- **Go to a test**: double-click searches the project for its `TEST`/`TEST_F`/`TEST_P`/typed
  test line (without a parameterized test's prefix and parameter) and opens the first match.
  CTest reports no source locations.

## Not verified natively

The Rust tests list and run a real CTest project with this machine's MinGW GCC and CMake 4.1
(an exact filter with parentheses, a disabled test, a failure). The view, the build-first
run, debugging a test with GDB and going to a test are browser-tested with a scripted CTest
and debugger only ([VALIDATION](../VALIDATION.md#v08-debugging-qualification) item 76).
