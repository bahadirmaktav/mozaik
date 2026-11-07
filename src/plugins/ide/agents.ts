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
 * The coding agents beside the code editors: a project's one docked panel, over terminal
 * sessions that run `claude` or `codex` in its folder, in the user's shell (`terminal.rs`).
 * The sessions live here, not in the layout: minimized, the panel leaves the layout and they go
 * on, and it returns to the same ones. They end with their own close button, or the IDE's close.
 */
export const AGENTS: { id: AgentName; name: string }[] = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];
export const agentName = (agent: AgentName) =>
  AGENTS.find((a) => a.id === agent)?.name ?? agent;

export interface AgentSession {
  id: string;
  agent: AgentName;
  /** Its number among the agent's sessions; a closed one's number is not used again. */
  number: number;
}
export interface AgentPanel {
  id: string;
  project: string;
  directory: string;
  sessions: AgentSession[];
  /** The agent shown, whose sessions are the panel's tabs. */
  agent: AgentName;
  /** The session last shown of each agent. */
  selected: Partial<Record<AgentName, string>>;
  numbers: Partial<Record<AgentName, number>>;
  /** The code's share of the split around the panel when it was minimized. */
  codeShare: number | null;
}
const panels = new Map<string, AgentPanel>();
const listeners = new Set<() => void>();
let version = 0;
function emit() {
  version++;
  listeners.forEach((fn) => fn());
}
function change(id: string, next: Partial<AgentPanel>) {
  const panel = panels.get(id);
  if (!panel) return;
  panels.set(id, { ...panel, ...next });
  emit();
}
export function subscribe(listener: () => void) {
  const stop = subscribeSessions(listener);
  listeners.add(listener);
  return () => {
    stop();
    listeners.delete(listener);
  };
}
export const agentPanel = (id: string) => panels.get(id) ?? null;
export const agentPanelOf = (project: string) =>
  [...panels.values()].find((p) => p.project === project) ?? null;
export const agentProject = (id: string) => panels.get(id)?.project ?? null;
export const agentTitle = () => "Coding Agents";
export const sessionName = (session: AgentSession) =>
  `${agentName(session.agent)} ${session.number}`;
/** The project's panel, created without a session the first time. */
export function ensureAgentPanel(project: string, directory: string) {
  const known = agentPanelOf(project);
  if (known) return known.id;
  const id = crypto.randomUUID();
  panels.set(id, {
    id,
    project,
    directory,
    sessions: [],
    agent: "claude",
    selected: {},
    numbers: {},
    codeShare: null,
  });
  emit();
  return id;
}
/** The session shown: the shown agent's last one. */
export function shownSession(panel: AgentPanel) {
  return (
    panel.sessions.find((s) => s.id === panel.selected[panel.agent]) ?? null
  );
}
export const sessionsOf = (panel: AgentPanel, agent: AgentName) =>
  panel.sessions.filter((s) => s.agent === agent);
/** Starts one more session of the agent and shows it. */
export function addAgentSession(id: string, agent: AgentName) {
  const panel = panels.get(id);
  if (!panel) return;
  const number = (panel.numbers[agent] ?? 0) + 1;
  const session = {
    id: createSession(panel.directory, null, null, null, agent),
    agent,
    number,
  };
  change(id, {
    agent,
    sessions: [...panel.sessions, session],
    selected: { ...panel.selected, [agent]: session.id },
    numbers: { ...panel.numbers, [agent]: number },
  });
}
/** Shows the agent's last session; an agent without one starts its first. */
export function showAgent(id: string, agent: AgentName) {
  const panel = panels.get(id);
  if (!panel) return;
  if (sessionsOf(panel, agent).length) change(id, { agent });
  else addAgentSession(id, agent);
}
export function selectAgentSession(id: string, session: string) {
  const panel = panels.get(id);
  const agent = panel?.sessions.find((s) => s.id === session)?.agent;
  if (panel && agent)
    change(id, { agent, selected: { ...panel.selected, [agent]: session } });
}
/**
 * Ends one session; its tab's neighbor shows, or the other agent when it was this agent's last.
 * Returns how many sessions the panel has left.
 */
export function closeAgentSession(id: string, session: string) {
  const panel = panels.get(id);
  const closed = panel?.sessions.find((s) => s.id === session);
  if (!panel || !closed) return panel?.sessions.length ?? 0;
  const sessions = panel.sessions.filter((s) => s.id !== session);
  const own = sessionsOf(panel, closed.agent);
  const place = own.findIndex((s) => s.id === session);
  const next = own[place + 1] ?? own[place - 1];
  const selected = { ...panel.selected };
  if (selected[closed.agent] === session) {
    if (next) selected[closed.agent] = next.id;
    else delete selected[closed.agent];
  }
  const other = AGENTS.find((a) => a.id !== closed.agent)!.id;
  change(id, {
    sessions,
    selected,
    agent: !next && panel.agent === closed.agent ? other : panel.agent,
  });
  disposeSession(session);
  return sessions.length;
}
/** Ends the session and starts the agent again in the same tab. */
export function restartAgentSession(id: string, session: string) {
  const panel = panels.get(id);
  const known = panel?.sessions.find((s) => s.id === session);
  if (!panel || !known) return;
  const started = createSession(panel.directory, null, null, null, known.agent);
  change(id, {
    sessions: panel.sessions.map((s) =>
      s.id === session ? { ...s, id: started } : s,
    ),
    selected: { ...panel.selected, [known.agent]: started },
  });
  disposeSession(session);
}
export function rememberCodeShare(id: string, codeShare: number) {
  change(id, { codeShare });
}
export function disposeAgentPanel(id: string) {
  const panel = panels.get(id);
  if (!panel) return;
  panels.delete(id);
  panel.sessions.forEach((s) => disposeSession(s.id));
  emit();
}
/** The project's IDE closed: its minimized panel is not in the layout to be closed with it. */
export function disposeAgentsOf(project: string) {
  const panel = agentPanelOf(project);
  if (panel) disposeAgentPanel(panel.id);
}
const hasEnded = (session: string | null) =>
  !!session &&
  hasSession(session) &&
  ["exited", "failed"].includes(getSession(session).status);
export function useAgentPanel(id: string) {
  useSyncExternalStore(subscribe, () => version);
  const panel = panels.get(id) ?? null;
  const shown = panel && shownSession(panel);
  const ended = useSyncExternalStore(subscribe, () =>
    hasEnded(shown?.id ?? null),
  );
  return { panel, shown, ended };
}
