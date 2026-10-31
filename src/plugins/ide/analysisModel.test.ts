import { describe, expect, it } from "vitest";
import {
  combineFixes,
  groupProblems,
  matchesFilter,
  noFilter,
  previewHunks,
  type ProblemItem,
} from "./analysisModel";
import type { FixEdit } from "../../services/analysis";

const at = (line: number, character: number) => ({ line, character });
const item = (change: Partial<ProblemItem> = {}): ProblemItem => ({
  range: { start: at(2, 11), end: at(2, 15) },
  severity: 2,
  message: "use nullptr",
  code: "modernize-use-nullptr",
  source: "clang-tidy",
  ...change,
});
const edit = (
  start: [number, number],
  end: [number, number],
  newText: string,
  path = "/p/a.cpp",
): FixEdit => ({ path, start: at(...start), end: at(...end), newText });

describe("problems", () => {
  it("groups only the same place, rule and message, keeping every provider", () => {
    const fix = [edit([2, 11], [2, 15], "nullptr")];
    const grouped = groupProblems([
      item(),
      item({ source: "clang-tidy-cli", fix, stale: true }),
      // Same line, another check: a separate problem.
      item({ code: "readability-x", message: "other" }),
      item({ source: undefined, code: undefined, message: "use nullptr" }),
    ]);
    expect(grouped).toHaveLength(3);
    expect(grouped[0].providers).toEqual(["clang-tidy", "clang-tidy-cli"]);
    // The live report is current, so the group is not stale; the fix of the run is kept.
    expect(grouped[0].stale).toBe(false);
    expect(grouped[0].fix).toBe(fix);
    expect(grouped[2].providers).toEqual(["clangd"]);
  });
  it("filters by words, provider and severity", () => {
    const [problem] = groupProblems([item()]);
    expect(matchesFilter(problem, "src/a.cpp", noFilter)).toBe(true);
    expect(
      matchesFilter(problem, "src/a.cpp", {
        ...noFilter,
        text: "NULLPTR a.cpp",
      }),
    ).toBe(true);
    expect(
      matchesFilter(problem, "src/a.cpp", { ...noFilter, text: "braces" }),
    ).toBe(false);
    expect(
      matchesFilter(problem, "src/a.cpp", { ...noFilter, provider: "build" }),
    ).toBe(false);
    expect(
      matchesFilter(problem, "src/a.cpp", { ...noFilter, severity: 1 }),
    ).toBe(false);
  });
});

describe("fixes", () => {
  it("leave out a fix that touches an earlier one", () => {
    const first = [edit([2, 17], [2, 17], " {"), edit([2, 27], [2, 27], "\n}")];
    const clashing = [edit([2, 17], [2, 17], "{")];
    const inHeader = [edit([0, 0], [0, 0], "// x\n", "/p/a.h")];
    const { files, skipped } = combineFixes([first, clashing, inHeader]);
    expect(skipped).toBe(1);
    expect(files.get("/p/a.cpp")).toHaveLength(2);
    expect(files.get("/p/a.h")).toHaveLength(1);
  });
  it("preview the changed lines", () => {
    const text =
      "int f(int *p) {\n  if (p == NULL) return 0;\n  return *p;\n}\n";
    const hunks = previewHunks(text, [
      edit([1, 11], [1, 15], "nullptr"),
      edit([1, 16], [1, 16], " {"),
      edit([1, 26], [1, 26], "\n}"),
    ]);
    expect(hunks).toEqual([
      {
        line: 1,
        removed: ["  if (p == NULL) return 0;"],
        added: ["  if (p == nullptr) { return 0;", "}"],
      },
    ]);
  });
});
