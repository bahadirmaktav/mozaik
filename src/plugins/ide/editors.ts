import { useSyncExternalStore } from "react";
import { EditorView } from "@codemirror/view";
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
import { notText, textLike } from "../text-editor/open";
import { imageType } from "../excalidraw/drawings";
import type { PanelView } from "./panels";
import type { ChannelName } from "./channels";
import type { FixEdit } from "../../services/analysis";

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
  /**
   * Opens a drawing or diagram file in its module (Excalidraw, Mermaid) as a tab among the
   * code editors; false for other files.
   */
  showDrawing(path: string, options?: { side?: boolean }): boolean;
  /**
   * Opens a file that is not text as a tab among the code editors: a picture to look at, or
   * a note that it cannot be shown.
   */
  showFile(path: string, options?: { side?: boolean }): boolean;
  /** A file's changes as a tab: working tree, or with `staged` the index. */
  showDiff(path: string, staged?: boolean): void;
  /** A file of the project's coverage report as a read-only tab among the code editors. */
  showCoverage(project: string, path: string): void;
  /** Shows the bottom panel's Problems of the project containing `path`. */
  showProblems(path?: string | null): void;
  /** Shows a view of that project's bottom panel (opened if needed); its ID, or null. */
  showPanel(
    path: string | null,
    view: PanelView,
    channel?: ChannelName,
  ): string | null;
  /** A new terminal in `folder`, in the bottom panel of the project containing it. */
  openTerminal(folder: string): void;
  /** `folder` in a File Manager of its own, floating beside the IDE. */
  revealInFileManager(folder: string): void;
  /** A choice from a list in the command palette; null when cancelled. */
  pick(title: string, items: PickItem[]): Promise<string | null>;
  /** Opens the palette on files (`""`) or the editor's symbols (`"@"`). */
  quickOpen(prefix: string): void;
  /** Opens Workspace Settings on its IDE tab. */
  openSettings(): void;
  /** Closes one tab, as its close button does. */
  closeTab(id: string): void;
  /** Takes the coding agents' panel out of the layout; its sessions keep running. */
  hideAgents(id: string): void;
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
  /** clang-tidy's replacements for a finding of a run. */
  fix?: FixEdit[];
  /** The text or build folder changed since the run that found it. */
  stale?: boolean;
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
  /** The view of each document that was focused last. */
  views: Map<string, EditorView>;
  /** Every shown view by its tab; a document split in two has two. */
  tabs: Map<string, { document: string; view: EditorView }>;
  waiters: Map<string, ((view: EditorView) => void)[]>;
  /** The code document that was focused last, for outline and location history. */
  current: string | null;
  trail: ReturnType<typeof emptyTrail>;
  diagnostics: Map<string, { path: string; items: Diagnostic[] }>;
  /** Problems found in CMake and compiler output, by owner (a project) and file. */
  build: Map<string, Map<string, { path: string; items: Diagnostic[] }>>;
  /** Findings of clang-tidy runs and SonarQube issues, by owner (a project) and file. */
  analysis: Map<string, Map<string, { path: string; items: Diagnostic[] }>>;
  /**
   * Problems that are drawn in the editor besides the language server's (SonarQube issues
   * that still describe their lines), by owner and file.
   */
  marks?: Map<string, Map<string, { path: string; items: Diagnostic[] }>>;
  results: Results | null;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideEditors ?? {
  host: null,
  views: new Map(),
  tabs: new Map(),
  waiters: new Map(),
  current: null,
  trail: emptyTrail(),
  diagnostics: new Map(),
  build: new Map(),
  analysis: new Map(),
  marks: new Map(),
  results: null,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideEditors = store;
const marks = (store.marks ??= new Map());
const markListeners = new Set<(paths: string[]) => void>();
const viewListeners = new Set<(id: string, view: EditorView) => void>();

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

/**
 * The IDE's empty code area: a code editor without a tab or a file, shown while no code
 * is open. A double click on its tab strip adds a real editor in its place.
 */
const emptyAreas = new Set<string>();
export const markEmptyArea = (id: string) => void emptyAreas.add(id);
export const isEmptyArea = (id: string) => emptyAreas.has(id);
export const forgetEmptyArea = (id: string) => void emptyAreas.delete(id);

export function registerView(id: string, tab: string, view: EditorView) {
  store.tabs.set(tab, { document: id, view });
  store.views.set(id, view);
  const waiting = store.waiters.get(id) ?? [];
  store.waiters.delete(id);
  waiting.forEach((resolve) => resolve(view));
  viewListeners.forEach((fn) => fn(id, view));
}
/** Called with each code view that is shown, also for a document shown again. */
export function onViewRegistered(fn: (id: string, view: EditorView) => void) {
  viewListeners.add(fn);
  return () => void viewListeners.delete(fn);
}
/** Every view showing a document: one per editor group it is in. */
export const viewsOf = (id: string) => [
  ...new Set(
    [...store.tabs.values()]
      .filter((t) => t.document === id)
      .map((t) => t.view),
  ),
];
/** A view went away; its document's other view, if any, takes over. */
export function unregisterView(id: string, tab: string, view: EditorView) {
  if (store.tabs.get(tab)?.view === view) store.tabs.delete(tab);
  if (store.views.get(id) !== view) return;
  const other = [...store.tabs.values()].find((t) => t.document === id);
  if (other) store.views.set(id, other.view);
  else store.views.delete(id);
}
/** Jumps and server edits of a document go to the view of this tab from now on. */
export function preferView(tab: string) {
  const shown = store.tabs.get(tab);
  if (shown) store.views.set(shown.document, shown.view);
}
export const viewOf = (id: string) => store.views.get(id) ?? null;
/**
 * The cursor of each code document's focused view (line and column from 1), for the status
 * bar. It has listeners of its own: moving the cursor must not redraw the other IDE views.
 */
const cursors = new Map<string, { line: number; column: number }>();
const cursorListeners = new Set<() => void>();
let cursorVersion = 0;
export function setCursor(id: string, view: EditorView) {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  const next = { line: line.number, column: head - line.from + 1 };
  const last = cursors.get(id);
  if (last && last.line === next.line && last.column === next.column) return;
  cursors.set(id, next);
  cursorVersion++;
  cursorListeners.forEach((fn) => fn());
}
function subscribeCursor(fn: () => void) {
  cursorListeners.add(fn);
  return () => void cursorListeners.delete(fn);
}
/** The cursor of a code document, kept current. */
export function useCursor(id: string | null) {
  useSyncExternalStore(subscribeCursor, () => cursorVersion);
  return id ? (cursors.get(id) ?? null) : null;
}
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
  target: Target | undefined,
  options: { side?: boolean; highlight?: boolean } = {},
) {
  const id = await documentFor(path);
  if (!host().showCode(id, options)) return null;
  const opened = await waitForView(id);
  // A remount may already have replaced the view that answered.
  const view = viewOf(id) ?? opened;
  if (target !== undefined) {
    const text = view.state.doc.toString();
    const pos =
      typeof target === "number"
        ? target
        : "character" in target
          ? offsetAt(text, target)
          : offsetAt(text, { line: target.line - 1, character: target.column });
    const anchor = Math.min(pos, view.state.doc.length);
    // In the middle of the view, not at its edge, so what surrounds the target shows.
    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: "center" }),
      userEvent: "select.reveal",
    });
    if (options.highlight) flash(id, () => viewOf(id), anchor);
  }
  view.focus();
  setCurrent(id);
  return view;
}
/**
 * Opens a file and records where the jump started for Back. Without a `target` the file shows
 * where it was left, as in VS Code. A location other than the file's start (a definition,
 * reference, result or symbol) is briefly highlighted unless `highlight` is false.
 */
