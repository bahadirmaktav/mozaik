import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  fileSystem,
  type Conflict,
  type Drive,
  type FileEntry,
  type Listing,
  type Resolution,
  type TransferMode,
  type TransferReport,
} from "../../services/filesystem";
import {
  affects,
  defaultSort,
  emptySelection,
  goBack,
  goForward,
  retain,
  samePath,
  visit,
  type History,
  type Selection,
  type Sort,
} from "./model";

export interface Operation {
  id: string;
  label: string;
  files: number;
  current: string;
}
/** Results of the search box: names under `root`, as they are found. */
export interface Search {
  query: string;
  root: string;
  results: FileEntry[];
  running: boolean;
  truncated: boolean;
  error: string | null;
}
/** The This PC page in history: the drives instead of a folder. */
export const THIS_PC = "::this-pc";
export interface FileManagerState {
  id: string;
  /** The folder shown, or (on the This PC page) the folder shown before it. */
  listing: Listing | null;
  /** `drives`: the This PC page shows the drives instead of the folder. */
  page: "folder" | "drives";
  /** The drives of the This PC page; null until read. */
  drives: Drive[] | null;
  loading: boolean;
  /** Shown instead of the list when nothing could be listed yet. */
  error: string | null;
  /** Nonblocking message above the list. */
  notice: string | null;
  history: History;
  sort: Sort;
  /** The search box's text; `search` holds the results once it ran. */
  query: string;
  search: Search | null;
  selection: Selection;
  operation: Operation | null;
  watchError: string | null;
}
export type Clipboard = { mode: TransferMode; paths: string[] } | null;
interface Store {
  instances: Map<string, FileManagerState>;
  tokens: Map<string, number>;
  stale: Set<string>;
  timers: Map<string, { timer: number; first: number }>;
  searchTimers: Map<string, number>;
  showHidden: boolean;
  clipboard: Clipboard;
  listeners: Set<() => void>;
  version: number;
  started: boolean;
}
// Panel state outlives views: switching tabs or moving the panel keeps the location,
// history, sort, search and selection. Only closing the tab disposes it.
const store: Store = import.meta.hot?.data.fileManagerStore ?? {
  instances: new Map(),
  tokens: new Map(),
  stale: new Set(),
  timers: new Map(),
  searchTimers: new Map(),
  showHidden: false,
  clipboard: null,
  listeners: new Set(),
  version: 0,
  started: false,
};
if (import.meta.hot) import.meta.hot.data.fileManagerStore = store;
const { instances, listeners } = store;
const message = (error: unknown) => String(error).replace(/^Error: /, "");

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
export function getInstance(id: string) {
  const instance = instances.get(id);
  if (!instance) throw new Error("File Manager was closed");
  return instance;
}
export function update(id: string, change: Partial<FileManagerState>) {
  const instance = instances.get(id);
  if (!instance) return;
  instances.set(id, { ...instance, ...change });
  emit();
}
export function useFileManager(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return {
    state: instances.get(id),
    showHidden: store.showHidden,
    clipboard: store.clipboard,
  };
}

function start() {
  if (store.started) return;
  store.started = true;
  if (!isTauri()) return;
  void fileSystem
    .settings()
    .then((s) => {
      store.showHidden = s.showHidden;
      emit();
    })
    .catch(() => {});
  void listen<{ showHidden: boolean }>("file-manager-settings", (event) => {
    store.showHidden = event.payload.showHidden;
    emit();
  });
  // Watchers only report that something changed; the folder is re-read, never patched.
  void listen<string[]>("disk-change", (event) => {
    for (const instance of instances.values()) {
      const listing = instance.listing;
      if (
        listing &&
        (event.payload.length === 0 ||
          event.payload.some((p) =>
            affects(p, listing.directory, listing.separator),
          ))
      )
        scheduleRefresh(instance.id);
    }
  });
}
/** Coalesces bursts: refresh 150 ms after the last event, at least once per second. */
export function scheduleRefresh(id: string) {
  const now = Date.now(),
    pending = store.timers.get(id);
  if (pending) clearTimeout(pending.timer);
  const first = pending?.first ?? now;
  const delay = now - first > 1000 ? 0 : 150;
  store.timers.set(id, {
    first,
    timer: window.setTimeout(() => {
      store.timers.delete(id);
      void refresh(id);
    }, delay),
  });
}

