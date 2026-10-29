import { lazy, Suspense } from "react";
import type { ViewProps } from "../contract";
import { useTerminalSession } from "../terminal/sessions";
import { useEditors } from "./editors";
import { restartTerminal, showView, usePanel, type PanelView } from "./panels";
import { within } from "./paths";
import { Problems } from "./Problems";
import { useProject } from "./projects";

const TerminalView = lazy(() => import("../terminal/Terminal"));

const VIEWS: [PanelView, string][] = [
  ["problems", "Problems"],
  ["terminal", "Terminal"],
];

/** The IDE's bottom panel: Problems or the project terminal, over the status bar. */
export default function Panel({ instanceId, focused }: ViewProps) {
  const panel = usePanel(instanceId);
  const project = useProject(panel?.project ?? "");
  const session = useTerminalSession(panel?.terminal ?? "");
  if (!panel) return null;
  const root = project?.root ?? null;
  const ended = session?.status === "exited" || session?.status === "failed";
  return (
    <div className="ide-panel">
      <div className="ide-panel-bar">
        <div role="tablist" aria-label="Panel views">
          {VIEWS.map(([view, label]) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={panel.view === view}
              onClick={() => showView(panel.id, view)}
            >
              {label}
            </button>
          ))}
        </div>
        {panel.view === "terminal" && ended && (
          <button
            type="button"
            className="ide-panel-action"
            onClick={() => restartTerminal(panel.id)}
          >
            Restart Terminal
          </button>
        )}
      </div>
      <div className="ide-panel-body">
        {panel.view === "problems" ? (
          <Problems root={root} />
        ) : (
          panel.terminal && (
            <Suspense fallback={null}>
              <TerminalView
                key={panel.terminal}
                instanceId={panel.terminal}
                focused={focused}
              />
            </Suspense>
          )
        )}
      </div>
      <StatusBar
        root={root}
        branch={project?.git?.branch ?? null}
        onProblems={() => showView(panel.id, "problems")}
      />
    </div>
  );
}

function StatusBar({
  root,
  branch,
  onProblems,
}: {
  root: string | null;
  branch: string | null;
  onProblems: () => void;
}) {
  const { diagnostics } = useEditors();
  let errors = 0,
    warnings = 0;
  for (const { path, items } of diagnostics.values())
    if (!root || within(root, path))
      for (const d of items) {
        if (d.severity === 1) errors++;
        else if (d.severity === 2) warnings++;
      }
  return (
    <div className="ide-status" role="status">
      {branch && (
        <span className="ide-status-branch" title="Git branch">
          ⎇ {branch}
        </span>
      )}
      <button
        type="button"
        className="ide-status-problems"
        onClick={onProblems}
        aria-label={`Problems: ${errors} errors, ${warnings} warnings`}
      >
        ⊗ {errors} ⚠ {warnings}
      </button>
    </div>
  );
}
