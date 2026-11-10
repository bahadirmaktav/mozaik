import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ideBackend,
  type GitCommit,
  type GitCommitFile,
} from "../../services/ide";
import { host, message } from "./editors";
import { baseName, relative } from "./paths";
import { EntryIcon } from "./fileIcons";
import { AuthorIcon } from "../../components/Icons";
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
 * Whether the graph shows each commit's author, as VS Code's graph does; a choice of this
 * viewer's, kept in the WebView's local storage.
 */
const AUTHORS_KEY = "mozaik.graph.authors";
let authors = (() => {
  try {
    return localStorage.getItem(AUTHORS_KEY) !== "hidden";
  } catch {
    return true;
  }
})();
const authorListeners = new Set<() => void>();
function setAuthors(shown: boolean) {
  authors = shown;
  try {
    localStorage.setItem(AUTHORS_KEY, shown ? "shown" : "hidden");
  } catch {
    // Without storage the choice lasts for this window.
  }
  authorListeners.forEach((fn) => fn());
}
function useAuthors() {
  return useSyncExternalStore(
    (fn) => {
      authorListeners.add(fn);
      return () => void authorListeners.delete(fn);
    },
    () => authors,
  );
}
/** The Graph section's button that shows or hides the authors. */
export function GraphAuthorsToggle() {
  const shown = useAuthors();
  const label = shown ? "Hide Commit Authors" : "Show Commit Authors";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={shown}
      onClick={() => setAuthors(!shown)}
    >
      <AuthorIcon />
    </button>
  );
}

const FILE_LABELS: Record<string, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  T: "Type changed",
};
/** The Source Control colors of a commit's file states (copies as additions). */
const FILE_CLASS: Record<string, string> = { C: "A", T: "M" };

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
  const showAuthors = useAuthors();
  // As in VS Code, a commit opens to the files it changed; a file opens its comparison.
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<
    Map<string, GitCommitFile[] | { error: string }>
  >(new Map());
  function toggle(commit: GitCommit) {
    const next = new Set(open);
    if (!next.delete(commit.hash)) {
      next.add(commit.hash);
      if (!files.has(commit.hash))
        ideBackend
          .commitFiles(root, commit.hash)
          .then((list) =>
            setFiles((known) => new Map(known).set(commit.hash, list)),
          )
          .catch((e) =>
            setFiles((known) =>
              new Map(known).set(commit.hash, { error: message(e) }),
            ),
          );
    }
    setOpen(next);
  }
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
          <li key={commit.hash}>
            <button
              type="button"
              className="git-graph-row"
              aria-expanded={open.has(commit.hash)}
              title={`${commit.hash.slice(0, 10)} · ${commit.author} · ${new Date(
                commit.date * 1000,
              ).toLocaleString()}\n${commit.subject}`}
              onClick={() => toggle(commit)}
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
              {showAuthors && (
                <span className="git-graph-author">{commit.author}</span>
              )}
            </button>
            {open.has(commit.hash) && (
              <CommitFiles
                root={root}
                commit={commit}
                files={files.get(commit.hash)}
                lanes={graph.lanes}
              />
            )}
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

/** The files a commit changed, under its row; a file opens the commit's comparison. */
function CommitFiles({
  root,
  commit,
  files,
  lanes,
}: {
  root: string;
  commit: GitCommit;
  files: GitCommitFile[] | { error: string } | undefined;
  lanes: number;
}) {
  const indent = { "--lanes": lanes } as React.CSSProperties;
  if (!files)
    return (
      <p className="git-graph-note muted" style={indent}>
        Reading the changes…
      </p>
    );
  if ("error" in files)
    return (
      <p className="git-graph-note" style={indent} role="alert">
        {files.error}
      </p>
    );
  if (!files.length)
    return (
      <p className="git-graph-note muted" style={indent}>
        No file changes.
      </p>
    );
  return (
    <ul className="git-graph-files" aria-label={`Changes of ${commit.subject}`}>
      {files.map((file) => {
        const shown = relative(root, file.path) ?? file.path;
        const folder = shown.includes("/")
          ? shown.slice(0, shown.lastIndexOf("/"))
          : "";
        const status = FILE_CLASS[file.status] ?? file.status;
        return (
          <li key={file.path}>
            <button
              type="button"
              className="git-graph-file"
              style={indent}
              title={`${FILE_LABELS[file.status] ?? file.status}: ${shown}${
                file.oldPath
                  ? ` (from ${relative(root, file.oldPath) ?? file.oldPath})`
                  : ""
              }`}
              onClick={() =>
                host().showCommitDiff(file.path, {
                  root,
                  hash: commit.hash,
                  parent: commit.parents[0] ?? null,
                  oldPath: file.oldPath,
                })
              }
            >
              <EntryIcon name={baseName(file.path)} directory={false} />
              <span className="project-label">{baseName(file.path)}</span>
              {folder && <span className="project-scm-folder">{folder}</span>}
              <span className={`project-git git-${status}`}>{file.status}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
