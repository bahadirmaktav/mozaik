import { describe, expect, it } from "vitest";
import type { GitCommit } from "../../services/ide";
import { layoutGraph, refLabel } from "./graphModel";

const commit = (hash: string, ...parents: string[]): GitCommit => ({
  hash,
  parents,
  author: "A",
  date: 0,
  refs: [],
  subject: hash,
});

describe("git graph", () => {
  it("keeps a straight history in one lane", () => {
    const graph = layoutGraph([
      commit("c", "b"),
      commit("b", "a"),
      commit("a"),
    ]);
    expect(graph.lanes).toBe(1);
    expect(graph.rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(graph.rows[1].edges).toEqual([
      { from: 0, to: 0, part: "top", color: 0 },
      { from: 0, to: 0, part: "bottom", color: 0 },
    ]);
    // The root commit has nothing below it.
    expect(graph.rows[2].edges.map((e) => e.part)).toEqual(["top"]);
  });
  it("branches a merge's second parent and joins it again", () => {
    //  m        merge of b into a's line
    //  |\
    //  a |
    //  | b
    //  |/
    //  r
    const graph = layoutGraph([
      commit("m", "a", "b"),
      commit("a", "r"),
      commit("b", "r"),
      commit("r"),
    ]);
    expect(graph.lanes).toBe(2);
    expect(graph.rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
    const [m, a, b, r] = graph.rows;
    expect(m.edges.filter((e) => e.part === "bottom").map((e) => e.to)).toEqual(
      [0, 1],
    );
    // While a is drawn, b's line runs through its row.
    expect(a.edges).toContainEqual(
      expect.objectContaining({ from: 1, to: 1, part: "through" }),
    );
    // b's parent is already awaited in lane 0: its line goes over.
    expect(b.edges).toContainEqual(
      expect.objectContaining({ from: 1, to: 0, part: "bottom" }),
    );
    expect(r.edges.map((e) => e.from)).toEqual([0]);
  });
  it("reuses a lane once its line has ended", () => {
    const graph = layoutGraph([
      commit("x", "base"),
      commit("y", "base"),
      commit("base"),
      commit("other"),
    ]);
    // `other` starts a new line, in the lane free again.
    expect(graph.rows[3].lane).toBe(0);
    expect(graph.lanes).toBe(2);
  });
  it("starts unrelated heads in their own lanes", () => {
    const graph = layoutGraph([commit("p", "q"), commit("z"), commit("q")]);
    expect(graph.rows.map((r) => r.lane)).toEqual([0, 1, 0]);
    expect(graph.rows[0].color).not.toBe(graph.rows[1].color);
  });
  it("names references", () => {
    expect(refLabel("HEAD -> main")).toEqual({ name: "main", kind: "head" });
    expect(refLabel("tag: v1")).toEqual({ name: "v1", kind: "tag" });
    expect(refLabel("origin/main")).toEqual({
      name: "origin/main",
      kind: "branch",
    });
  });
});
