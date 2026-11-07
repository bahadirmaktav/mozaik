import { lazy, Suspense } from "react";
import type { ViewProps } from "../contract";
import { CloseIcon } from "../../components/Icons";
import {
  addAgentSession,
  AGENTS,
  closeAgentSession,
  restartAgentSession,
  selectAgentSession,
  sessionName,
  sessionsOf,
  showAgent,
  useAgentPanel,
  type AgentSession,
} from "./agents";
import type { AgentName } from "../terminal/sessions";
import { host } from "./editors";
import { DockToggle } from "./Panel";

const TerminalView = lazy(() => import("../terminal/Terminal"));

/** Inline, nothing is loaded: a sunburst for Claude Code, the Codex extension's mark for Codex. */
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
    <svg viewBox="0 0 24 24" aria-hidden="true" className="agent-icon codex">
      <path
        d="M13.798 23.976a5.7 5.7 0 0 1-2.26-.456 6.1 6.1 0 0 1-1.903-1.27 5.7 5.7 0 0 1-1.88.311 5.75 5.75 0 0 1-2.95-.79 6.2 6.2 0 0 1-2.188-2.159q-.81-1.366-.809-3.045 0-.695.19-1.51a6.4 6.4 0 0 1-1.475-2.038A5.95 5.95 0 0 1 0 10.573Q0 9.278.547 8.08q.547-1.2 1.523-2.062a5.5 5.5 0 0 1 2.307-1.223A5.7 5.7 0 0 1 5.472 2.35 6.1 6.1 0 0 1 7.565.623 5.8 5.8 0 0 1 10.206 0q1.19 0 2.26.456a6.1 6.1 0 0 1 1.903 1.27 5.7 5.7 0 0 1 1.88-.311q1.594 0 2.95.79a6 6 0 0 1 2.165 2.159q.832 1.366.832 3.045 0 .695-.19 1.51a6.3 6.3 0 0 1 1.475 2.062q.523 1.15.523 2.422a5.9 5.9 0 0 1-.547 2.493q-.547 1.2-1.546 2.086a5.4 5.4 0 0 1-2.284 1.199 5.56 5.56 0 0 1-1.118 2.445 5.9 5.9 0 0 1-2.07 1.727 5.8 5.8 0 0 1-2.64.623m-5.876-2.997q1.19 0 2.07-.504l4.472-2.589a.53.53 0 0 0 .238-.455v-2.062L8.945 18.7a.96.96 0 0 1-1.047 0l-4.496-2.613a.7.7 0 0 1-.024.168v.287q0 1.224.571 2.254a4.24 4.24 0 0 0 1.642 1.583q1.047.6 2.331.599m.238-3.908a.6.6 0 0 0 .262.072q.118 0 .238-.072l1.784-1.031-5.734-3.357q-.522-.312-.523-.935V6.545a4.3 4.3 0 0 0-1.903 1.63 4.25 4.25 0 0 0-.714 2.398q0 1.176.595 2.254.594 1.08 1.546 1.63zm5.638 5.323q1.26 0 2.284-.576a4.3 4.3 0 0 0 1.618-1.582q.595-1.008.595-2.254v-5.179a.47.47 0 0 0-.238-.431l-1.808-1.055v6.689q0 .624-.524.935l-4.496 2.613a4.3 4.3 0 0 0 2.57.84m.904-8.776v-3.26l-2.688-1.535-2.712 1.535v3.26l2.712 1.535zM7.756 5.97q0-.623.523-.935l4.496-2.613a4.3 4.3 0 0 0-2.569-.84q-1.26 0-2.284.576A4.3 4.3 0 0 0 6.304 3.74q-.57 1.008-.57 2.254v5.155q0 .287.237.455l1.785 1.055zM19.84 17.43a4.16 4.16 0 0 0 1.88-1.63 4.33 4.33 0 0 0 .713-2.397q0-1.176-.595-2.254-.594-1.08-1.546-1.63l-4.449-2.59q-.143-.096-.261-.072a.46.46 0 0 0-.238.072L13.56 7.936l5.758 3.38a.9.9 0 0 1 .38.384q.143.216.143.528zM15.059 5.25q.524-.335 1.047 0l4.52 2.662V7.48q0-1.15-.57-2.181A4.14 4.14 0 0 0 18.46 3.62q-1.023-.623-2.379-.623-1.19 0-2.07.503L9.54 6.09a.53.53 0 0 0-.238.455v2.062z"
        fill="currentColor"
      />
    </svg>
  );
}

/** An agent's icon with how many of its sessions are open at its lower right. */
export function AgentButton({
  agent,
  label,
  count,
  pressed,
  onClick,
}: {
  agent: AgentName;
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`agent-toggle${pressed ? " on" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <AgentIcon agent={agent} />
      {count > 0 && (
        <span className="agent-count" data-testid={`${agent}-sessions`}>
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * The coding agents' panel. Its bar has the icons, as tabs of the agents: a press shows that
 * agent, and on the agent shown adds a session. The shown agent's sessions are tabs beside them.
 * Minimizing takes the panel out of the layout; the sessions keep running.
 */
export default function AgentPanel({ instanceId, focused }: ViewProps) {
  const { panel, shown, ended } = useAgentPanel(instanceId);
  if (!panel) return null;
  const closeSession = (session: AgentSession) => {
    if (closeAgentSession(panel.id, session.id) === 0)
      host().hideAgents(panel.id);
  };
  return (
    <div className="agent-panel">
      <div className="ide-bar agent-bar">
        <div className="agent-choices" role="group" aria-label="Coding agents">
          {AGENTS.map(({ id, name }) => {
            const count = sessionsOf(panel, id).length;
            const current = panel.agent === id && count > 0;
            return (
              <AgentButton
                key={id}
                agent={id}
                label={current ? `New ${name} Session` : `Show ${name}`}
                count={count}
                pressed={current}
                onClick={() =>
                  current
                    ? addAgentSession(panel.id, id)
                    : showAgent(panel.id, id)
                }
              />
            );
          })}
        </div>
        <div className="agent-sessions" role="tablist" aria-label="Sessions">
          {sessionsOf(panel, panel.agent).map((session) => (
            <div
              key={session.id}
              role="presentation"
              className={`agent-session${session.id === shown?.id ? " selected" : ""}`}
              // A new session's tab may start past the end of the bar.
              ref={(tab) => {
                if (session.id === shown?.id)
                  tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
              }}
              // The middle button closes it, as any tab; its autoscroll never starts.
              onMouseDown={(e) => {
                if (e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                closeSession(session);
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={session.id === shown?.id}
                onClick={() => selectAgentSession(panel.id, session.id)}
              >
                Session {session.number}
              </button>
              <button
                type="button"
                className="agent-session-close"
                tabIndex={-1}
                aria-label={`Close ${sessionName(session)}`}
                title="End this session"
                onClick={() => closeSession(session)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </div>
        <div className="ide-bar-actions">
          {ended && shown && (
            <button
              type="button"
              className="ide-panel-action"
              onClick={() => restartAgentSession(panel.id, shown.id)}
            >
              Restart
            </button>
          )}
          <DockToggle
            collapsed={false}
            label="agents"
            onCollapse={() => host().hideAgents(panel.id)}
          />
        </div>
      </div>
      <div className="agent-body">
        {shown && (
          <Suspense fallback={null}>
            <TerminalView
              key={shown.id}
              instanceId={shown.id}
              focused={focused}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}
