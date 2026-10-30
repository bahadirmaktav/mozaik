import { lazy, Suspense } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { ViewProps } from "../contract";
import { ChevronIcon, CloseIcon, PlusIcon } from "../../components/Icons";
import { native } from "../../services/native";
import { loadShells } from "../terminal/ShellSetting";
import {
  hasSession,
  sessionTitle,
  useTerminalSession,
} from "../terminal/sessions";
import { run as runAgain, useCMake } from "./cmake";
import { clearConsole } from "./debug";
import { DebugConsole } from "./DebugConsole";
import { host, message } from "./editors";
import { Output } from "./Output";
import { CHANNELS, clearOutput } from "./channels";
import {
  killTerminal,
  newTerminal,
  restartTerminal,
  selectTerminal,
  showView,
  usePanel,
  type PanelView,
} from "./panels";
import { Problems } from "./Problems";
import { useProject } from "./projects";

const TerminalView = lazy(() => import("../terminal/Terminal"));

/** New Terminal with a shell other than the default one, chosen in the palette. */
async function pickShell(panel: string) {
  const choices = await loadShells();
  const id = await host().pick(
    "Select a shell for the new terminal",
    choices.shells.map((shell) => ({
      id: shell.id,
      label: shell.name,
      detail: shell.id === choices.system ? "system default" : shell.id,
    })),
  );
  if (id) newTerminal(panel, id);
}

const VIEWS: [PanelView, string][] = [
  ["problems", "Problems"],
  ["output", "Output"],
  ["debug", "Debug Console"],
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
              onClick={() => clearOutput(panel.channel)}
            >
              Clear
            </button>
          )}
          {!collapsed && panel.view === "debug" && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={clearConsole}
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
          {!collapsed && panel.view === "terminal" && (
            <>
              <button
                type="button"
                className="ide-panel-icon"
                aria-label="New Terminal"
                title="New Terminal"
                onClick={() => newTerminal(panel.id)}
              >
                <PlusIcon />
              </button>
              <button
                type="button"
                className="ide-panel-icon"
                aria-label="New Terminal with Shell…"
                title="New Terminal with Shell…"
                onClick={() =>
                  void pickShell(panel.id).catch((e) =>
                    host().report(message(e)),
                  )
                }
              >
                <ChevronIcon />
              </button>
              {panel.terminal && (
                <button
                  type="button"
                  className="ide-panel-icon"
                  aria-label="Kill Terminal"
                  title="Kill Terminal"
                  onClick={() => killTerminal(panel.id, panel.terminal!)}
                >
                  <CloseIcon />
                </button>
              )}
            </>
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
            <div className="output-view">
              <div
                className="output-channels"
                role="tablist"
                aria-label="Output channels"
                aria-orientation="vertical"
              >
                {CHANNELS.map((channel) => (
                  <button
                    key={channel}
                    type="button"
                    role="tab"
                    aria-selected={panel.channel === channel}
                    onClick={() => showView(panel.id, "output", channel)}
                  >
                    {channel}
                  </button>
                ))}
              </div>
              <Output
                channel={panel.channel}
                base={
                  panel.channel === "CMake"
                    ? (cmake.info?.buildDir ?? null)
                    : (project?.root ?? null)
                }
              />
            </div>
          ) : panel.view === "debug" ? (
            <DebugConsole />
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
            <div className="panel-terminals">
              {panel.terminal ? (
                <Suspense fallback={null}>
                  <TerminalView
                    key={panel.terminal}
                    instanceId={panel.terminal}
                    focused={focused}
                  />
                </Suspense>
              ) : (
                <p className="muted panel-terminals-empty">
                  No terminal. New Terminal (+) starts one.
                </p>
              )}
              {panel.terminals.length > 1 && (
                <TerminalList
                  panel={panel.id}
                  terminals={panel.terminals}
                  active={panel.terminal}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The panel's terminals, right of the shown one, as in VS Code. */
function TerminalList({
  panel,
  terminals,
  active,
}: {
  panel: string;
  terminals: string[];
  active: string | null;
}) {
  // Titles follow the sessions (shell name, exited).
  useTerminalSession(active ?? "");
  return (
    <ul className="panel-terminal-list" aria-label="Terminals">
      {terminals.map((id, index) => (
        <li key={id} aria-current={id === active}>
          <button type="button" onClick={() => selectTerminal(panel, id)}>
            {index + 1}: {hasSession(id) ? sessionTitle(id) : "Closed"}
          </button>
          <button
            type="button"
            aria-label={`Kill terminal ${index + 1}`}
            title="Kill Terminal"
            onClick={() => killTerminal(panel, id)}
          >
            <CloseIcon />
          </button>
        </li>
      ))}
    </ul>
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
