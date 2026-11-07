import { describe, expect, it } from "vitest";
import {
  compareRefreshes,
  groupPlaced,
  placeFile,
  targetId,
  targetLabel,
} from "./sonarModel";
import type { SonarIssue } from "../../services/sonar";

function issue(
  key: string,
  startLine: number,
  endLine = startLine,
): SonarIssue {
  return {
    key,
    rule: "cpp:S6009",
    severity: 3,
    level: "LOW (maintainability)",
    kind: "CODE_SMELL",
    message: `issue ${key}`,
    path: "/proj/src/a.cpp",
    relative: "src/a.cpp",
    range: { startLine, endLine, startOffset: 2, endOffset: 7 },
    effort: "2min",
    created: null,
  };
}
const base = ["int a;", "int b;", "int c;", "int d;", "int e;"].join("\n");

describe("SonarQube issues in the current text", () => {
  it("stay where they are when the file is as analyzed", () => {
    const [placed] = placeFile([issue("A", 3)], { kind: "same" });
    expect(placed.track).toBe("open");
    // Protocol positions: lines from 0.
    expect(placed.range).toEqual({
      start: { line: 2, character: 2 },
      end: { line: 2, character: 7 },
    });
  });

  it("move with lines added or removed above them", () => {
    const current = ["// new", "// lines", base].join("\n");
    const [moved] = placeFile([issue("A", 3)], {
      kind: "texts",
      base,
      current,
    });
    expect(moved.track).toBe("open");
    expect(moved.range.start.line).toBe(4);
    const fewer = ["int b;", "int c;", "int d;", "int e;"].join("\n");
    expect(
      placeFile([issue("A", 3)], { kind: "texts", base, current: fewer })[0]
        .range.start.line,
    ).toBe(1);
  });

  it("are changed when their own lines were edited, and the others stay tracked", () => {
    const current = ["int a;", "int b;", "long c;", "int d;", "int e;"].join(
      "\n",
    );
    const placed = placeFile([issue("A", 3), issue("B", 5), issue("C", 2, 4)], {
      kind: "texts",
      base,
      current,
    });
    expect(placed.map((p) => [p.issue.key, p.track])).toEqual([
      ["A", "changed"],
      ["B", "open"],
      // A range is kept only when all of its lines are.
      ["C", "changed"],
    ]);
  });

  it("are changed when their lines were deleted", () => {
    const current = ["int a;", "int b;", "int d;", "int e;"].join("\n");
    const [deleted] = placeFile([issue("A", 3)], {
      kind: "texts",
      base,
      current,
    });
    expect(deleted.track).toBe("changed");
  });

  it("are unmatched without the analyzed commit", () => {
    const [placed] = placeFile([issue("A", 3)], { kind: "unmatched" });
    expect(placed.track).toBe("unmatched");
  });

  it("on a whole file follow the file", () => {
    const whole = { ...issue("W", 1), range: null };
    const [placed] = placeFile([whole], {
      kind: "texts",
      base,
      current: "changed\n" + base,
    });
    expect(placed.track).toBe("open");
    expect(placed.range.start).toEqual({ line: 0, character: 0 });
  });
});

describe("SonarQube refreshes", () => {
  it("compare the same target only", () => {
    const previous = { target: "pr:42", keys: new Set(["A", "B", "C"]) };
    expect(compareRefreshes(previous, "pr:42", new Set(["B", "D"]))).toEqual({
      fixed: 2,
      added: new Set(["D"]),
    });
    expect(compareRefreshes(previous, "main", new Set(["B"]))).toBeNull();
    expect(compareRefreshes(null, "pr:42", new Set(["B"]))).toBeNull();
  });

  it("name merge requests, pull requests and branches", () => {
    const gitlab = {
      kind: "pullRequest" as const,
      key: "42",
      title: "Fix",
      branch: "feature/x",
      url: "https://git.example.com/group/proj/-/merge_requests/42",
    };
    expect(targetLabel(gitlab)).toBe("Merge request !42 · feature/x");
    expect(
      targetLabel({ ...gitlab, url: "https://github.com/o/r/pull/42" }),
    ).toBe("Pull request #42 · feature/x");
    expect(targetId(gitlab)).toBe("pr:42");
    expect(targetLabel({ kind: "main", name: "main" })).toBe(
      "Main branch (main)",
    );
    expect(targetId({ kind: "branch", name: "dev" })).toBe("branch:dev");
  });

  it("group by track and file, filtered by severity", () => {
    const placed = placeFile(
      [issue("A", 3), { ...issue("B", 1), severity: 1 }],
      { kind: "same" },
    );
    const all = groupPlaced(placed, 0);
    expect(all.open).toHaveLength(1);
    expect(all.open[0][1].map((p) => p.issue.key)).toEqual(["B", "A"]);
    expect(groupPlaced(placed, 1).open[0][1].map((p) => p.issue.key)).toEqual([
      "B",
    ]);
  });
});