export function createInstance() {
  start();
  const id = crypto.randomUUID();
  instances.set(id, {
    id,
    listing: null,
    page: "folder",
    drives: null,
    loading: false,
    error: null,
    notice: null,
    history: { back: [], forward: [] },
    sort: defaultSort,
    query: "",
    search: null,
    selection: emptySelection(),
    operation: null,
    watchError: null,
  });
  emit();
  void load(id, null, "visit");
  return id;
}
export function disposeInstance(id: string) {
  if (!instances.has(id)) return;
  const timer = store.timers.get(id);
  if (timer) clearTimeout(timer.timer);
  store.timers.delete(id);
  stopSearch(id);
  store.tokens.delete(id);
  store.stale.delete(id);
  instances.delete(id);
  if (isTauri()) void fileSystem.watch(id, null).catch(() => {});
  emit();
}
export function title(id: string) {
  const instance = instances.get(id);
  if (instance?.page === "drives") return thisPc(instance);
  const crumbs = instance?.listing?.crumbs;
  return crumbs?.[crumbs.length - 1]?.name ?? "File Manager";
}

/** The page's name: This PC on Windows, Computer elsewhere. */
export const thisPc = (instance: FileManagerState) =>
  instance.listing?.separator === "/" ? "Computer" : "This PC";
/** Where the panel is, as history keeps it: a folder or `THIS_PC`. */
const here = (instance: FileManagerState) =>
  instance.page === "drives" ? THIS_PC : (instance.listing?.directory ?? null);

type How = "visit" | "back" | "forward" | "refresh";
/**
 * Every request takes a new token; a response is applied only if its token is still the
 * latest, so a slow listing never overrides a newer navigation.
 */
async function load(
  id: string,
  path: string | null,
  how: How,
  after?: History,
) {
  if (!instances.has(id)) return;
  const token = (store.tokens.get(id) ?? 0) + 1;
  store.tokens.set(id, token);
  store.stale.delete(id);
  update(id, { loading: true });
  const current = () =>
    instances.has(id) && store.tokens.get(id) === token
      ? getInstance(id)
      : null;
  try {
    if (path === THIS_PC) {
      const drives = await fileSystem.drives();
      const instance = current();
      if (!instance) return;
      const was = here(instance);
      stopSearch(id);
      update(id, {
        page: "drives",
        drives,
        loading: false,
        error: null,
        history:
          how === "visit" && was !== THIS_PC
            ? visit(instance.history, was)
            : (after ?? instance.history),
        query: "",
        search: null,
        selection: emptySelection(),
        notice: null,
      });
      return;
    }
    const listing = await fileSystem.list(path, how === "refresh");
    const instance = current();
    if (!instance) return;
    const previous = instance.listing;
    const same =
      instance.page === "folder" &&
      !!previous &&
      samePath(previous.directory, listing.directory, listing.separator);
    const order = listing.entries.map((e) => e.path);
    // The search ends when the folder changes.
    if (!same) stopSearch(id);
    update(id, {
      listing,
      page: "folder",
      loading: false,
      error: null,
      history:
        how === "visit" && !same
          ? visit(instance.history, here(instance))
          : (after ?? instance.history),
      query: same ? instance.query : "",
      search: same ? instance.search : null,
      // Search results keep their own selection.
      selection: !same
        ? emptySelection()
        : instance.search
          ? instance.selection
          : retain(instance.selection, order),
      notice: listing.fallbackFrom
        ? `${listing.fallbackFrom} is no longer available. Showing ${listing.directory} instead.`
        : same
          ? instance.notice
          : null,
    });
  } catch (error) {
    const instance = current();
    if (!instance) return;
    // Keep the current listing usable; only an empty panel shows a full error state.
    update(
      id,
      instance.listing
        ? { loading: false, notice: message(error) }
        : { loading: false, error: message(error) },
    );
  } finally {
    if (store.tokens.get(id) === token && store.stale.has(id))
      scheduleRefresh(id);
  }
}
export const navigate = (id: string, path: string | null) =>
  load(id, path, "visit");
export function back(id: string) {
  const instance = getInstance(id);
  const now = here(instance);
  const step = now && goBack(instance.history, now);
  if (step) void load(id, step.target, "back", step.history);
}
export function forward(id: string) {
  const instance = getInstance(id);
  const now = here(instance);
  const step = now && goForward(instance.history, now);
  if (step) void load(id, step.target, "forward", step.history);
}
/** The parent folder; from a drive or the root, the This PC page. */
export function up(id: string) {
  const instance = instances.get(id);
  if (!instance?.listing || instance.page === "drives") return;
  void navigate(id, instance.listing.parent ?? THIS_PC);
}
export function refresh(id: string) {
  const instance = instances.get(id);
  if (!instance) return Promise.resolve();
  if (instance.loading) {
    // A navigation is in flight; re-read once it lands instead of overriding it.
    store.stale.add(id);
    return Promise.resolve();
  }
  if (instance.page === "drives") return load(id, THIS_PC, "refresh");
  // Changed files change the results too.
  if (instance.search) void runSearch(id);
  return instance.listing
    ? load(id, instance.listing.directory, "refresh")
    : load(id, null, "visit");
}

