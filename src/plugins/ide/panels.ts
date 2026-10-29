import { useSyncExternalStore } from "react";
import {
  createSession,
  disposeSession,
  getSession,
  hasSession,
} from "../terminal/sessions";
import { getProject } from "./projects";

export type PanelView = "problems" | "terminal";
/** The IDE's bottom panel of one project: Problems or its terminal, over a status bar. */
export interface IdePanel {
  id: string;
  project: string;
  view: PanelView;
  /** Created the first time the Terminal view is shown, so no shell runs before. */
  terminal: string | null;
}
interface Store {
  panels: Map<string, IdePanel>;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.idePanels ?? {
  panels: new Map(),
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
export const getPanel = (id: string) => panels.get(id) ?? null;
export const panelsOf = (project: string) =>
  [...panels.values()].filter((p) => p.project === project);

export function createPanel(project: string) {
  const id = crypto.randomUUID();
  panels.set(id, { id, project, view: "problems", terminal: null });
  emit();
  return id;
}
export function showView(id: string, view: PanelView) {
  const panel = panels.get(id);
  if (!panel) return;
  let terminal = panel.terminal;
  if (view === "terminal" && (!terminal || !hasSession(terminal)))
    terminal = createSession(getProject(panel.project)?.root ?? null);
  panels.set(id, { ...panel, view, terminal });
  emit();
}
/** Replaces an exited shell with a new one in the same folder. */
export function restartTerminal(id: string) {
  const panel = panels.get(id);
  if (!panel?.terminal) return;
  const directory = hasSession(panel.terminal)
    ? getSession(panel.terminal).directory
    : (getProject(panel.project)?.root ?? null);
  disposeSession(panel.terminal);
  panels.set(id, { ...panel, terminal: createSession(directory) });
  emit();
}
export function disposePanel(id: string) {
  const terminal = panels.get(id)?.terminal;
  if (terminal) disposeSession(terminal);
  panels.delete(id);
  emit();
}
