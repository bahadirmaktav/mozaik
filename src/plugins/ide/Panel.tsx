import { lazy, Suspense } from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { ViewProps } from "../contract";
import {
  ChevronIcon,
  CloseIcon,
  PlusIcon,
  SplitIcon,
} from "../../components/Icons";
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
  groupOf,
  killTerminal,
  newTerminal,
  restartTerminal,
  selectTerminal,
  showView,
  splitTerminal,
  usePanel,
  type PanelView,
} from "./panels";
import { Problems, ProblemsFilter } from "./Problems";
import { useProject } from "./projects";
import { useFeatures } from "./features";

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
  const on = useFeatures();
  if (!panel) return null;
  const ended = session?.status === "exited" || session?.status === "failed";
  const runEnded = running?.status === "exited" || running?.status === "failed";
  // The Debug Console goes with Run and Debug (Settings → IDE → Features).
  const base = on("debugging") ? VIEWS : VIEWS.filter(([v]) => v !== "debug");
  const views: [PanelView, string][] = panel.run
    ? [...base, ["run", `Run: ${panel.run.target}`]]
    : base;
  const shown = views.some(([v]) => v === panel.view) ? panel.view : "problems";
  return (
    <div className="ide-panel">
      <div className="ide-panel-bar ide-bar">
        <div role="tablist" aria-label="Panel views">
          {views.map(([view, label]) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={shown === view}
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
          {!collapsed && shown === "problems" && (
            <ProblemsFilter root={project?.root ?? null} />
          )}
          {!collapsed && shown === "output" && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={() => clearOutput(panel.channel)}
            >
              Clear
            </button>
          )}
          {!collapsed && shown === "debug" && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={clearConsole}
            >
              Clear
            </button>
          )}
          {!collapsed && shown === "run" && panel.run && (
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
          {!collapsed && shown === "terminal" && ended && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={() => restartTerminal(panel.id)}
            >
              Restart Terminal
            </button>
          )}
          {!collapsed && shown === "terminal" && (
            // The shell choice sits against New Terminal; terminals close from their list.
            <span className="ide-panel-icons">
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
              <button
                type="button"
                className="ide-panel-icon"
                aria-label="New Terminal"
                title="New Terminal"
                onClick={() => newTerminal(panel.id)}
              >
                <PlusIcon />
              </button>
            </span>
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
          {shown === "problems" ? (
            <Problems root={project?.root ?? null} />
          ) : shown === "output" ? (
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
          ) : shown === "debug" ? (
            <DebugConsole />
          ) : shown === "run" ? (
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
                <div className="panel-terminal-group">
                  {groupOf(panel, panel.terminal).map((id) => (
                    // Clicking into a split terminal makes it the active one.
                    <div
                      key={id}
                      className="panel-terminal"
                      onPointerDownCapture={() => selectTerminal(panel.id, id)}
                    >
                      <Suspense fallback={null}>
                        <TerminalView
                          instanceId={id}
                          focused={focused && id === panel.terminal}
                        />
                      </Suspense>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted panel-terminals-empty">
                  No terminal. New Terminal (+) starts one.
                </p>
              )}
              {panel.groups.length > 0 && (
                <TerminalList
                  panel={panel.id}
                  groups={panel.groups}
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

/**
 * The panel's terminals, right of the shown ones, as in VS Code: split terminals are
 * indented under the first of their group; hovering one offers Split and Kill.
 */
function TerminalList({
  panel,
  groups,
  active,
}: {
  panel: string;
  groups: string[][];
  active: string | null;
}) {
  // Titles follow the sessions (shell name, exited).
  useTerminalSession(active ?? "");
  let number = 0;
  return (
    <ul className="panel-terminal-list" aria-label="Terminals">
      {groups.flatMap((group) =>
        group.map((id, index) => {
          const n = ++number;
          const place =
            group.length < 2
              ? undefined
              : index === 0
                ? "first"
                : index === group.length - 1
                  ? "last"
                  : "middle";
          return (
            <li key={id} aria-current={id === active} data-split={place}>
              <button type="button" onClick={() => selectTerminal(panel, id)}>
                {n}: {hasSession(id) ? sessionTitle(id) : "Closed"}
              </button>
              <button
                type="button"
                aria-label={`Split terminal ${n}`}
                title="Split Terminal"
                onClick={() => splitTerminal(panel, id)}
              >
                <SplitIcon />
              </button>
              <button
                type="button"
                aria-label={`Kill terminal ${n}`}
                title="Kill Terminal"
                onClick={() => killTerminal(panel, id)}
              >
                <CloseIcon />
              </button>
            </li>
          );
        }),
      )}
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
      className={`ide-dock-toggle for-${label}${collapsed ? " collapsed" : ""}`}
      aria-label={`${collapsed ? "Restore" : "Minimize"} ${label}`}
      title={`${collapsed ? "Restore" : "Minimize"} ${label}`}
      onClick={() => onCollapse?.(!collapsed)}
    >
      <ChevronIcon />
    </button>
  );
}
