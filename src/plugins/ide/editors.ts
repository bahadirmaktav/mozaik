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
import { pathKey } from "./paths";

/** What the workspace does for the IDE: tabs, panels and questions belong to the App. */
export interface Host {
  /** Shows the document in a code tab (an existing tab is activated). */
  showCode(id: string, options?: { side?: boolean }): boolean;
  showDiff(path: string): void;
  showProblems(): void;
  ask(title: string, message: string, choices: string[]): Promise<string>;
  report(error: unknown): void;
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
async function jump(path: string, target: Target, options = {}) {
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
  setCurrent(id);
  return view;
}
/** Opens a file at a location and records where the jump started for Back. */
export async function reveal(
  path: string,
  target: Target = 0,
  options: { side?: boolean } = {},
) {
  const from = here();
  const view = await jump(path, target, options);
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
export function setResults(results: Results | null) {
  store.results = results;
  emit();
}
