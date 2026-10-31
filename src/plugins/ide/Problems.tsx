import { useSyncExternalStore } from "react";
import { allProblems, host, reveal, useEditors } from "./editors";
import { displayPath } from "./lsp";
import { within } from "./paths";
import {
  groupProblems,
  matchesFilter,
  noFilter,
  PROVIDER_LABEL,
  PROVIDERS,
  type ProblemFilter,
} from "./analysisModel";
import { previewFixes } from "./analysis";

const SEVERITY = ["", "Error", "Warning", "Info", "Hint"];
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
/** The project's problems by file, those the filter keeps, and both counts. */
function problemFiles(root: string | null, filter: ProblemFilter) {
  const all = allProblems()
    .filter((f) => !root || within(root, f.path))
    .map((f) => ({ path: f.path, items: groupProblems(f.items) }));
  const total = all.reduce((n, f) => n + f.items.length, 0);
  const files = all
    .map(({ path, items }) => ({
      path,
      items: items.filter((p) => matchesFilter(p, displayPath(path), filter)),
    }))
    .filter((f) => f.items.length)
    .sort((a, b) => displayPath(a.path).localeCompare(displayPath(b.path)));
  const count = files.reduce((n, f) => n + f.items.length, 0);
  return { total, files, count };
}

/** The Problems filter, at the right of the bottom panel's bar as in VS Code. */
export function ProblemsFilter({ root }: { root: string | null }) {
  useEditors();
  const [filter, change] = useFilter(root);
  const { total, count } = problemFiles(root, filter);
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
 * from several of them is one row listing each.
 */
export function Problems({ root }: { root: string | null }) {
  useEditors();
  const [filter] = useFilter(root);
  const { total, files, count } = problemFiles(root, filter);
  return (
    <div className="problems">
      {!total ? (
        <p className="muted problems-empty">
          No problems. The language server's diagnostics of open C/C++ files
          (with the project's live clang-tidy checks), clang-tidy runs and the
          errors of the last CMake configure or build appear here.
        </p>
      ) : !count ? (
        <p className="muted problems-empty">No problems match the filter.</p>
      ) : (
        <ul className="problems-list" aria-label="Problems">
          {files.map(({ path, items }) => (
            <li key={path}>
              <div className="results-file" title={path}>
                {displayPath(path)}{" "}
                <span className="muted">{items.length}</span>
              </div>
              <ul>
                {[...items]
                  .sort(
                    (a, b) =>
                      a.severity - b.severity ||
                      a.range.start.line - b.range.start.line,
                  )
                  .map((item, index) => (
                    <li key={index} className="problem-row">
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
                          {item.providers
                            .map((p) => PROVIDER_LABEL[p])
                            .join(" · ")}
                          {item.stale ? " · stale" : ""}
                        </span>
                        <span className="muted">
                          {item.range.start.line + 1}:
                          {item.range.start.character + 1}
                        </span>
                      </button>
                      {item.fix && !item.stale && (
                        <button
                          type="button"
                          className="problem-fix"
                          title="Preview and apply clang-tidy's fix"
                          onClick={() =>
                            void previewFixes(
                              `Fix: ${item.code ?? item.message}`,
                              [item.fix!],
                            ).catch((e) => host().report(e))
                          }
                        >
                          Fix…
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
