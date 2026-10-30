import { useState } from "react";
import {
  ContinueIcon,
  DebugIcon,
  RestartIcon,
  StopIcon,
} from "../../components/Icons";
import type { TestInfo } from "../../services/cmake";
import { host } from "./editors";
import { useSectionState } from "./Sections";
import {
  cancelTests,
  debugTest,
  discoverTests,
  revealTest,
  runTests,
  useTesting,
} from "./testing";
import {
  groupStatus,
  groupTests,
  tally,
  type TestResult,
  type TestStatus,
} from "./testModel";
import type { Project } from "./projects";

const GLYPHS: Record<TestStatus, string> = {
  passed: "✓",
  failed: "✗",
  skipped: "⊘",
  running: "↻",
  queued: "○",
};
const STATUS_NAMES: Record<TestStatus, string> = {
  passed: "Passed",
  failed: "Failed",
  skipped: "Skipped",
  running: "Running",
  queued: "Queued",
};
function Status({ status }: { status: TestStatus | undefined }) {
  return (
    <span
      className={`testing-status ${status ?? "none"}`}
      role="img"
      aria-label={status ? STATUS_NAMES[status] : "Not run"}
    >
      {status ? GLYPHS[status] : "○"}
    </span>
  );
}

/**
 * The tests of the project's CMake build folder, after VS Code's Testing view: by program
 * and GoogleTest suite (a TEST_F's fixture), each run alone or together, a test debugged
 * alone, and a failed test's output under the list. Double-click opens a test's code.
 */
