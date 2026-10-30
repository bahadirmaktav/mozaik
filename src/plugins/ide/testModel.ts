import type { TestInfo } from "../../services/cmake";

/**
 * The Testing view's pure part: tests grouped as in VS Code's Testing view (program, then
 * GoogleTest suite, which is the fixture of a TEST_F) and CTest's output read into results.
 */
export type TestStatus = "passed" | "failed" | "skipped" | "running" | "queued";
export interface TestResult {
  status: TestStatus;
  seconds?: number;
  /** CTest's words for it: `Passed`, `***Failed`, `Not Run (Disabled)`, `Exception: …`. */
  detail?: string;
  /** The test's own output, which CTest prints for failed tests. */
  output?: string;
}
export interface Suite {
  name: string;
  tests: { test: TestInfo; label: string }[];
}
export interface Program {
  /** The executable target, or `null` for tests of other programs (scripts). */
  target: string | null;
  suites: Suite[];
}

/** `Prefix/Suite.Test/Param` → suite `Prefix/Suite`, test `Test/Param`. */
export function splitName(name: string) {
  const dot = name.indexOf(".");
  return dot > 0 && dot < name.length - 1
    ? { suite: name.slice(0, dot), test: name.slice(dot + 1) }
    : { suite: "", test: name };
}
/** Programs and suites in CTest's order (the order of the sources). */
export function groupTests(tests: TestInfo[]): Program[] {
  const programs = new Map<string | null, Map<string, Suite>>();
  for (const test of tests) {
    const { suite, test: label } = splitName(test.name);
    const suites = programs.get(test.target) ?? new Map<string, Suite>();
    programs.set(test.target, suites);
    const group = suites.get(suite) ?? { name: suite, tests: [] };
    suites.set(suite, group);
    group.tests.push({ test, label });
  }
  return [...programs].map(([target, suites]) => ({
    target,
    suites: [...suites.values()],
  }));
}

export type TestEvent =
  | { kind: "start"; name: string }
  | {
      kind: "result";
      name: string;
      status: "passed" | "failed" | "skipped";
      detail: string;
      seconds: number;
    }
  | { kind: "output"; name: string; line: string };

// `  3/15 Test  #3: Suite.Name ......***Failed    0.01 sec`; names may hold spaces.
const RESULT =
  /^\s*\d+\/\d+\s+Test\s+#\s*\d+:\s(.+?)\s\.+\s*(?:\*\*\*)?(.+?)\s+(\d+(?:\.\d+)?)\s+sec\s*$/;
const START = /^\s*Start\s+\d+:\s(.+?)\s*$/;
// The summary after the last test ends a failed test's output.
const SUMMARY = /^\d+% tests passed|^The following tests|^Total Test time/;

/**
 * Reads CTest's output line by line: tests starting, their results, and the output CTest
 * prints after a failed test (`--output-on-failure`).
 */
export class ResultReader {
  private partial = "";
  private failed: string | null = null;
  push(text: string, end = false) {
    const lines = (this.partial + text).split(/\r?\n/);
    this.partial = end ? "" : lines.pop()!;
    const events: TestEvent[] = [];
    for (const line of lines) {
      const result = RESULT.exec(line);
      const start = START.exec(line);
      if (result) {
        const [, name, words, seconds] = result;
        const detail = words.trim();
        const status = /^Passed/.test(detail)
          ? "passed"
          : /^(Not Run|Skipped)/.test(detail)
            ? "skipped"
            : "failed";
        events.push({
          kind: "result",
          name,
          status,
          detail,
          seconds: Number(seconds),
        });
        this.failed = status === "failed" ? name : null;
      } else if (start) {
        this.failed = null;
        events.push({ kind: "start", name: start[1] });
      } else if (SUMMARY.test(line)) this.failed = null;
      else if (this.failed)
        events.push({ kind: "output", name: this.failed, line });
    }
    return events;
  }
}

/** Counts by status, for the view's summary. */
export function tally(results: Map<string, TestResult>, tests: TestInfo[]) {
  const count = { passed: 0, failed: 0, skipped: 0 };
  for (const test of tests) {
    const status = results.get(test.name)?.status;
    if (status === "passed" || status === "failed" || status === "skipped")
      count[status]++;
  }
  return count;
}
/** The status a group shows: running or failed first, then passed when all ran. */
export function groupStatus(
  statuses: (TestStatus | undefined)[],
): TestStatus | undefined {
  if (statuses.some((s) => s === "running" || s === "queued")) return "running";
  if (statuses.includes("failed")) return "failed";
  if (statuses.length && statuses.every((s) => s === "skipped"))
    return "skipped";
  if (statuses.some((s) => s === "passed") && !statuses.includes(undefined))
    return "passed";
  return undefined;
}
/**
 * A search for the test's definition: `TEST(Suite, Name)`, `TEST_F`, `TEST_P` and the
 * typed forms, without a value-parameterized test's prefix and parameter.
 */
export function definitionPattern(name: string) {
  const { suite, test } = splitName(name);
  const bare = (s: string) =>
    s.replace(/\/.*$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suiteName = bare(suite.replace(/^[^/]*\//, "")),
    testName = bare(test.replace(/^DISABLED_/, ""));
  return `\\b(TEST|TEST_F|TEST_P|TYPED_TEST|TYPED_TEST_P)\\s*\\(\\s*(DISABLED_)?${suiteName}\\s*,\\s*(DISABLED_)?${testName}\\s*\\)`;
}
