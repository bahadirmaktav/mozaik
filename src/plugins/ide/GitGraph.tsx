import { useEffect, useMemo, useState } from "react";
import { ideBackend, type GitCommit } from "../../services/ide";
import { host, message } from "./editors";
import {
  GRAPH_COLORS,
  layoutGraph,
  refLabel,
  type GraphEdge,
} from "./graphModel";
import type { Project } from "./projects";

const PAGE = 200;
// A row's drawing, in the SVG's own units; CSS scales it with the IDE's zoom.
const LANE = 12,
  ROW = 22;
const x = (lane: number) => LANE / 2 + lane * LANE;
const color = (index: number) => `var(--graph-${index % GRAPH_COLORS})`;
const edgePath = ({ from, to, part }: GraphEdge) => {
  const [y1, y2] =
    part === "top"
      ? [0, ROW / 2]
      : part === "bottom"
        ? [ROW / 2, ROW]
        : [0, ROW];
  const middle = (y1 + y2) / 2;
  return from === to
    ? `M${x(from)} ${y1}V${y2}`
    : `M${x(from)} ${y1}C${x(from)} ${middle} ${x(to)} ${middle} ${x(to)} ${y2}`;
};

/**
 * The repository's history as a graph, after VS Code's Source Control Graph: every branch and
 * tag, newest first, read only. It reads again when `HEAD` moves or `version` changes (the
 * Refresh button); more commits load on request.
 */
export function GitGraph({
  project,
  version,
}: {
  project: Project;
  version: number;
}) {
  const root = project.root!;
  const head = project.git?.head ?? null;
  const [commits, setCommits] = useState<GitCommit[] | null>(null);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    ideBackend
      .gitLog(root, 0, PAGE)
      .then((list) => {
        if (!live) return;
        setCommits(list ?? []);
        setMore((list?.length ?? 0) === PAGE);
        setError("");
      })
      .catch((e) => live && setError(message(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [root, head, version]);
  function loadMore() {
    if (!commits || loading) return;
    setLoading(true);
    ideBackend
      .gitLog(root, commits.length, PAGE)
      .then((list) => {
        setCommits([...commits, ...(list ?? [])]);
        setMore((list?.length ?? 0) === PAGE);
      })
      .catch((e) => host().report(message(e)))
      .finally(() => setLoading(false));
  }
  const graph = useMemo(() => layoutGraph(commits ?? []), [commits]);
  if (error) return <p className="project-hint">{error}</p>;
  if (!commits) return <p className="project-hint">Reading the history…</p>;
  if (!commits.length) return <p className="project-hint">No commits yet.</p>;
  const width = graph.lanes * LANE;
  return (
    <div className="git-graph">
      <ul aria-label="Commits">
        {graph.rows.map(({ commit, lane, color: dot, edges }) => (
          <li
            key={commit.hash}
            className="git-graph-row"
            title={`${commit.hash.slice(0, 10)} · ${commit.author} · ${new Date(
              commit.date * 1000,
            ).toLocaleString()}\n${commit.subject}`}
          >
            <svg
              className="git-graph-lines"
              viewBox={`0 0 ${width} ${ROW}`}
              style={{ "--lanes": graph.lanes } as React.CSSProperties}
              aria-hidden="true"
            >
              {edges.map((edge, index) => (
                <path
                  key={index}
                  d={edgePath(edge)}
                  fill="none"
                  stroke={color(edge.color)}
                  strokeWidth="1.5"
                />
              ))}
              <circle
                cx={x(lane)}
                cy={ROW / 2}
                r="3.5"
                fill={color(dot)}
                stroke="var(--surface)"
              />
            </svg>
            <span className="git-graph-subject">{commit.subject}</span>
            {commit.refs.map((ref) => {
              const { name, kind } = refLabel(ref);
              return (
                <span key={ref} className={`git-graph-ref ref-${kind}`}>
                  {name}
                </span>
              );
            })}
            <span className="git-graph-author">{commit.author}</span>
          </li>
        ))}
      </ul>
      {more && (
        <button
          type="button"
          className="git-graph-more"
          disabled={loading}
          onClick={loadMore}
        >
          {loading ? "Loading…" : "Load More Commits"}
        </button>
      )}
    </div>
  );
}
