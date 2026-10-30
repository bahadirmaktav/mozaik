import { useSyncExternalStore } from "react";
import { cmakeBackend, type TestInfo } from "../../services/cmake";
import { ideBackend } from "../../services/ide";
import { appendOutput } from "./channels";
import {
  activeProject,
  build,
  buildAll,
  cmakeInfo,
  loadSettings,
  refresh as refreshCMake,
} from "./cmake";
import { startDebugging } from "./debug";
import { host, message, reveal } from "./editors";
import { getProject } from "./projects";
import { definitionPattern, ResultReader, type TestResult } from "./testModel";

/**
 * The Testing view's state, after VS Code's Testing view over CMake Tools' CTest: the tests
 * of the active build folder, found and run only when the user asks, with their results.
 */
interface State {
  /** null until the user looks for tests. */
  tests: TestInfo[] | null;
  results: Map<string, TestResult>;
  busy: "discovering" | "building" | "running" | null;
  error: string | null;
}
interface Store {
  projects: Map<string, State>;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideTesting ?? {
  projects: new Map(),
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideTesting = store;

function emit() {
  store.version++;
  store.listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => {
    store.listeners.delete(fn);
  };
}
const empty: State = {
  tests: null,
  results: new Map(),
  busy: null,
  error: null,
};
const stateOf = (id: string) => store.projects.get(id) ?? empty;
export function useTesting(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return stateOf(id);
}
function update(id: string, change: Partial<State>) {
  store.projects.set(id, { ...stateOf(id), ...change });
  emit();
}
function setResults(
  id: string,
  change: (results: Map<string, TestResult>) => void,
) {
  const results = new Map(stateOf(id).results);
  change(results);
  update(id, { results });
}

/** A configured CMake project's root, or a reason it has no tests yet. */
async function configured(id: string) {
  const root = getProject(id)?.root;
  if (!root) throw new Error("Open a CMake project to test it");
  if (!cmakeInfo(id)) await refreshCMake(id);
  const info = cmakeInfo(id);
  if (!info?.cmake)
    throw new Error(
      "This project has no CMakeLists.txt (see Project Settings)",
    );
  if (!info.targets)
    throw new Error(
      "Configure the project (CMake: Configure) to find its tests",
    );
  return root;
}

/** Lists the tests CTest knows; GoogleTest's discovery may run the test programs. */
export async function discoverTests(id: string) {
  if (stateOf(id).busy) return;
  update(id, { busy: "discovering", error: null });
  try {
    const root = await configured(id);
    const tests = await cmakeBackend.tests(root);
    const names = new Set(tests.map((t) => t.name));
    const results = new Map(
      [...stateOf(id).results].filter(([name]) => names.has(name)),
    );
    update(id, { tests, results, busy: null });
  } catch (e) {
    update(id, { busy: null, error: message(e) });
  }
}

/**
 * Runs the named tests (all without names): builds their programs first when Workspace
 * Settings ask to build before Run, then CTest, its output in Output → Tests.
 */
export async function runTests(id: string, names: string[] | null = null) {
  if (stateOf(id).busy)
    return host().report("The tests are already running for this project");
  let root: string;
  try {
    root = await configured(id);
    if (!stateOf(id).tests) await discoverTests(id);
  } catch (e) {
    return update(id, { error: message(e) });
  }
  const tests = stateOf(id).tests ?? [];
  const chosen = names ? tests.filter((t) => names.includes(t.name)) : tests;
  const before = stateOf(id).results;
  setResults(id, (results) => {
    for (const test of chosen) results.set(test.name, { status: "queued" });
  });
  const settings = await loadSettings().catch(() => null);
  if (settings?.settings.buildBeforeRun !== false) {
    update(id, { busy: "building", error: null });
    const targets = [
      ...new Set(chosen.map((t) => t.target).filter((t) => t !== null)),
    ];
    const built =
      targets.length === 1 ? await build(id, targets[0]) : await buildAll(id);
    if (!built) {
      update(id, {
        busy: null,
        results: before,
        error:
          "The build did not succeed, so the tests did not run (Output → CMake)",
      });
      return;
    }
  }
  update(id, { busy: "running", error: null });
  host().showPanel(root, "output", "Tests");
  const reader = new ResultReader();
  const apply = (text: string, end = false) => {
    appendOutput("Tests", text);
    const events = reader.push(text, end);
    if (!events.length) return;
    setResults(id, (results) => {
      for (const event of events) {
        const current = results.get(event.name);
        if (event.kind === "start")
          results.set(event.name, { status: "running" });
        else if (event.kind === "result")
          results.set(event.name, {
            status: event.status,
            seconds: event.seconds,
            detail: event.detail,
          });
        else if (current)
          results.set(event.name, {
            ...current,
            output: (current.output ? `${current.output}\n` : "") + event.line,
          });
      }
    });
  };
  try {
    await cmakeBackend.test(
      root,
      names && chosen.length < tests.length ? chosen.map((t) => t.name) : null,
      (text) => apply(text),
    );
    apply("", true);
  } catch (e) {
    appendOutput("Tests", `[error] ${message(e)}\n`);
    update(id, { error: message(e) });
  } finally {
    // Tests that never ran (cancelled, a CTest error) show their earlier result again.
    setResults(id, (results) => {
      for (const test of chosen) {
        const status = results.get(test.name)?.status;
        if (status !== "queued" && status !== "running") continue;
        const earlier = before.get(test.name);
        if (earlier) results.set(test.name, earlier);
        else results.delete(test.name);
      }
    });
    update(id, { busy: null });
  }
}

export function cancelTests(id: string) {
  const root = getProject(id)?.root;
  if (root) void cmakeBackend.cancel(root).catch((e) => host().report(e));
}

/** Debugs one test: its program alone, with the arguments that run only this test. */
export function debugTest(id: string, test: TestInfo) {
  if (!test.target)
    return host().report(
      `${test.name} does not run a program of this project, so it cannot be debugged`,
    );
  return startDebugging(id, { target: test.target, args: test.args });
}

/** Opens the test's TEST/TEST_F/TEST_P line, found with the project search. */
export async function revealTest(id: string, name: string) {
  const root = getProject(id)?.root;
  if (!root) return;
  const found = await ideBackend.search(root, {
    text: definitionPattern(name),
    regex: true,
    matchCase: true,
    wholeWord: false,
  });
  const file = found.files[0];
  const match = file?.matches[0];
  if (!file || !match)
    return host().report(`The definition of ${name} was not found`);
  await reveal(file.path, { line: match.line, column: match.column });
}

/** The palette's test commands for the active project. */
export function commands() {
  const project = activeProject();
  if (!project || !cmakeInfo(project.id)?.cmake) return [];
  const id = project.id;
  const list: { id: string; label: string; run: () => void }[] = [
    {
      id: "test.runAll",
      label: "Test: Run All Tests",
      run: () => void runTests(id),
    },
    {
      id: "test.refresh",
      label: "Test: Refresh Tests",
      run: () => void discoverTests(id),
    },
  ];
  if (stateOf(id).busy === "running")
    list.push({
      id: "test.cancel",
      label: "Test: Cancel Test Run",
      run: () => cancelTests(id),
    });
  return list;
}