export async function reveal(
  path: string,
  target?: Target,
  options: { side?: boolean; highlight?: boolean } = {},
) {
  // Without a place in it, a file that is not text opens as what it is.
  if (target === undefined) {
    if (host().showDrawing(path, options)) return null;
    if ((imageType(path) || !textLike(path)) && host().showFile(path, options))
      return null;
  }
  const from = here();
  let view: EditorView | null;
  try {
    view = await jump(path, target, {
      highlight: target !== undefined && target !== 0,
      ...options,
    });
  } catch (error) {
    // Only reading the file shows that it is not text.
    if (
      target === undefined &&
      notText(error) &&
      host().showFile(path, options)
    )
      return null;
    throw error;
  }
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

/** Changes when any problem changes, so a long list is worked out again only then. */
let problemChanges = 0;
export const problemsVersion = () => problemChanges;
function emitProblems() {
  problemChanges++;
  emit();
}
export function setDiagnostics(path: string, items: Diagnostic[]) {
  if (items.length) store.diagnostics.set(pathKey(path), { path, items });
  else if (!store.diagnostics.delete(pathKey(path))) return;
  emitProblems();
}
export const diagnosticsOf = (path: string) =>
  store.diagnostics.get(pathKey(path))?.items ?? [];
/** Drops the diagnostics of files below a root, when its server stops. */
export function clearDiagnostics(within: (path: string) => boolean) {
  let changed = false;
  for (const [key, entry] of store.diagnostics)
    if (within(entry.path)) changed = store.diagnostics.delete(key) || changed;
  if (changed) emitProblems();
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
  emitProblems();
}
/**
 * Replaces the problems an owner draws in the editor besides the language server's; null
 * drops them. Listeners get the files whose marks changed.
 */
export function setEditorMarks(
  owner: string,
  files: Map<string, Diagnostic[]> | null,
) {
  const before = marks.get(owner);
  const changed = new Set(
    before ? [...before.values()].map((e) => e.path) : [],
  );
  if (files) {
    const entries = new Map<string, { path: string; items: Diagnostic[] }>();
    for (const [path, items] of files) {
      entries.set(pathKey(path), { path, items });
      changed.add(path);
    }
    marks.set(owner, entries);
  } else if (!marks.delete(owner)) return;
  markListeners.forEach((fn) => fn([...changed]));
}
export const marksOf = (path: string) =>
  [...marks.values()].flatMap((m) => m.get(pathKey(path))?.items ?? []);
export function onMarks(fn: (paths: string[]) => void) {
  markListeners.add(fn);
  return () => void markListeners.delete(fn);
}
/** Replaces a project's clang-tidy findings or SonarQube issues; null drops them. */
export function setAnalysisProblems(
  owner: string,
  files: Map<string, Diagnostic[]> | null,
) {
  if (!files) {
    if (store.analysis.delete(owner)) emitProblems();
    return;
  }
  const entries = new Map<string, { path: string; items: Diagnostic[] }>();
  for (const [path, items] of files)
    entries.set(pathKey(path), { path, items });
  store.analysis.set(owner, entries);
  emitProblems();
}
/** Language server, build and analysis problems of every file, merged by file. */
export function allProblems() {
  const merged = new Map<string, { path: string; items: Diagnostic[] }>();
  for (const map of [
    store.diagnostics,
    ...store.build.values(),
    ...(store.analysis ?? new Map()).values(),
  ])
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
