import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import {
  ClearAllIcon,
  CollapseAllIcon,
  ContinueIcon,
  DebugIcon,
  RestartIcon,
  StopIcon,
} from "../../components/Icons";
import type { TestInfo } from "../../services/cmake";
import {
  emptySelection,
  retain,
  select,
  type Selection,
} from "../file-manager/model";
import { matches } from "../../workspace/keybindings";
import { host } from "./editors";
import { useSectionState } from "./Sections";
import {
  cancelTests,
  clearResults,
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

// After VS Code's test icons: a green check, a red cross, a grey slash.
const GLYPHS: Record<TestStatus | "none", ReactNode> = {
  passed: <path d="M3 6.2l2 2 4-4.4" />,
  failed: (
    <>
      <circle cx="6" cy="6" r="5.5" fill="currentColor" stroke="none" />
      <path d="M4 4l4 4M8 4l-4 4" stroke="var(--surface)" />
    </>
  ),
  skipped: (
    <>
      <circle cx="6" cy="6" r="4.5" />
      <path d="M3 9l6-6" />
    </>
  ),
  running: <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" />,
  queued: <circle cx="6" cy="6" r="2" fill="currentColor" stroke="none" />,
  none: <circle cx="6" cy="6" r="4.5" />,
};
/** A suite row's key in the selection, beside the tests' names. */
const SUITE = "\u0001suite:";
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
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        aria-hidden="true"
      >
        {GLYPHS[status ?? "none"]}
      </svg>
    </span>
  );
}

/**
 * The tests of the project's CMake build folder, after VS Code's Testing view: by GoogleTest
 * suite (a TEST_F's fixture), each run alone or together, a test debugged alone, and a failed
 * test's output under the list. Double-click opens a test's code. Showing the view lists the
 * tests until CTest has answered once; ↻ lists them again. Ctrl and Shift mark several suites
 * and tests, as in the Explorer: a marked row's Run runs every marked test, a marked suite's
 * tests all.
 */
