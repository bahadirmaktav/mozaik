import { lazy, Suspense } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { ViewProps } from "../contract";
import { ChevronIcon } from "../../components/Icons";
import { native } from "../../services/native";
import { useTerminalSession } from "../terminal/sessions";
import { run as runAgain, useCMake } from "./cmake";
import { host } from "./editors";
import { Output } from "./Output";
import { clearOutput } from "./channels";
import { restartTerminal, showView, usePanel, type PanelView } from "./panels";
import { Problems } from "./Problems";
import { useProject } from "./projects";

const TerminalView = lazy(() => import("../terminal/Terminal"));

const VIEWS: [PanelView, string][] = [
  ["problems", "Problems"],
  ["output", "Output"],
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
  const running = useTerminalSession(panel?.run?.session ?? "");
  const cmake = useCMake(panel?.project ?? "");
  if (!panel) return null;
  const ended = session?.status === "exited" || session?.status === "failed";
  const runEnded = running?.status === "exited" || running?.status === "failed";
  const views: [PanelView, string][] = panel.run
    ? [...VIEWS, ["run", `Run: ${panel.run.target}`]]
    : VIEWS;
  return (
    <div className="ide-panel">
      <div className="ide-panel-bar ide-bar">
        <div role="tablist" aria-label="Panel views">
          {views.map(([view, label]) => (
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
          {!collapsed && panel.view === "output" && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={() => clearOutput("CMake")}
            >
              Clear
            </button>
          )}
          {!collapsed && panel.view === "run" && panel.run && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={() => {
                if (!runEnded) {
                  if (isTauri())
                    void native("close_terminal", {
                      id: panel.run!.session,
                    }).catch(() => {});
                } else
                  void runAgain(panel.project).catch((e) => host().report(e));
              }}
            >
              {runEnded ? "Run Again" : "Stop"}
            </button>
          )}
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
          ) : panel.view === "output" ? (
            <Output channel="CMake" base={cmake.info?.buildDir ?? null} />
          ) : panel.view === "run" ? (
            panel.run && (
              <Suspense fallback={null}>
                <TerminalView
                  key={panel.run.session}
                  instanceId={panel.run.session}
                  focused={focused}
                />
              </Suspense>
            )
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
