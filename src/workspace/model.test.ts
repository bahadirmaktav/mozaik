import { describe, expect, it } from "vitest";
import {
  allPanels,
  apply,
  emptyWorkspace,
  geometry,
  groupRoot,
  GROUP_GAP,
  neighbor,
  panels,
  validate,
  type Action,
  type Workspace,
} from "./model";
const bounds = { x: 0, y: 0, width: 1200, height: 800 };
const open = (
  n: number,
  mode: "tab" | "auto" | "float" | "x" | "y" = "auto",
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
      floating: [],
      focused: null,
      maximized: null,
    });
    expect(panels(run(emptyWorkspace(), open(1)).root)).toHaveLength(1);
    expect(emptyWorkspace().root).toBeNull();
  });
  it("opens with a given share, before or after the focused panel", () => {
    const sidebar = run(run(emptyWorkspace(), open(1)), {
      ...open(2, "x"),
      ratio: 0.25,
    });
    expect(sidebar.root).toMatchObject({ axis: "x", ratio: 0.25 });
    // The code area above an IDE bottom panel: the new panel first, with its share.
    const above = run(sidebar, { ...open(3, "y"), before: true, ratio: 0.7 });
    expect(above.root).toMatchObject({
      kind: "split",
      axis: "x",
      first: { id: "p1" },
      second: {
        kind: "split",
        axis: "y",
        ratio: 0.7,
        first: { id: "p3" },
        second: { id: "p2" },
      },
    });
    expect(above.focused).toBe("p3");
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
describe("docked tools", () => {
  const limits = {
    editor: { width: 100, height: 100 },
    side: { width: 200, height: 100, dock: { axis: "x" as const, size: 40 } },
    status: {
      width: 100,
      height: 20,
      dock: { axis: "y" as const, size: 20, fixed: true },
    },
  };
  const tool = (
    n: number,
    plugin: string,
    mode: "auto" | "x" | "y" | "tab",
  ) => ({
    ...open(n, mode),
    tab: { id: `t${n}`, plugin },
  });
  const go = (s: Workspace, a: Action) => apply(s, a, bounds, limits);
  it("never share a panel: tabs beside them become splits and merges are refused", () => {
    const side = go(emptyWorkspace(), tool(1, "side", "auto"));
    const next = go(side, open(2, "tab"));
    expect(panels(next.root)).toHaveLength(2);
    const merged = go(next, {
      type: "drop",
      sourcePanel: "p2",
      tabId: "t2",
      targetPanel: "p1",
      panelId: "p9",
      splitId: "s9",
    });
    expect(merged).toBe(next);
  });
  it("collapse to their bar and restore their share; a fixed bar keeps its size", () => {
    let s = go(emptyWorkspace(), tool(1, "side", "auto"));
    s = go(s, { ...open(2, "x"), ratio: 0.25 });
    s = go(s, { type: "activate", panelId: "p1" });
    s = go(s, { type: "collapse", panelId: "p1", collapsed: true });
    let rects = geometry(s.root, bounds, limits);
    expect(rects.get("p1")?.width).toBe(40);
    expect(rects.get("p2")?.width).toBe(1200 - 40 - 6);
    s = go(s, { type: "collapse", panelId: "p1", collapsed: false });
    expect(geometry(s.root, bounds, limits).get("p1")?.width).toBeCloseTo(
      (1200 - 6) * 0.25,
    );
    // Only docked tools collapse.
    expect(go(s, { type: "collapse", panelId: "p2", collapsed: true })).toEqual(
      s,
    );
    s = go(s, { type: "activate", panelId: "p2" });
    s = go(s, tool(3, "status", "y"));
    rects = geometry(s.root, bounds, limits);
    expect(rects.get("p3")?.height).toBe(20);
    expect(rects.get("p2")?.height).toBe(800 - 20 - 6);
  });
});
describe("floating panels", () => {
  const limits = {
    editor: { width: 100, height: 100 },
    side: { width: 200, height: 100, dock: { axis: "x" as const, size: 40 } },
  };
  const go = (s: Workspace, a: Action) => apply(s, a, bounds, limits);
  it("open over the layout, focused and centered, and take tabs but not splits", () => {
    let s = go(go(emptyWorkspace(), open(1)), open(2, "float"));
    expect(panels(s.root)).toHaveLength(1);
    expect(s.floating).toEqual([
      {
        panel: {
          kind: "panel",
          id: "p2",
          tabs: [{ id: "t2", plugin: "editor" }],
          active: "t2",
        },
        rect: { x: 300, y: 160, width: 600, height: 480 },
      },
    ]);
    expect(s.focused).toBe("p2");
    expect(allPanels(s).map((p) => p.id)).toEqual(["p1", "p2"]);
    // A new tab joins the focused floating panel; a split goes into the layout.
    s = go(s, open(3, "tab"));
    expect(s.floating[0].panel.tabs).toHaveLength(2);
    s = go(go(s, { type: "activate", panelId: "p2" }), open(4, "x"));
    expect(panels(s.root).map((p) => p.id)).toEqual(["p1", "p4"]);
    // The next one cascades and comes in front; activating one brings it to the front.
    s = go(s, open(5, "float"));
    expect(s.floating[1].rect).toMatchObject({ x: 324, y: 184 });
    s = go(s, { type: "activate", panelId: "p2" });
    expect(s.floating.map((f) => f.panel.id)).toEqual(["p5", "p2"]);
    // Without a layout, a floating panel is all there is; a split starts the layout.
    const alone = go(emptyWorkspace(), open(1, "float"));
    expect(alone.root).toBeNull();
    expect(go(alone, open(2)).root).toMatchObject({ id: "p2" });
  });
  it("move, resize, float a tiled panel and dock back; closing the last tab removes them", () => {
    let s = go(two(), { type: "float", panelId: "p2" });
    expect(panels(s.root).map((p) => p.id)).toEqual(["p1"]);
    expect(s.floating[0].rect.width).toBe(597);
    s = go(s, {
      type: "float",
      panelId: "p2",
      rect: { x: 10, y: 20, width: 300, height: 200 },
    });
    expect(s.floating[0].rect).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
    // Smaller than the tool's minimum is refused.
    expect(() =>
      go(s, {
        type: "float",
        panelId: "p2",
        rect: { x: 10, y: 20, width: 50, height: 200 },
      }),
    ).toThrow(/Not enough space/);
    s = go(s, { type: "dock", panelId: "p2", splitId: "s9" });
    expect(s.floating).toEqual([]);
    expect(s.root).toMatchObject({ id: "s9", axis: "x", second: { id: "p2" } });
    s = go(s, { type: "float", panelId: "p1" });
    s = go(s, { type: "close", tabId: "t1" });
    expect(s.floating).toEqual([]);
    expect(s.focused).toBe("p2");
  });
  it("join tabs dropped on them, give tabs back to the layout, and never hold docked tools", () => {
    let s = go(go(two(), open(3, "float")), {
      type: "drop",
      sourcePanel: "p1",
      tabId: "t1",
      targetPanel: "p3",
      edge: "left",
      panelId: "p9",
      splitId: "s9",
    });
    // No edges on a floating panel: the tab joins it.
    expect(s.floating[0].panel.tabs.map((t) => t.id)).toEqual(["t3", "t1"]);
    expect(panels(s.root).map((p) => p.id)).toEqual(["p2"]);
    s = go(s, {
      type: "drop",
      sourcePanel: "p3",
      tabId: "t3",
      targetPanel: "p2",
      edge: "bottom",
      panelId: "p8",
      splitId: "s8",
    });
    expect(panels(s.root).map((p) => p.id)).toEqual(["p2", "p8"]);
    expect(s.floating[0].panel.tabs.map((t) => t.id)).toEqual(["t1"]);
    // Whole panels swap only in the layout.
    expect(
      go(s, {
        type: "drop",
        sourcePanel: "p2",
        targetPanel: "p3",
        panelId: "x",
        splitId: "y",
      }).floating[0].panel.tabs,
    ).toHaveLength(2);
    const side = go(emptyWorkspace(), {
      ...open(1, "float"),
      tab: { id: "t1", plugin: "side" },
    });
    expect(side.floating).toEqual([]);
    expect(side.root).toMatchObject({ id: "p1" });
    expect(() => go(side, { type: "float", panelId: "p1" })).toThrow(
      /cannot float/,
    );
  });
  it("are reached by spatial focus", () => {
    const s = go(go(go(emptyWorkspace(), open(1)), open(2, "float")), {
      type: "float",
      panelId: "p2",
      rect: { x: 900, y: 300, width: 200, height: 200 },
    });
    expect(neighbor({ ...s, focused: "p1" }, bounds, "right", limits)).toBe(
      "p2",
    );
    expect(neighbor(s, bounds, "left", limits)).toBe("p1");
  });
});
describe("editor groups", () => {
  // p1 split into the group p1 | p2, as Split Right in a Text Editor does.
  const grouped = () =>
    run(run(emptyWorkspace(), open(1)), { ...open(2, "x"), group: true });
  it("divides a panel by a line and keeps other panels around the group", () => {
    const state = grouped();
    expect(state.root).toMatchObject({ kind: "split", group: true });
    const rects = geometry(state.root, bounds);
    expect(rects.get("p2")!.x - rects.get("p1")!.width).toBe(GROUP_GAP);
    // A module added while a group is focused goes beside the whole group.
    const added = run(state, open(3, "y"));
    expect(added.root).toMatchObject({
      kind: "split",
      axis: "y",
      first: { kind: "split", group: true },
      second: { id: "p3" },
    });
    expect((added.root as { group?: boolean }).group).toBeUndefined();
    expect(groupRoot(added.root, "p2")?.id).toBe("s2");
    expect(groupRoot(added.root, "p3")).toBeNull();
  });
  it("drops at an edge as a group only when asked; otherwise around the group", () => {
    const state = run(grouped(), open(3, "tab"));
    const drop = (group?: boolean): Action => ({
      type: "drop",
      sourcePanel: "p2",
      tabId: "t3",
      targetPanel: "p2",
      edge: "bottom",
      panelId: "p9",
      splitId: "s9",
      group,
    });
    expect(run(state, drop(true)).root).toMatchObject({
      group: true,
      second: { kind: "split", axis: "y", group: true, second: { id: "p9" } },
    });
    expect(run(state, drop()).root).toMatchObject({
      axis: "y",
      first: { group: true },
      second: { id: "p9" },
    });
  });
  it("closing a group's last tab removes the line", () => {
    const state = run(grouped(), { type: "close", tabId: "t2" });
    expect(state.root).toMatchObject({ kind: "panel", id: "p1" });
  });
});