export function Testing({ project }: { project: Project }) {
  const state = useTesting(project.id);
  const { closed, toggle, setClosed } = useSectionState(project, "testing");
  const [marks, setMarks] = useState<Selection>(emptySelection);
  const listed = state.tests !== null;
  useEffect(() => {
    if (!listed) void discoverTests(project.id);
  }, [project.id, listed]);
  const report = (e: unknown) => host().report(e);
  const run = (names: string[] | null) =>
    void runTests(project.id, names).catch(report);
  const tests = state.tests ?? [];
  const status = (name: string) => state.results.get(name)?.status;
  const count = tally(state.results, tests);
  const busy = !!state.busy;
  const suites = groupTests(tests);
  const suiteIds = suites.filter((s) => s.name).map((s) => `suite:${s.name}`);
  const allClosed =
    suiteIds.length > 0 && suiteIds.every((id) => closed.has(id));
  // The rows in view, suites and tests, in their order: what Shift marks a range of.
  const order = suites.flatMap((suite) => {
    const names = suite.tests.map((t) => t.test.name);
    if (!suite.name) return names;
    const key = SUITE + suite.name;
    return closed.has(`suite:${suite.name}`) ? [key] : [key, ...names];
  });
  const selection = retain(marks, order);
  const selected = selection.cursor;
  const markedRows = order.filter((key) => selection.paths.has(key));
  // The marked tests, in the list's order; a marked suite stands for all its tests.
  const markedNames = suites.flatMap((suite) => {
    const names = suite.tests.map((t) => t.test.name);
    return suite.name && selection.paths.has(SUITE + suite.name)
      ? names
      : names.filter((name) => selection.paths.has(name));
  });
  const chosen: TestResult | undefined = selected
    ? state.results.get(selected)
    : undefined;
  /** A marked row's Run runs every marked test; another row's runs its own. */
  const together = (key: string) =>
    selection.paths.has(key) && markedRows.length > 1;
  const pick = (key: string, event: MouseEvent) =>
    setMarks(
      select(selection, order, key, {
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
      }),
    );
  const actions = (
    key: string,
    names: string[],
    label: string,
    test?: TestInfo,
  ) => (
    <span className="testing-actions">
      <button
        type="button"
        aria-label={
          together(key)
            ? `Run ${markedNames.length} Selected Tests`
            : `Run ${label}`
        }
        title="Run"
        disabled={busy}
        onClick={() => run(together(key) ? markedNames : names)}
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
        {markedRows.length > 1 && (
          <button
            type="button"
            className="testing-run-selected"
            aria-label="Run Selected Tests"
            title={`Run the ${markedNames.length} selected tests`}
            disabled={busy}
            onClick={() => run(markedNames)}
          >
            <ContinueIcon />
            <span>{markedNames.length}</span>
          </button>
        )}
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
        <button
          type="button"
          aria-label={allClosed ? "Expand All" : "Collapse All"}
          title={allClosed ? "Expand All" : "Collapse All"}
          disabled={!suiteIds.length}
          onClick={() =>
            setClosed(
              allClosed
                ? [...closed].filter((id) => !suiteIds.includes(id))
                : [...closed, ...suiteIds],
            )
          }
        >
          <CollapseAllIcon />
        </button>
        <button
          type="button"
          aria-label="Clear All Results"
          title="Clear All Results"
          disabled={busy || !state.results.size}
          onClick={() => {
            clearResults(project.id);
            setMarks(emptySelection());
          }}
        >
          <ClearAllIcon />
        </button>
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
      <ul
        className="todo-list testing-list"
        aria-label="Tests"
        onKeyDown={(event) => {
          if (matches(event.nativeEvent, "explorer.all") && order.length) {
            event.preventDefault();
            setMarks({
              paths: new Set(order),
              anchor: order[0],
              cursor: selection.cursor ?? order[0],
            });
          } else if (event.key === "Escape" && selection.paths.size > 1) {
            event.preventDefault();
            setMarks(
              selection.cursor
                ? select(selection, order, selection.cursor, {})
                : emptySelection(),
            );
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const at = selected ? order.indexOf(selected) : -1;
            const step = event.key === "ArrowDown" ? 1 : -1;
            const index = Math.max(0, Math.min(order.length - 1, at + step));
            const next = order[index];
            if (!next) return;
            event.preventDefault();
            setMarks(select(selection, order, next, { shift: event.shiftKey }));
            // The rows' buttons are in the order's order.
            event.currentTarget
              .querySelectorAll<HTMLElement>(".todo-group, .testing-test")
              [index]?.focus();
          } else if (
            (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
            selected?.startsWith(SUITE)
          ) {
            // As in a tree: Right opens the suite under the cursor, Left folds it.
            const id = `suite:${selected.slice(SUITE.length)}`;
            if (closed.has(id) === (event.key === "ArrowRight")) {
              event.preventDefault();
              toggle(id);
            }
          }
        }}
      >
        {suites.map((suite) => {
          const suiteId = `suite:${suite.name}`;
          const names = suite.tests.map((t) => t.test.name);
          const open = !closed.has(suiteId);
          const rows = suite.tests.map(({ test, label }) => (
            <li key={test.name} data-test={test.name}>
              <div
                className={`testing-row${selection.paths.has(test.name) ? " selected" : ""}`}
              >
                <button
                  type="button"
                  className="todo-item testing-test"
                  title={`${test.name}${test.target ? ` (${test.target})` : ""}${test.disabled ? " (disabled)" : ""}${state.results.get(test.name)?.detail ? ` · ${state.results.get(test.name)!.detail}` : ""}`}
                  aria-pressed={selection.paths.has(test.name)}
                  onClick={(event) => pick(test.name, event)}
                  onDoubleClick={() =>
                    void revealTest(project.id, test.name).catch(report)
                  }
                >
                  <Status status={status(test.name)} />
                  <span className={`todo-text${test.disabled ? " muted" : ""}`}>
                    {label}
                  </span>
                  {state.results.get(test.name)?.seconds !== undefined && (
                    <span className="todo-place">
                      {state.results.get(test.name)!.seconds} s
                    </span>
                  )}
                </button>
                {actions(test.name, [test.name], test.name, test)}
              </div>
            </li>
          ));
          // Tests outside a GoogleTest suite (plain add_test) sit at the top level.
          if (!suite.name) return rows;
          const key = SUITE + suite.name;
          return (
            <li key={suiteId}>
              <div
                className={`testing-row${selection.paths.has(key) ? " selected" : ""}`}
              >
                <button
                  type="button"
                  className="todo-group"
                  aria-expanded={open}
                  aria-pressed={selection.paths.has(key)}
                  onClick={(event) => {
                    // A suite is marked as a test is; a plain click also opens or folds it.
                    pick(key, event);
                    if (!(event.ctrlKey || event.metaKey || event.shiftKey))
                      toggle(suiteId);
                  }}
                >
                  <span className="project-twisty" aria-hidden>
                    {open ? "▾" : "▸"}
                  </span>
                  <Status status={groupStatus(names.map(status))} />
                  <span className="todo-group-name">{suite.name}</span>
                  <span className="project-count">{names.length}</span>
                </button>
                {actions(key, names, suite.name)}
              </div>
              {open && <ul>{rows}</ul>}
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
