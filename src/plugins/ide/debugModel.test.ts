import { describe, expect, it } from "vitest";
import {
  CONSOLE_LIMIT,
  appendConsole,
  expressionAt,
  hitCondition,
  kindOf,
  move,
  newBreakpoint,
  sourceBreakpoints,
  toggle,
} from "./debugModel";

describe("breakpoints", () => {
  it("toggles one breakpoint per line and file", () => {
    let list = toggle([], "/p/a.cpp", 3);
    list = toggle(list, "/p/b.cpp", 3);
    expect(list).toHaveLength(2);
    list = toggle(list, "/p/a.cpp", 3);
    expect(list.map((b) => b.path)).toEqual(["/p/b.cpp"]);
  });

  it("follows edits and merges breakpoints that meet on one line", () => {
    const a = newBreakpoint("/p/a.cpp", 3);
    const b = newBreakpoint("/p/a.cpp", 5, { condition: "x > 1" });
    const c = newBreakpoint("/p/c.cpp", 5);
    const moved = move(
      [a, b, c],
      new Map([
        [a.uid, 4],
        [b.uid, 4],
      ]),
    );
    expect(moved.map((x) => [x.uid, x.line])).toEqual([
      [a.uid, 4],
      [c.uid, 5],
    ]);
  });

  it("names the kind after what the breakpoint does", () => {
    const bp = newBreakpoint("/p/a.cpp", 1);
    expect(kindOf(bp)).toBe("line");
    expect(kindOf({ ...bp, hitCondition: "3" })).toBe("hitCount");
    expect(kindOf({ ...bp, condition: "i == 2", hitCondition: "3" })).toBe(
      "conditional",
    );
    expect(kindOf({ ...bp, logMessage: "i={i}", condition: "i" })).toBe(
      "logpoint",
    );
  });

  it("translates 'from the Nth hit' for each adapter", () => {
    expect(hitCondition("gdb", "3")).toBe("2");
    expect(hitCondition("lldb", " 3 ")).toBe("3");
  });

  it("never sets a breakpoint the adapter cannot honour", () => {
    const plain = newBreakpoint("/p/a.cpp", 1);
    const conditional = newBreakpoint("/p/a.cpp", 2, { condition: "x" });
    const hits = newBreakpoint("/p/a.cpp", 3, { hitCondition: "2" });
    const bad = newBreakpoint("/p/a.cpp", 4, { hitCondition: "x+1" });
    const log = newBreakpoint("/p/a.cpp", 5, { logMessage: "x={x}" });
    const off = newBreakpoint("/p/a.cpp", 6, { enabled: false });
    const all = [plain, conditional, hits, bad, log, off];
    const full = sourceBreakpoints(all, "gdb", {
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsLogPoints: true,
    });
    expect(full.sent.map((s) => s.breakpoint)).toEqual([
      { line: 1 },
      { line: 2, condition: "x" },
      { line: 3, hitCondition: "1" },
      { line: 5, logMessage: "x={x}" },
    ]);
    expect(full.refused.get(bad.uid)).toMatch(/positive/);
    const bare = sourceBreakpoints(all, "lldb", {});
    expect(bare.sent.map((s) => s.uid)).toEqual([plain.uid]);
    expect([...bare.refused.keys()]).toEqual([
      conditional.uid,
      hits.uid,
      bad.uid,
      log.uid,
    ]);
  });
});

describe("debug hover", () => {
  it("takes the identifier with its member accesses", () => {
    const line = "  total = node->next->value + data.size() + ns::count;";
    expect(expressionAt(line, line.indexOf("total") + 2)?.text).toBe("total");
    expect(expressionAt(line, line.indexOf("value") + 1)?.text).toBe(
      "node->next->value",
    );
    expect(expressionAt(line, line.indexOf("next") + 1)?.text).toBe(
      "node->next",
    );
    expect(expressionAt(line, line.indexOf("size"))?.text).toBe("data.size");
    expect(expressionAt(line, line.indexOf("count") + 4)?.text).toBe(
      "ns::count",
    );
    expect(expressionAt(line, line.indexOf("=") + 1)).toBeNull();
    expect(expressionAt("x = 42;", 5)).toBeNull();
  });
});

describe("debug console", () => {
  it("keeps the newest lines within its limit", () => {
    const counter = { value: 0 };
    let lines = appendConsole([], [{ kind: "info", text: "start" }], counter);
    lines = appendConsole(
      lines,
      Array.from({ length: CONSOLE_LIMIT }, (_, i) => ({
        kind: "output" as const,
        text: String(i),
      })),
      counter,
    );
    expect(lines).toHaveLength(CONSOLE_LIMIT);
    expect(lines[0].text).toBe("0");
    expect(lines[lines.length - 1].id).toBe(CONSOLE_LIMIT);
  });
});
