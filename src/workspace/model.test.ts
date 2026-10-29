import { describe, expect, it } from "vitest";
import {
  apply,
  emptyWorkspace,
  geometry,
  neighbor,
  panels,
  validate,
  type Action,
  type Workspace,
} from "./model";
const bounds = { x: 0, y: 0, width: 1200, height: 800 };
const open = (
  n: number,
  mode: "tab" | "auto" | "x" | "y" = "auto",
): Extract<Action, { type: "open" }> => ({
  type: "open",
  tab: { id: `t${n}`, plugin: "editor" },
  panelId: `p${n}`,
  splitId: `s${n}`,
  mode,
});
const run = (s: Workspace, a: Action) => apply(s, a, bounds);
const two = () => run(run(emptyWorkspace(), open(1)), open(2));
describe("workspace invariants", () => {
  it("starts empty and opens independent workspaces", () => {
    expect(emptyWorkspace()).toEqual({
      root: null,
      focused: null,
      maximized: null,
    });
    expect(panels(run(emptyWorkspace(), open(1)).root)).toHaveLength(1);
    expect(emptyWorkspace().root).toBeNull();
  });
  it("opens with a given share or below the whole layout", () => {
    const sidebar = run(run(emptyWorkspace(), open(1)), {
      ...open(2, "x"),
      ratio: 0.25,
    });
    expect(sidebar.root).toMatchObject({ axis: "x", ratio: 0.25 });
    const below = run(sidebar, { ...open(3, "y"), around: "root", ratio: 0.7 });
    expect(below.root).toMatchObject({
      kind: "split",
      axis: "y",
      ratio: 0.7,
      first: { id: "s2" },
      second: { id: "p3" },
    });
    expect(below.focused).toBe("p3");
    expect(() =>
      apply(sidebar, { ...open(3, "x"), ratio: 0.01 }, bounds, {
        editor: { width: 100, height: 100 },
      }),
    ).toThrow(/Not enough space/);
  });
  it("splits by aspect ratio at 50/50 and supports explicit direction", () => {
    expect(two().root).toMatchObject({ kind: "split", axis: "x", ratio: 0.5 });
    expect(
      run(run(emptyWorkspace(), open(1)), open(2, "y")).root,
    ).toMatchObject({ axis: "y" });
  });
  it("rejects insufficient room without changing input or silently creating tabs", () => {
    const s = run(emptyWorkspace(), open(1));
    expect(() => apply(s, open(2, "x"), { ...bounds, width: 400 })).toThrow(
      "Not enough space",
    );
    expect(panels(s.root)).toHaveLength(1);
  });
  it("closes the final tab and collapses ancestors", () => {
    const one = run(two(), { type: "close", tabId: "t1" });
    expect(one.root?.id).toBe("p2");
    expect(run(one, { type: "close", tabId: "t2" })).toEqual(emptyWorkspace());
  });
  it("preserves tree and ratios through maximize/restore", () => {
    const s = run(two(), { type: "resize", splitId: "s2", ratio: 0.6 });
    const max = run(s, { type: "maximize", panelId: "p1" });
    expect(max.root).toEqual(s.root);
    expect(run(max, { type: "maximize", panelId: "p1" }).root).toEqual(s.root);
  });
  it("swaps whole panels at center without merging their tabs", () => {
    const s = run(two(), {
      type: "drop",
      sourcePanel: "p1",
      targetPanel: "p2",
      panelId: "p3",
      splitId: "s3",
    });
    expect(panels(s.root).map((p) => p.id)).toEqual(["p2", "p1"]);
  });
  it("moves the last tab to a center and removes its empty panel", () => {
    const s = run(two(), {
      type: "drop",
      sourcePanel: "p1",
      tabId: "t1",
      targetPanel: "p2",
      panelId: "p3",
      splitId: "s3",
    });
    expect(panels(s.root)).toHaveLength(1);
    expect(panels(s.root)[0].tabs.map((t) => t.id)).toEqual(["t2", "t1"]);
  });
  it("moves panels and individual tabs to edges", () => {
    for (const tabId of [undefined, "t1"]) {
      const s = run(two(), {
        type: "drop",
        sourcePanel: "p1",
        tabId,
        targetPanel: "p2",
        edge: "bottom",
        panelId: "p3",
        splitId: "s3",
      });
      expect(s.root).toMatchObject({ axis: "y" });
      expect(panels(s.root).map((p) => p.tabs[0].id)).toEqual(["t2", "t1"]);
      validate(s, bounds);
    }
  });
  it("reorders tabs and ignores invalid drop targets", () => {
    const s = run(run(emptyWorkspace(), open(1)), open(2, "tab"));
    const moved = run(s, {
      type: "drop",
      sourcePanel: "p1",
      targetPanel: "p1",
      tabId: "t2",
      index: 0,
      panelId: "p3",
      splitId: "s3",
    });
    expect(panels(moved.root)[0].tabs.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(
      run(s, {
        type: "drop",
        sourcePanel: "p1",
        targetPanel: "missing",
        panelId: "p3",
        splitId: "s3",
      }),
    ).toBe(s);
  });
  it("rejects invalid ratios, duplicate tabs and insufficient resize space", () => {
    for (const ratio of [NaN, 0, 1, 0.01])
      expect(() =>
        run(two(), { type: "resize", splitId: "s2", ratio }),
      ).toThrow();
    expect(() => run(two(), open(1, "tab"))).toThrow("Duplicate tab");
  });
  it("detaches a tab from its own panel edge but never splits a lone tab into emptiness", () => {
    const one = run(emptyWorkspace(), open(1));
    const action: Action = {
      type: "drop",
      sourcePanel: "p1",
      targetPanel: "p1",
      tabId: "t1",
      edge: "right",
      panelId: "p3",
      splitId: "s3",
    };
    expect(run(one, action)).toBe(one);
    const split = run(run(one, open(2, "tab")), action);
    expect(panels(split.root).map((p) => p.tabs[0].id)).toEqual(["t2", "t1"]);
  });
  it("focuses spatial neighbors and retains ratio geometry", () => {
    expect(neighbor(two(), bounds, "left")).toBe("p1");
    expect(neighbor(two(), bounds, "right")).toBeNull();
    expect(geometry(two().root, bounds).get("p1")?.width).toBe(597);
  });
  it("survives a deterministic sequence of opens, moves, closes and resizes", () => {
    let s = emptyWorkspace();
    for (let i = 0; i < 100; i++) {
      s = run(s, open(i, "tab"));
      if (i % 3 === 0)
        s = run(s, { type: "close", tabId: `t${Math.floor(i / 3)}` });
      validate(s);
    }
    expect(
      new Set(panels(s.root).flatMap((p) => p.tabs.map((t) => t.id))).size,
    ).toBe(66);
  });
});