/** The search box: the search starts shortly after typing stops; empty ends it. */
export function setQuery(id: string, query: string) {
  if (!instances.has(id)) return;
  const pending = store.searchTimers.get(id);
  if (pending) clearTimeout(pending);
  store.searchTimers.delete(id);
  if (!query.trim()) {
    stopSearch(id);
    update(id, { query, search: null });
    return;
  }
  update(id, { query });
  store.searchTimers.set(
    id,
    window.setTimeout(() => {
      store.searchTimers.delete(id);
      void runSearch(id);
    }, 250),
  );
}
/** Searches the shown folder and its subfolders for the box's text. */
export async function runSearch(id: string) {
  const instance = instances.get(id);
  const root = instance?.listing?.directory;
  const query = instance?.query.trim();
  if (!instance || !root || !query || instance.page !== "folder") return;
  const search: Search = {
    query,
    root,
    results: [],
    running: true,
    truncated: false,
    error: null,
  };
  update(id, {
    search,
    selection: instance.search ? instance.selection : emptySelection(),
  });
  // Only this search's batches apply; a newer search replaces the object.
  let shown = search;
  const live = () => instances.get(id)?.search === shown;
  try {
    await fileSystem.search(id, root, query, store.showHidden, (batch) => {
      if (!live()) return;
      shown = {
        ...shown,
        results: shown.results.concat(batch.entries),
        running: !batch.done,
        truncated: batch.truncated,
      };
      update(id, { search: shown });
    });
  } catch (error) {
    if (!live()) return;
    shown = { ...shown, running: false, error: message(error) };
    update(id, { search: shown });
  }
}
function stopSearch(id: string) {
  const pending = store.searchTimers.get(id);
  if (pending) clearTimeout(pending);
  store.searchTimers.delete(id);
  if (instances.get(id)?.search?.running && isTauri())
    void fileSystem.cancelSearch(id).catch(() => {});
}
/** Re-reads every panel that shows one of `directories`. */
export function refreshShowing(directories: string[]) {
  for (const instance of instances.values()) {
    const listing = instance.listing;
    if (
      listing &&
      directories.some((d) => samePath(d, listing.directory, listing.separator))
    )
      void refresh(instance.id);
  }
}

export function setShowHidden(show: boolean) {
  store.showHidden = show;
  emit();
  if (isTauri()) return fileSystem.setShowHidden(show);
  return Promise.resolve();
}
export function setClipboard(clipboard: Clipboard) {
  store.clipboard = clipboard;
  emit();
}

export type Decision = { resolution: Resolution; all: boolean } | "cancel";
export type Ask = (conflict: Conflict, remaining: number) => Promise<Decision>;
/** Lexical parent as the native listing spells it ("/", "C:\", "/home"). */
export function parentOf(path: string, separator: string) {
  const head = path.slice(0, path.lastIndexOf(separator));
  return head.includes(separator) ? head : head + separator;
}
/**
 * Copy or move with explicit conflict decisions. The native side re-validates
 * everything; nothing is replaced without a Replace decision.
 */
export async function transfer(
  id: string,
  sources: string[],
  destination: string,
  mode: TransferMode,
  ask: Ask,
): Promise<TransferReport | null> {
  const separator = getInstance(id).listing?.separator ?? "/";
  const { conflicts } = await fileSystem.plan(sources, destination, mode);
  const resolutions: Record<string, Resolution> = {};
  let all: Resolution | null = null;
  for (const [index, conflict] of conflicts.entries()) {
    const usable = all === "replace" && conflict.same ? null : all;
    if (usable) {
      resolutions[conflict.source] = usable;
      continue;
    }
    const decision = await ask(conflict, conflicts.length - index - 1);
    if (decision === "cancel") return null;
    resolutions[conflict.source] = decision.resolution;
    if (decision.all) all = decision.resolution;
  }
  const operation: Operation = {
    id: crypto.randomUUID(),
    label: mode === "copy" ? "Copying" : "Moving",
    files: 0,
    current: "",
  };
  update(id, { operation });
  try {
    const report = await fileSystem.transfer(
      { id: operation.id, sources, destination, mode, resolutions },
      (progress) =>
        instances.get(id)?.operation?.id === operation.id &&
        update(id, { operation: { ...operation, ...progress } }),
    );
    const affected = [destination];
    if (mode === "move")
      affected.push(...sources.map((s) => parentOf(s, separator)));
    refreshShowing(affected);
    const instance = instances.get(id);
    if (
      instance?.listing &&
      samePath(instance.listing.directory, destination, separator) &&
      report.completed.length
    )
      update(id, {
        selection: {
          paths: new Set(report.completed),
          anchor: report.completed[0],
          cursor: report.completed[0],
        },
      });
    return report;
  } finally {
    if (instances.get(id)?.operation?.id === operation.id)
      update(id, { operation: null });
  }
}
