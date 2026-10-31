import { describe, expect, it } from "vitest";
import { apply, emptyWorkspace, type Action, type Workspace } from "./model";
import { templateOf, workspaceOf } from "./templates";

const bounds = { x: 0, y: 0, width: 1200, height: 800 };
const open = (
  id: string,
  plugin: string,
  mode: "tab" | "auto" | "float" | "x" | "y",
  group?: boolean,
): Action => ({
  type: "open",
  tab: { id, plugin },
  panelId: `p-${id}`,
  splitId: `s-${id}`,
  mode,
  group,
});
const build = (...actions: Action[]) =>
  actions.reduce<Workspace>((s, a) => apply(s, a, bounds), emptyWorkspace());

describe("layout templates", () => {
  // Files | (editor groups a | b) over a terminal, plus a floating Tasks panel.
  const workspace = () =>
    build(
      open("fm", "file-manager", "x"),
      open("t1", "text-editor", "x"),
      open("t2", "text-editor", "tab"),
      open("t3", "text-editor", "x", true),
      open("code", "code-editor", "y"),
      open("term", "terminal", "tab"),
      open("tasks", "tasks", "float"),
    );
  const keep = (tab: { plugin: string }) =>
    tab.plugin === "code-editor" ? null : tab.plugin;

  it("keeps modules and how they are split, without documents", () => {
    const template = templateOf(
      "Work",
      workspace(),
      bounds,
      keep,
      (p) => p === "text-editor",
    );
    expect(template.root).toEqual({
      kind: "split",
      axis: "x",
      ratio: 0.5,
      first: { kind: "panel", tabs: ["file-manager"] },
      second: {
        kind: "split",
        axis: "y",
        ratio: 0.5,
        first: {
          kind: "split",
          axis: "x",
          ratio: 0.5,
          group: true,
          // Two text tabs are one page to write on.
          first: { kind: "panel", tabs: ["text-editor"] },
          second: { kind: "panel", tabs: ["text-editor"] },
        },
        // The code editor is left out; the terminal stays in its panel.
        second: { kind: "panel", tabs: ["terminal"] },
      },
    });
    expect(template.floating).toHaveLength(1);
    expect(template.floating[0].tabs).toEqual(["tasks"]);
    expect(template.floating[0].rect.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("opens as a fresh workspace with new IDs that the model accepts", () => {
    const template = templateOf("Work", workspace(), bounds, keep);
    let n = 0;
    const made: string[] = [];
    const next = workspaceOf(
      template,
      bounds,
      (plugin) =>
        plugin === "tasks"
          ? null
          : (made.push(plugin), { id: `new${n++}`, plugin }),
      () => `id${n++}`,
    );
    expect(made).toEqual([
      "file-manager",
      "text-editor",
      "text-editor",
      "text-editor",
      "terminal",
    ]);
    // A module that cannot open here (Tasks in another window) leaves its panel out.
    expect(next.floating).toEqual([]);
    expect(next.focused).toBe(
      (next.root as { first: { id: string } }).first.id,
    );
    const loaded = apply(
      emptyWorkspace(),
      { type: "load", workspace: next },
      bounds,
    );
    expect(loaded.root).toMatchObject({
      second: { first: { group: true } },
    });
  });
});
