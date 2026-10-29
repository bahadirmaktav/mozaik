import { lazy, Suspense } from "react";
import type { ViewProps } from "../contract";
import { ChevronIcon } from "../../components/Icons";
import { useTerminalSession } from "../terminal/sessions";
import { restartTerminal, showView, usePanel, type PanelView } from "./panels";
import { Problems } from "./Problems";
import { useProject } from "./projects";

const TerminalView = lazy(() => import("../terminal/Terminal"));

const VIEWS: [PanelView, string][] = [
  ["problems", "Problems"],
  ["terminal", "Terminal"],
];

/** The IDE's bottom panel: its views are its bar; minimized, only the bar stays. */
export default function Panel({
  instanceId,
  focused,
  collapsed,
  onCollapse,
}: ViewProps) {
  const panel = usePanel(instanceId);
  const project = useProject(panel?.project ?? "");
  const session = useTerminalSession(panel?.terminal ?? "");
  if (!panel) return null;
  const ended = session?.status === "exited" || session?.status === "failed";
  return (
    <div className="ide-panel">
      <div className="ide-panel-bar ide-bar">
        <div role="tablist" aria-label="Panel views">
          {VIEWS.map(([view, label]) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={panel.view === view}
              onClick={() => {
                showView(panel.id, view);
                if (collapsed) onCollapse?.(false);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ide-bar-actions">
          {!collapsed && panel.view === "terminal" && ended && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={() => restartTerminal(panel.id)}
            >
              Restart Terminal
            </button>
          )}
          <DockToggle
            collapsed={!!collapsed}
            label="panel"
            onCollapse={onCollapse}
          />
        </div>
      </div>
      {!collapsed && (
        <div className="ide-panel-body">
          {panel.view === "problems" ? (
            <Problems root={project?.root ?? null} />
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
      )}
    </div>
  );
}

/** Minimizes a docked IDE panel to its bar, or restores it. */
export function DockToggle({
  collapsed,
  label,
  onCollapse,
}: {
  collapsed: boolean;
  label: string;
  onCollapse?: (collapsed: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`ide-dock-toggle ${label}${collapsed ? " collapsed" : ""}`}
      aria-label={`${collapsed ? "Restore" : "Minimize"} ${label}`}
      title={`${collapsed ? "Restore" : "Minimize"} ${label}`}
      onClick={() => onCollapse?.(!collapsed)}
    >
      <ChevronIcon />
    </button>
  );
}
