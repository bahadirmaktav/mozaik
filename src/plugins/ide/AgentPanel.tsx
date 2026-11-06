import { lazy, Suspense } from "react";
import type { ViewProps } from "../contract";
import { CloseIcon } from "../../components/Icons";
import { agentName, restartAgent, useAgentPanel } from "./agents";
import type { AgentName } from "../terminal/sessions";
import { host } from "./editors";
import { DockToggle } from "./Panel";

const TerminalView = lazy(() => import("../terminal/Terminal"));

/** Drawn here, nothing is loaded: a sunburst for Claude Code, a prompt for Codex. */
export function AgentIcon({ agent }: { agent: AgentName }) {
  return agent === "claude" ? (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="agent-icon claude">
      <path
        d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.4 3.4l2.8 2.8M9.8 9.8l2.8 2.8M12.6 3.4 9.8 6.2M6.2 9.8l-2.8 2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="agent-icon codex">
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="m4.5 6 2 2-2 2M8.5 10.5h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A coding agent's terminal beside the code: its bar names it and minimizes, restarts or
 * ends it; minimized, only a narrow bar with its icon stays and the session keeps running.
 */
export default function AgentPanel({
  instanceId,
  focused,
  collapsed,
  onCollapse,
}: ViewProps) {
  const { panel, ended } = useAgentPanel(instanceId);
  if (!panel) return null;
  const name = agentName(panel.agent);
  if (collapsed)
    return (
      <div className="agent-panel collapsed">
        <button
          type="button"
          aria-label={`Restore ${name}`}
          title={`Restore ${name}`}
          onClick={() => onCollapse?.(false)}
        >
          <AgentIcon agent={panel.agent} />
        </button>
      </div>
    );
  return (
    <div className="agent-panel">
      <div className="ide-bar agent-bar">
        <span className="agent-title">
          <AgentIcon agent={panel.agent} />
          {name}
        </span>
        <div className="ide-bar-actions">
          {ended && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={() => restartAgent(panel.id)}
            >
              Restart
            </button>
          )}
          <DockToggle collapsed={false} label="agent" onCollapse={onCollapse} />
          <button
            type="button"
            className="ide-panel-icon"
            aria-label={`Close ${name}`}
            title={`Close ${name}`}
            onClick={() => host().closeTab(panel.id)}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <div className="agent-body">
        <Suspense fallback={null}>
          <TerminalView
            key={panel.session}
            instanceId={panel.session}
            focused={focused}
          />
        </Suspense>
      </div>
    </div>
  );
}
