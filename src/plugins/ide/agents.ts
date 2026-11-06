import { useSyncExternalStore } from "react";
import {
  createSession,
  disposeSession,
  getSession,
  hasSession,
  subscribe as subscribeSessions,
  type AgentName,
} from "../terminal/sessions";

/**
 * A coding agent's terminal beside the code editors: a docked panel on a session that runs
 * `claude` or `codex` in the project's folder, in the user's shell (`terminal.rs`). The panel
 * exists from the user's command until its close button, its restart or the IDE's close.
 */
export const AGENTS: { id: AgentName; name: string }[] = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];
export const agentName = (agent: AgentName) =>
  AGENTS.find((a) => a.id === agent)?.name ?? agent;

export interface AgentPanel {
  id: string;
  project: string;
  agent: AgentName;
  directory: string;
  session: string;
}
const panels = new Map<string, AgentPanel>();
const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((fn) => fn());
}
export function subscribe(listener: () => void) {
  const stop = subscribeSessions(listener);
  listeners.add(listener);
  return () => {
    stop();
    listeners.delete(listener);
  };
}
export function createAgentPanel(
  project: string,
  agent: AgentName,
  directory: string,
) {
  const id = crypto.randomUUID();
  panels.set(id, {
    id,
    project,
    agent,
    directory,
    session: createSession(directory, null, null, null, agent),
  });
  emit();
  return id;
}
export const agentPanel = (id: string) => panels.get(id) ?? null;
export const agentPanelOf = (project: string, agent: AgentName) =>
  [...panels.values()].find((p) => p.project === project && p.agent === agent);
export const agentProject = (id: string) => panels.get(id)?.project ?? null;
export const agentTitle = (id: string) => {
  const panel = panels.get(id);
  return panel ? agentName(panel.agent) : "Agent";
};
/** Ends the session and starts the agent again in the same panel. */
export function restartAgent(id: string) {
  const panel = panels.get(id);
  if (!panel) return;
  disposeSession(panel.session);
  panels.set(id, {
    ...panel,
    session: createSession(panel.directory, null, null, null, panel.agent),
  });
  emit();
}
export function disposeAgentPanel(id: string) {
  const panel = panels.get(id);
  if (!panel) return;
  panels.delete(id);
  disposeSession(panel.session);
  emit();
}
export function useAgentPanel(id: string) {
  useSyncExternalStore(subscribe, () => version);
  const panel = panels.get(id) ?? null;
  return {
    panel,
    ended:
      !!panel &&
      hasSession(panel.session) &&
      ["exited", "failed"].includes(getSession(panel.session).status),
  };
}
