import { useSyncExternalStore } from "react";
import {
  createSession,
  disposeSession,
  getSession,
  hasSession,
} from "../terminal/sessions";
import { getProject } from "./projects";
import type { ChannelName } from "./channels";

export type PanelView = "problems" | "output" | "debug" | "terminal" | "run";
/**
 * The IDE's bottom panel of one project: Problems, Output, Debug Console (with the debugged
 * program's output), its terminals or a run.
 */
export interface IdePanel {
  id: string;
  project: string;
  view: PanelView;
  /** The output channel the Output view shows. */
  channel: ChannelName;
  /**
   * The Terminal view's sessions, as in VS Code: the first is created when the view is first
   * shown, so no shell runs before; more come from New Terminal, each with its own shell.
   */
  terminals: string[];
  /** The one shown. */
  terminal: string | null;
  /** The program CMake built, started by Run in its own terminal session. */
  run: { session: string; target: string } | null;
}
interface Store {
  panels: Map<string, IdePanel>;
  /** IDE status bars by ID: the project each one shows. */
  status: Map<string, string>;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.idePanels ?? {
  panels: new Map(),
  status: new Map(),
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.idePanels = store;
const { panels, listeners } = store;
function emit() {
  store.version++;
  listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function usePanel(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return panels.get(id) ?? null;
}
export function useStatus(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return store.status.get(id) ?? null;
}
export const getPanel = (id: string) => panels.get(id) ?? null;
export const panelsOf = (project: string) =>
  [...panels.values()].filter((p) => p.project === project);

export function createPanel(project: string) {
  const id = crypto.randomUUID();
  panels.set(id, {
    id,
    project,
    view: "problems",
    channel: "IDE",
    terminals: [],
    terminal: null,
    run: null,
  });
  emit();
  return id;
}
/** Shows a view; for Output, `channel` chooses what it shows. */
export function showView(id: string, view: PanelView, channel?: ChannelName) {
  const panel = panels.get(id);
  if (!panel) return;
  let { terminal, terminals } = panel;
  if (view === "terminal" && (!terminal || !hasSession(terminal))) {
    terminal = createSession(getProject(panel.project)?.root ?? null);
    terminals = [...terminals.filter(hasSession), terminal];
  }
  panels.set(id, {
    ...panel,
    view,
    terminal,
    terminals,
    channel: channel ?? panel.channel,
  });
  emit();
}
/** Starts another terminal in the project folder, with `shell` or the default one. */
export function newTerminal(id: string, shell: string | null = null) {
  const panel = panels.get(id);
  if (!panel) return;
  const terminal = createSession(
    getProject(panel.project)?.root ?? null,
    null,
    shell,
  );
  panels.set(id, {
    ...panel,
    view: "terminal",
    terminal,
    terminals: [...panel.terminals, terminal],
  });
  emit();
}
export function selectTerminal(id: string, terminal: string) {
  const panel = panels.get(id);
  if (!panel?.terminals.includes(terminal)) return;
  panels.set(id, { ...panel, terminal });
  emit();
}
/** Ends one terminal; the next one is shown, or the view stays empty. */
export function killTerminal(id: string, terminal: string) {
  const panel = panels.get(id);
  if (!panel) return;
  disposeSession(terminal);
  const index = panel.terminals.indexOf(terminal);
  const terminals = panel.terminals.filter((t) => t !== terminal);
  panels.set(id, {
    ...panel,
    terminals,
    terminal:
      panel.terminal === terminal
        ? (terminals[Math.min(index, terminals.length - 1)] ?? null)
        : panel.terminal,
  });
  emit();
}
/** Whether an IDE status bar is open, where IDE messages show. */
export const hasStatus = () => store.status.size > 0;
/** Replaces an exited shell with a new one of the same kind in the same folder. */
export function restartTerminal(id: string) {
  const panel = panels.get(id);
  if (!panel?.terminal) return;
  const old = hasSession(panel.terminal) ? getSession(panel.terminal) : null;
  const terminal = createSession(
    old?.directory ?? getProject(panel.project)?.root ?? null,
    null,
    old?.request ?? null,
  );
  disposeSession(panel.terminal);
  panels.set(id, {
    ...panel,
    terminal,
    terminals: panel.terminals.map((t) =>
      t === panel.terminal ? terminal : t,
    ),
  });
  emit();
}
/** Runs a CMake target in the panel's Run view; a previous run is closed first. */
export function startRun(id: string, root: string, target: string) {
  const panel = panels.get(id);
  if (!panel) return;
  if (panel.run) disposeSession(panel.run.session);
  const session = createSession(null, { root, target });
  panels.set(id, { ...panel, view: "run", run: { session, target } });
  emit();
}
export function createStatus(project: string) {
  const id = crypto.randomUUID();
  store.status.set(id, project);
  emit();
  return id;
}
export const statusProject = (id: string) => store.status.get(id) ?? null;
export function disposeStatus(id: string) {
  store.status.delete(id);
  emit();
}
export function disposePanel(id: string) {
  for (const terminal of panels.get(id)?.terminals ?? [])
    disposeSession(terminal);
  const run = panels.get(id)?.run;
  if (run) disposeSession(run.session);
  panels.delete(id);
  emit();
}