export function Testing({ project }: { project: Project }) {
  const state = useTesting(project.id);
  const { closed, toggle } = useSectionState(project, "testing");
  const [selected, setSelected] = useState<string | null>(null);
  const report = (e: unknown) => host().report(e);
  const run = (names: string[] | null) =>
    void runTests(project.id, names).catch(report);
  const tests = state.tests ?? [];
  const status = (name: string) => state.results.get(name)?.status;
  const count = tally(state.results, tests);
  const busy = !!state.busy;
  const chosen: TestResult | undefined = selected
    ? state.results.get(selected)
    : undefined;
  const actions = (names: string[], label: string, test?: TestInfo) => (
    <span className="testing-actions">
      <button
        type="button"
        aria-label={`Run ${label}`}
        title="Run"
        disabled={busy}
        onClick={() => run(names)}
      >
        <ContinueIcon />
      </button>
      {test && (
        <button
          type="button"
          aria-label={`Debug ${label}`}
          title="Debug"
          disabled={busy || !test.target}
          onClick={() => void debugTest(project.id, test)?.catch(report)}
        >
          <DebugIcon />
        </button>
      )}
    </span>
  );
  return (
    <div className="todo-view testing-view">
      <div className="todo-bar">
        <span className="muted">
          {state.busy === "discovering"
            ? "Looking for tests…"
            : state.busy === "building"
              ? "Building…"
              : state.busy === "running"
                ? "Running tests…"
                : state.tests
                  ? [
                      `${tests.length} test${tests.length === 1 ? "" : "s"}`,
                      count.passed && `${count.passed} passed`,
                      count.failed && `${count.failed} failed`,
                      count.skipped && `${count.skipped} skipped`,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : ""}
        </span>
        <button
          type="button"
          aria-label="Run All Tests"
          title="Run All Tests"
          disabled={busy}
          onClick={() => run(null)}
        >
          <ContinueIcon />
        </button>
        {state.busy === "running" ? (
          <button
            type="button"
            aria-label="Cancel Test Run"
            title="Cancel Test Run"
            onClick={() => cancelTests(project.id)}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Refresh Tests"
            title="Refresh Tests"
            disabled={busy}
            onClick={() => void discoverTests(project.id)}
          >
            <RestartIcon />
          </button>
        )}
      </div>
      {state.error && (
        <p className="project-error" role="alert">
          {state.error}
        </p>
      )}
      {!state.tests && !busy && (
        <div className="project-hint">
          <p>
            Tests come from CTest in the configured build folder (add_test,
            GoogleTest&apos;s gtest_discover_tests).
          </p>
          <button
            type="button"
            className="project-open"
            onClick={() => void discoverTests(project.id)}
          >
            Find Tests
          </button>
        </div>
      )}
      {state.tests && !tests.length && !busy && (
        <p className="project-hint">
          CTest knows no tests in this build folder. Build the test programs,
          then refresh.
        </p>
      )}
      <ul className="todo-list testing-list" aria-label="Tests">
        {groupTests(tests).map((program) => {
          const programId = `program:${program.target ?? ""}`;
          const programTests = program.suites.flatMap((s) =>
            s.tests.map((t) => t.test.name),
          );
          const open = !closed.has(programId);
          const label = program.target ?? "Other tests";
          return (
            <li key={programId}>
              <div className="testing-row">
                <button
                  type="button"
                  className="todo-group"
                  aria-expanded={open}
                  onClick={() => toggle(programId)}
                >
                  <span className="project-twisty" aria-hidden>
                    {open ? "▾" : "▸"}
                  </span>
                  <Status status={groupStatus(programTests.map(status))} />
                  <span className="todo-group-name">{label}</span>
                  <span className="project-count">{programTests.length}</span>
                </button>
                {actions(programTests, label)}
              </div>
              {open && (
                <ul>
                  {program.suites.map((suite) => {
                    const suiteId = `suite:${program.target ?? ""}:${suite.name}`;
                    const names = suite.tests.map((t) => t.test.name);
                    const suiteOpen = !closed.has(suiteId);
                    const rows = suite.tests.map(({ test, label }) => (
                      <li key={test.name}>
                        <div
                          className={`testing-row${selected === test.name ? " selected" : ""}`}
                        >
                          <button
                            type="button"
                            className="todo-item testing-test"
                            title={`${test.name}${test.disabled ? " (disabled)" : ""}${state.results.get(test.name)?.detail ? ` · ${state.results.get(test.name)!.detail}` : ""}`}
                            aria-pressed={selected === test.name}
                            onClick={() => setSelected(test.name)}
                            onDoubleClick={() =>
                              void revealTest(project.id, test.name).catch(
                                report,
                              )
                            }
                          >
                            <Status status={status(test.name)} />
                            <span
                              className={`todo-text${test.disabled ? " muted" : ""}`}
                            >
                              {label}
                            </span>
                            {state.results.get(test.name)?.seconds !==
                              undefined && (
                              <span className="todo-place">
                                {state.results.get(test.name)!.seconds} s
                              </span>
                            )}
                          </button>
                          {actions([test.name], test.name, test)}
                        </div>
                      </li>
                    ));
                    // Tests outside a GoogleTest suite sit directly under their program.
                    if (!suite.name) return rows;
                    return (
                      <li key={suiteId}>
                        <div className="testing-row">
                          <button
                            type="button"
                            className="todo-group testing-suite"
                            aria-expanded={suiteOpen}
                            onClick={() => toggle(suiteId)}
                          >
                            <span className="project-twisty" aria-hidden>
                              {suiteOpen ? "▾" : "▸"}
                            </span>
                            <Status status={groupStatus(names.map(status))} />
                            <span className="todo-group-name">
                              {suite.name}
                            </span>
                            <span className="project-count">
                              {names.length}
                            </span>
                          </button>
                          {actions(names, suite.name)}
                        </div>
                        {suiteOpen && (
                          <ul className="testing-suite-tests">{rows}</ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {selected && chosen && (
        <div className="testing-result">
          <div className="testing-result-title">
            <Status status={chosen.status} />
            <span>{selected}</span>
            {chosen.detail && <span className="muted">{chosen.detail}</span>}
          </div>
          {chosen.output?.trim() && (
            <pre aria-label="Test output">{chosen.output.trim()}</pre>
          )}
        </div>
      )}
    </div>
  );
}
