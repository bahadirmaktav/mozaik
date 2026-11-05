import type { GitCommit } from "../../services/ide";

/**
 * The Source Control graph's layout: each commit in a lane, with the lines that cross its row.
 * Lanes keep their place from row to row, so a line runs straight until it joins its commit.
 */
export interface GraphEdge {
  /** Lanes the line runs between. */
  from: number;
  to: number;
  /** The part of the row: above the commit's dot, below it, or the whole row. */
  part: "top" | "bottom" | "through";
  color: number;
}
export interface GraphRow {
  commit: GitCommit;
  lane: number;
  color: number;
  edges: GraphEdge[];
}
export interface Graph {
  rows: GraphRow[];
  /** Lanes the widest row needs. */
  lanes: number;
}
/** How many colors the view cycles through. */
export const GRAPH_COLORS = 6;

export function layoutGraph(commits: GitCommit[]): Graph {
  // The commit each lane waits for, and its color; null lanes are free.
  const waiting: (string | null)[] = [];
  const colors: number[] = [];
  let nextColor = 0;
  let lanes = 1;
  const free = (except = -1) => {
    const at = waiting.findIndex((hash, i) => hash === null && i !== except);
    return at < 0 ? Math.max(waiting.length, except + 1) : at;
  };
  const rows = commits.map((commit): GraphRow => {
    let lane = waiting.indexOf(commit.hash);
    if (lane < 0) {
      lane = free();
      waiting[lane] = commit.hash;
      colors[lane] = nextColor++ % GRAPH_COLORS;
    }
    const color = colors[lane];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < waiting.length; i++) {
      if (waiting[i] === null || waiting[i] === undefined) continue;
      if (waiting[i] === commit.hash) {
        edges.push({ from: i, to: lane, part: "top", color: colors[i] });
        if (i !== lane) waiting[i] = null;
      } else edges.push({ from: i, to: i, part: "through", color: colors[i] });
    }
    waiting[lane] = null;
    commit.parents.forEach((parent, index) => {
      const known = waiting.indexOf(parent);
      if (known >= 0) {
        // Another line already leads to this parent: join it.
        edges.push({
          from: lane,
          to: known,
          part: "bottom",
          color: colors[known],
        });
        return;
      }
      // The first parent stays in the lane; the others branch off in a new color.
      const at = index === 0 ? lane : free(lane);
      waiting[at] = parent;
      colors[at] = index === 0 ? color : nextColor++ % GRAPH_COLORS;
      edges.push({ from: lane, to: at, part: "bottom", color: colors[at] });
    });
    lanes = Math.max(lanes, waiting.length, lane + 1);
    return { commit, lane, color, edges };
  });
  return { rows, lanes };
}

/** A `git log` decoration as the view shows it. */
export function refLabel(ref: string) {
  if (ref.startsWith("HEAD -> "))
    return { name: ref.slice(8), kind: "head" as const };
  if (ref === "HEAD") return { name: "HEAD", kind: "head" as const };
  if (ref.startsWith("tag: "))
    return { name: ref.slice(5), kind: "tag" as const };
  return { name: ref, kind: "branch" as const };
}
