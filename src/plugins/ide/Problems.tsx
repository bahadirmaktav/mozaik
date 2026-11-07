import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  allProblems,
  host,
  problemsVersion,
  reveal,
  useEditors,
} from "./editors";
import { displayPath } from "./lsp";
import { within } from "./paths";
import {
  groupProblems,
  matchesFilter,
  noFilter,
  PROVIDER_LABEL,
  PROVIDERS,
  type Problem,
  type ProblemFilter,
} from "./analysisModel";
import { previewFixes } from "./analysis";
import { useIdeZoom } from "../../workspace/ideZoom";

const SEVERITY = ["", "Error", "Warning", "Info", "Hint"];
const OVERSCAN = 20;
// A project's filter outlives switching the bottom panel's views; the panel bar edits it.
const filters = new Map<string, ProblemFilter>();
const listeners = new Set<() => void>();
function subscribeFilters(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function useFilter(root: string | null) {
  const key = root ?? "";
  const filter = useSyncExternalStore(
    subscribeFilters,
    () => filters.get(key) ?? noFilter,
  );
  const change = (next: Partial<ProblemFilter>) => {
    filters.set(key, { ...filter, ...next });
    listeners.forEach((fn) => fn());
  };
  return [filter, change] as const;
}
/** A line of the list: a file's name, or one of its problems. */
type Row =
  | { path: string; name: string; count: number; item?: undefined }
  | { path: string; item: Problem };
interface Shown {
  total: number;
  count: number;
  rows: Row[];
}
/** What each project's list showed last: every store change re-renders it, few change problems. */
const shown = new Map<
  string,
  { version: number; filter: ProblemFilter; value: Shown }
>();
/** The project's problems by file as rows, and how many there are with and without the filter. */
function problemRows(root: string | null, filter: ProblemFilter): Shown {
  const key = root ?? "";
  const version = problemsVersion();
  const known = shown.get(key);
  if (known?.version === version && known.filter === filter) return known.value;
  const all = allProblems()
    .filter((f) => !root || within(root, f.path))
    .map((f) => ({
      path: f.path,
      name: displayPath(f.path),
      items: groupProblems(f.items),
    }));
  const rows: Row[] = [];
  let total = 0,
    count = 0;
  for (const { path, name, items } of all.sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    total += items.length;
    const kept = items
      .filter((p) => matchesFilter(p, name, filter))
      .sort(
        (a, b) =>
          a.severity - b.severity || a.range.start.line - b.range.start.line,
      );
    if (!kept.length) continue;
    count += kept.length;
    rows.push({ path, name, count: kept.length });
    for (const item of kept) rows.push({ path, item });
  }
  const value = { total, count, rows };
  shown.set(key, { version, filter, value });
  return value;
}

/** The Problems filter, at the right of the bottom panel's bar as in VS Code. */
export function ProblemsFilter({ root }: { root: string | null }) {
  useEditors();
  const [filter, change] = useFilter(root);
  const { total, count } = problemRows(root, filter);
  return (
    <div className="problems-filter">
      {count !== total && (
        <span className="muted">
          {count} of {total}
        </span>
      )}
      <input
        type="search"
        aria-label="Filter problems"
        placeholder="Filter (text, rule, file)"
        value={filter.text}
        onChange={(e) => change({ text: e.target.value })}
      />
      <select
        aria-label="Problem source"
        value={filter.provider}
        onChange={(e) =>
          change({ provider: e.target.value as ProblemFilter["provider"] })
        }
      >
        <option value="all">All sources</option>
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {PROVIDER_LABEL[p]}
          </option>
        ))}
      </select>
      <select
        aria-label="Problem severity"
        value={filter.severity}
        onChange={(e) =>
          change({
            severity: Number(e.target.value) as ProblemFilter["severity"],
          })
        }
      >
        <option value={4}>All severities</option>
        <option value={2}>Errors and warnings</option>
        <option value={1}>Errors</option>
      </select>
    </div>
  );
}

/**
 * Problems of a project's files (every file without a root), by file: clangd's diagnostics
 * with its live clang-tidy checks, clang-tidy runs and the last CMake step. The same problem
 * from several of them is one row listing each. Only the rows in view are rendered, as in the
 * Output view: a file can have thousands, and clangd sends them all again after each edit.
 */
export function Problems({ root }: { root: string | null }) {
  useEditors();
  const [filter] = useFilter(root);
  const { total, rows, count } = problemRows(root, filter);
  // Whole pixels, so the virtual rows stay where the browser lays them out.
  const ROW = Math.round(22 * useIdeZoom());
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 400 });
  useLayoutEffect(() => {
    const element = scroller.current!;
    const measure = () =>
      setView({ top: element.scrollTop, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // A shorter list pulls the scroll position back before any scroll event says so.
  useLayoutEffect(() => {
    const element = scroller.current!;
    if (element.scrollTop !== view.top)
      setView({ top: element.scrollTop, height: element.clientHeight });
  }, [rows.length]);
  const first = Math.max(0, Math.floor(view.top / ROW) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((view.top + view.height) / ROW) + OVERSCAN,
  );
  return (
    <div
      className="problems"
      ref={scroller}
      onScroll={(e) =>
        setView({
          top: e.currentTarget.scrollTop,
          height: e.currentTarget.clientHeight,
        })
      }
    >
      {!total ? (
        <p className="muted problems-empty">
          No problems. The language server's diagnostics of open C/C++ files
          (with the project's live clang-tidy checks), clang-tidy runs,
          SonarQube issues and the errors of the last CMake configure or build
          appear here.
        </p>
      ) : !count ? (
        <p className="muted problems-empty">No problems match the filter.</p>
      ) : (
        <ul
          className="problems-list"
          aria-label="Problems"
          style={
            {
              height: rows.length * ROW,
              "--problem-height": `${ROW}px`,
            } as React.CSSProperties
          }
        >
          {rows.slice(first, last).map((row, index) => {
            const number = first + index;
            const { path, item } = row;
            const place = {
              style: { top: number * ROW },
              "aria-setsize": rows.length,
              "aria-posinset": number + 1,
            };
            if (!item)
              return (
                <li key={number} {...place}>
                  <div className="results-file" title={path}>
                    {row.name} <span className="muted">{row.count}</span>
                  </div>
                </li>
              );
            return (
              <li key={number} className="problem-row" {...place}>
                <button
                  type="button"
                  className={`problem severity-${item.severity}${item.stale ? " stale" : ""}`}
                  title={
                    item.stale
                      ? "The file or the build folder changed since this was found. Run the analysis again."
                      : undefined
                  }
                  onClick={() =>
                    void reveal(path, item.range.start).catch((e) =>
                      host().report(e),
                    )
                  }
                >
                  <span className="problem-severity">
                    {SEVERITY[item.severity] ?? "Info"}
                  </span>
                  <span className="problem-message">{item.message}</span>
                  {item.code !== undefined && item.code !== "" && (
                    <span className="problem-rule">{item.code}</span>
                  )}
                  <span className="muted problem-source">
                    {item.providers.map((p) => PROVIDER_LABEL[p]).join(" · ")}
                    {item.stale ? " · stale" : ""}
                  </span>
                  <span className="muted">
                    {item.range.start.line + 1}:{item.range.start.character + 1}
                  </span>
                </button>
                {item.fix && !item.stale && (
                  <button
                    type="button"
                    className="problem-fix"
                    title="Preview and apply clang-tidy's fix"
                    onClick={() =>
                      void previewFixes(`Fix: ${item.code ?? item.message}`, [
                        item.fix!,
                      ]).catch((e) => host().report(e))
                    }
                  >
                    Fix…
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
