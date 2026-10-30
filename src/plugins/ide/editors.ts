import { useSyncExternalStore } from "react";
import type { EditorView } from "@codemirror/view";
import {
  allDocuments,
  createDocument,
  getDocument,
  hasDocument,
} from "../text-editor/documents";
import { ideBackend } from "../../services/ide";
import {
  emptyTrail,
  goBack,
  goForward,
  offsetAt,
  visit,
  type LspPosition,
  type Place,
} from "./model";
import { flash } from "./flash";
import { pathKey } from "./paths";
import type { PanelView } from "./panels";
import type { ChannelName } from "./channels";

/** What the workspace does for the IDE: tabs, panels and questions belong to the App. */
export interface Host {
  /** Shows the document in a code tab (an existing tab is activated). */
  showCode(id: string, options?: { side?: boolean }): boolean;
  /**
   * Keeps a document in a code tab: when none shows it, one opens behind the tab `beside`
   * (which stays active). False when there is no room.
   */
  keepOpen(id: string, beside: string): boolean;
  /** Whether some tab shows the document. */
  shows(id: string): boolean;
  /** A file's changes as a tab: working tree, or with `staged` the index. */
  showDiff(path: string, staged?: boolean): void;
  /** Shows the bottom panel's Problems of the project containing `path`. */
  showProblems(path?: string | null): void;
  /** Shows a view of that project's bottom panel (opened if needed); its ID, or null. */
  showPanel(
    path: string | null,
    view: PanelView,
    channel?: ChannelName,
  ): string | null;
  /** A choice from a list in the command palette; null when cancelled. */
  pick(title: string, items: PickItem[]): Promise<string | null>;
  /** Opens the palette on files (`""`) or the editor's symbols (`"@"`). */
  quickOpen(prefix: string): void;
  /** Closes the IDE of a project: its sidebar, bottom panel and status bar. */
  closeIde(project: string): void;
  ask(title: string, message: string, choices: string[]): Promise<string>;
  /** A message for the user: logged in Output → IDE and shown in the status bar. */
  report(error: unknown): void;
}
export interface PickItem {
  id: string;
  label: string;
  detail?: string;
}
export interface Diagnostic {
  range: { start: LspPosition; end: LspPosition };
  severity: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
  code?: string | number;
}
export interface ResultItem {
  path: string;
  line: number;
  column: number;
  length: number;
  preview: string;
  offset: number;
}
/** Results shown in a project's sidebar: a project search or a navigation answer. */
export interface Results {
  title: string;
  items: ResultItem[];
}
interface Store {
  host: Host | null;
  views: Map<string, EditorView>;
  waiters: Map<string, ((view: EditorView) => void)[]>;
  /** The code document that was focused last, for outline and location history. */
  current: string | null;
  trail: ReturnType<typeof emptyTrail>;
  diagnostics: Map<string, { path: string; items: Diagnostic[] }>;
  /** Problems found in CMake and compiler output, by owner (a project) and file. */
  build: Map<string, Map<string, { path: string; items: Diagnostic[] }>>;
  results: Results | null;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideEditors ?? {
  host: null,
  views: new Map(),
  waiters: new Map(),
  current: null,
  trail: emptyTrail(),
  diagnostics: new Map(),
  build: new Map(),
  results: null,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideEditors = store;

export const message = (error: unknown) =>
  String(
    error && typeof error === "object" && "message" in error
      ? error.message
      : error,
  ).replace(/^Error: /, "");
function emit() {
  store.version++;
  store.listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => {
    store.listeners.delete(fn);
  };
}
export function useEditors() {
  useSyncExternalStore(subscribe, () => store.version);
  return store;
}
export function setHost(host: Host | null) {
  store.host = host;
}
export function host() {
  if (!store.host) throw new Error("The workspace is not ready");
  return store.host;
}

export function registerView(id: string, view: EditorView | null) {
  if (!view) {
    store.views.delete(id);
    return;
  }
  store.views.set(id, view);
  const waiting = store.waiters.get(id) ?? [];
  store.waiters.delete(id);
  waiting.forEach((resolve) => resolve(view));
}
export const viewOf = (id: string) => store.views.get(id) ?? null;
export function setCurrent(id: string) {
  if (store.current === id) return;
  store.current = id;
  emit();
}
export const current = () =>
  store.current && hasDocument(store.current) ? store.current : null;
function waitForView(id: string) {
  const view = store.views.get(id);
  if (view) return Promise.resolve(view);
  return new Promise<EditorView>((resolve, reject) => {
    store.waiters.set(id, [...(store.waiters.get(id) ?? []), resolve]);
    setTimeout(
      () => reject(new Error("The editor did not open in time")),
      10000,
    );
  });
}

/** The open document for a path, or a new one read from disk (one document per file). */
export async function documentFor(path: string) {
  const existing = allDocuments().find(
    (d) => d.path && pathKey(d.path) === pathKey(path),
  );
  if (existing) return existing.id;
  const file = await ideBackend.read(path);
  const again = allDocuments().find(
    (d) => d.path && pathKey(d.path) === pathKey(file.path),
  );
  return again?.id ?? createDocument({ ...file, saved: file.text });
}
function here(): Place | null {
  const id = current();
  const view = id && viewOf(id);
  const path = id && getDocument(id).path;
  return view && path ? { path, pos: view.state.selection.main.head } : null;
}
type Target = number | LspPosition | { line: number; column: number };
async function jump(
  path: string,
  target: Target,
  options: { side?: boolean; highlight?: boolean } = {},
) {
  const id = await documentFor(path);
  if (!host().showCode(id, options)) return null;
  const view = await waitForView(id);
  const text = view.state.doc.toString();
  const pos =
    typeof target === "number"
      ? target
      : "character" in target
        ? offsetAt(text, target)
        : offsetAt(text, { line: target.line - 1, character: target.column });
  const anchor = Math.min(pos, view.state.doc.length);
  view.dispatch({
    selection: { anchor },
    scrollIntoView: true,
    userEvent: "select.reveal",
  });
  view.focus();
  if (options.highlight) flash(id, () => viewOf(id), anchor);
  setCurrent(id);
  return view;
}
/**
 * Opens a file at a location and records where the jump started for Back. A location other
 * than the file's start (a definition, reference, result or symbol) is briefly highlighted
 * unless `highlight` is false.
 */
export async function reveal(
  path: string,
  target: Target = 0,
  options: { side?: boolean; highlight?: boolean } = {},
) {
  const from = here();
  const view = await jump(path, target, {
    highlight: target !== 0,
    ...options,
  });
  if (view && from) {
    const to = view.state.selection.main.head;
    if (pathKey(from.path) !== pathKey(path) || from.pos !== to) {
      store.trail = visit(store.trail, from);
      emit();
    }
  }
  return view;
}
export async function navigate(direction: "back" | "forward") {
  const now = here();
  const step =
    direction === "back"
      ? goBack(store.trail, now)
      : goForward(store.trail, now);
  if (!step) return;
  store.trail = step.trail;
  emit();
  try {
    await jump(step.target.path, step.target.pos);
  } catch (e) {
    host().report(e);
  }
}
export const canNavigate = () => ({
  back: store.trail.back.length > 0,
  forward: store.trail.forward.length > 0,
});

export function setDiagnostics(path: string, items: Diagnostic[]) {
  if (items.length) store.diagnostics.set(pathKey(path), { path, items });
  else if (!store.diagnostics.delete(pathKey(path))) return;
  emit();
}
export const diagnosticsOf = (path: string) =>
  store.diagnostics.get(pathKey(path))?.items ?? [];
/** Drops the diagnostics of files below a root, when its server stops. */
export function clearDiagnostics(within: (path: string) => boolean) {
  let changed = false;
  for (const [key, entry] of store.diagnostics)
    if (within(entry.path)) changed = store.diagnostics.delete(key) || changed;
  if (changed) emit();
}
/** Replaces the build problems a project's last CMake step found. */
export function setBuildProblems(
  owner: string,
  files: Map<string, Diagnostic[]>,
) {
  const entries = new Map<string, { path: string; items: Diagnostic[] }>();
  for (const [path, items] of files)
    entries.set(pathKey(path), { path, items });
  store.build.set(owner, entries);
  emit();
}
/** Language server and build problems of every file, merged by file. */
export function allProblems() {
  const merged = new Map<string, { path: string; items: Diagnostic[] }>();
  for (const map of [store.diagnostics, ...store.build.values()])
    for (const [key, entry] of map) {
      const known = merged.get(key);
      merged.set(key, {
        path: entry.path,
        items: known ? [...known.items, ...entry.items] : entry.items,
      });
    }
  return [...merged.values()];
}
export function setResults(results: Results | null) {
  store.results = results;
  emit();
}
