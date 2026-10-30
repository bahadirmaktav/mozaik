import { useEffect } from "react";
import { CloseIcon, FilesIcon, RestartIcon } from "../../components/Icons";
import {
  chooseCoverage,
  clearCoverage,
  loadCoverage,
  useCoverage,
} from "./coverage";
import {
  coverageTree,
  percent,
  type CoverageNode,
  type Totals,
} from "./coverageModel";
import { host } from "./editors";
import { relative } from "./paths";
import type { Project } from "./projects";
import { useSectionState } from "./Sections";

/** A line coverage bar and percentage, red below half, green at all lines. */
function Meter({ totals }: { totals: Totals }) {
  const { covered, total } = totals.lines;
  const share = total ? covered / total : 0;
  const level = share >= 1 ? "full" : share >= 0.5 ? "some" : "low";
  return (
    <span
      className={`coverage-meter ${level}`}
      title={`${covered} of ${total} lines${
        totals.branches.total
          ? ` · ${totals.branches.covered} of ${totals.branches.total} branches`
          : ""
      }${
        totals.functions.total
          ? ` · ${totals.functions.covered} of ${totals.functions.total} functions`
          : ""
      }`}
    >
      <span className="coverage-bar" aria-hidden>
        <span style={{ width: `${share * 100}%` }} />
      </span>
      <span className="coverage-percent">{percent(totals.lines) || "–"}</span>
    </span>
  );
}

/**
 * The project's coverage report, after VS Code's Test Coverage: totals, then the report's
 * files in folders with their line coverage. A file opens read only beside the code, its
 * lines coloured by coverage. The report is an LCOV or Cobertura file the user picks once;
 * it is read again when it changes on disk.
 */
export function Coverage({ project }: { project: Project }) {
  const state = useCoverage(project.id);
  const { closed, toggle } = useSectionState(project, "coverage");
  const root = project.root ?? "";
  useEffect(() => {
    if (!state.loaded) void loadCoverage(project.id);
  }, [project.id, state.loaded]);
  const report = state.report;
  const summary = report
    ? [
        ["Lines", report.totals.lines],
        ["Functions", report.totals.functions],
        ["Branches", report.totals.branches],
      ]
        .filter(([, count]) => (count as Totals["lines"]).total)
        .map(([name, count]) => `${name} ${percent(count as Totals["lines"])}`)
        .join(" · ")
    : "";
  const rows = (nodes: CoverageNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      const indent = { paddingLeft: 8 + depth * 12 };
      if (node.kind === "file") {
        const stale = state.stale.has(node.id);
        return (
          <li key={node.id}>
            <button
              type="button"
              className="todo-item coverage-file"
              style={{ paddingLeft: 26 + depth * 12 }}
              title={`${node.file.path}${stale ? " (changed since the report)" : ""}`}
              onClick={() => host().showCoverage(project.id, node.file.path)}
            >
              <span className="todo-text">{node.name}</span>
              {stale && (
                <span
                  className="coverage-stale"
                  role="img"
                  aria-label="Changed since the report"
                >
                  ●
                </span>
              )}
              <Meter totals={node.totals} />
            </button>
          </li>
        );
      }
      const open = !closed.has(node.id);
      return (
        <li key={node.id}>
          <button
            type="button"
            className="todo-group"
            style={indent}
            aria-expanded={open}
            title={node.name}
            onClick={() => toggle(node.id)}
          >
            <span className="project-twisty" aria-hidden>
              {open ? "▾" : "▸"}
            </span>
            <span className="todo-group-name">{node.name}</span>
            <Meter totals={node.totals} />
          </button>
          {open && <ul>{rows(node.children, depth + 1)}</ul>}
        </li>
      );
    });
  const where = report ? (relative(root, report.path) ?? report.path) : "";
  return (
    <div className="todo-view coverage-view">
      <div className="todo-bar">
        <span className="muted" title={summary}>
          {state.busy ? "Reading the report…" : summary}
        </span>
        <button
          type="button"
          aria-label="Open Coverage Report"
          title="Open Coverage Report…"
          disabled={state.busy}
          onClick={() => void chooseCoverage(project.id)}
        >
          <FilesIcon />
        </button>
        {report && (
          <>
            <button
              type="button"
              aria-label="Reload Coverage Report"
              title="Reload Coverage Report"
              disabled={state.busy}
              onClick={() => void loadCoverage(project.id)}
            >
              <RestartIcon />
            </button>
            <button
              type="button"
              aria-label="Close Coverage Report"
              title="Close Coverage Report (the file stays)"
              disabled={state.busy}
              onClick={() => void clearCoverage(project.id)}
            >
              <CloseIcon />
            </button>
          </>
        )}
      </div>
      {state.error && (
        <p className="project-error" role="alert">
          {state.error}
        </p>
      )}
      {report && (
        <p className="coverage-source" title={report.path}>
          {where}
          {report.modified !== null &&
            ` · ${new Date(report.modified).toLocaleString()}`}
          {state.stale.size > 0 &&
            ` · ${state.stale.size} file${state.stale.size === 1 ? "" : "s"} changed since`}
        </p>
      )}
      {!report && !state.busy && (
        <div className="project-hint">
          <p>
            Open a coverage report (LCOV <code>.info</code> or Cobertura{" "}
            <code>.xml</code>) that a coverage build wrote, for example with
            gcovr or llvm-cov. Mozaik reads it again whenever it changes.
          </p>
          <button
            type="button"
            className="project-open"
            onClick={() => void chooseCoverage(project.id)}
          >
            Open Coverage Report…
          </button>
        </div>
      )}
      {report && !report.files.length && (
        <p className="project-hint">The report names no files.</p>
      )}
      {report && (
        <ul className="todo-list" aria-label="Covered files">
          {rows(coverageTree(report.files, root), 0)}
        </ul>
      )}
    </div>
  );
}
