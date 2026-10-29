import { useSyncExternalStore } from "react";
import { drawingsBackend, type DrawingKind } from "../../services/drawings";
import type { FileData } from "../../services/native";

/** A file-backed item that saves itself once bound to a file: an Excalidraw drawing or a
 * Mermaid diagram. */
export interface BoundFile {
  id: string;
  name: string;
  path: string | null;
  revision: string | null;
  bom: boolean;
  ending: "lf" | "crlf" | "mixed";
  /** Contents last read from or written to the file; `null` until a new item is saved. */
  saved: string | null;
  /** Latest contents; `null` while unchanged since the item was loaded. */
  text: string | null;
  saving: boolean;
  /** The last failed save, kept until a save succeeds. */
  error: string | null;
  conflict: string | null;
  generation: number;
}
/** What the live view of an item provides to the store. */
export interface Runtime {
  /** Hands pending changes to the store now. */
  flush(): void;
  /** Replaces the live contents after the file was reloaded from disk. */
  reload(text: string): void;
  dispose(): void;
}
export const dirty = (d: BoundFile) => d.text !== null && d.text !== d.saved;
/** The contents to show: unsaved changes first, then the file contents. */
export const content = (d: BoundFile) => d.text ?? d.saved;
export function untitledName(taken: string[]) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? "Untitled" : `Untitled ${n}`;
    if (!taken.includes(name)) return name;
  }
}
const message = (error: unknown) => String(error).replace(/^Error: /, "");

interface Store {
  items: Map<string, BoundFile>;
  runtimes: Map<string, Runtime>;
  listeners: Set<() => void>;
  version: number;
}
export interface Options {
  kind: DrawingKind;
  /** Extensions the kind opens, without dots; names shown without the first one. */
  extensions: string[];
  /** Saved for a new item whose contents were never changed. */
  empty: string;
  noun: string;
  autosaveMs?: number;
}

/** One store per kind: identity, path, contents, dirty/saving/conflict state, queued
 * autosave and the reopening of the previous session's files. */
export function createBoundFiles(options: Options) {
  const autosaveMs = options.autosaveMs ?? 1000;
  const hotKey = `${options.kind}BoundFiles`;
  // Preserve unsaved work during development HMR as well as ordinary view remounts.
  const store: Store = import.meta.hot?.data[hotKey] ?? {
    items: new Map(),
    runtimes: new Map(),
    listeners: new Set(),
    version: 0,
  };
  if (import.meta.hot) import.meta.hot.data[hotKey] = store;
  const { items, runtimes, listeners } = store;
  const saves = new Map<string, Promise<boolean>>();
  const autosaves = new Map<string, ReturnType<typeof setTimeout>>();
  const errorListeners = new Set<(message: string) => void>();
  let opener: ((path: string | null) => void) | null = null;
  let restored = false;
  const extension = new RegExp(`\\.(${options.extensions.join("|")})$`, "i");

  function emit() {
    store.version++;
    listeners.forEach((fn) => fn());
  }
  function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }
  const all = () => [...items.values()];
  const has = (id: string) => items.has(id);
  function get(id: string) {
    const item = items.get(id);
    if (!item)
      throw new Error(
        `${options.noun[0].toUpperCase()}${options.noun.slice(1)} was closed`,
      );
    return item;
  }
  const baseName = (name: string) => name.replace(extension, "");
  function create(input: Partial<Omit<BoundFile, "id">> = {}) {
    const id = crypto.randomUUID();
    const name =
      input.name ??
      untitledName(
        all()
          .filter((d) => !d.path)
          .map((d) => d.name),
      );
    items.set(id, {
      id,
      name,
      path: null,
      revision: null,
      bom: false,
      ending: "lf",
      saved: null,
      text: null,
      saving: false,
      error: null,
      conflict: null,
      generation: 0,
      ...input,
    });
    emit();
    return id;
  }
  function update(id: string, change: Partial<BoundFile>) {
    const d = get(id);
    items.set(id, { ...d, ...change, generation: d.generation + 1 });
    emit();
  }
  function dispose(id: string) {
    clearTimeout(autosaves.get(id));
    autosaves.delete(id);
    runtimes.get(id)?.dispose();
    runtimes.delete(id);
    items.delete(id);
    emit();
  }
  function useAll() {
    useSyncExternalStore(subscribe, () => store.version);
    return all();
  }
  function useOne(id: string) {
    useSyncExternalStore(subscribe, () => store.version);
    return items.get(id) ?? null;
  }

  function registerRuntime(id: string, runtime: Runtime) {
    runtimes.set(id, runtime);
  }
  const flush = (id: string) => runtimes.get(id)?.flush();
  /** Called by the live view with its current contents. */
  function setText(id: string, text: string) {
    if (!has(id) || get(id).text === text) return;
    update(id, { text });
    scheduleAutosave(id);
  }
  function scheduleAutosave(id: string) {
    clearTimeout(autosaves.get(id));
    const d = get(id);
    // Only an item bound to a file saves itself; a new one waits for Save As.
    if (!d.path || d.conflict || !dirty(d)) return;
    autosaves.set(
      id,
      setTimeout(() => {
        autosaves.delete(id);
        if (has(id)) void save(id).catch(() => {});
      }, autosaveMs),
    );
  }

  /** Saves are serialized per item, so an older write never lands after a newer one. */
  function save(id: string, saveAs = false): Promise<boolean> {
    const prior = saves.get(id) ?? Promise.resolve(true);
    const next = prior.catch(() => false).then(() => performSave(id, saveAs));
    saves.set(id, next);
    void next
      .finally(() => {
        if (saves.get(id) === next) saves.delete(id);
      })
      .catch(() => {});
    return next;
  }
  async function performSave(id: string, saveAs: boolean) {
    if (!has(id)) return false;
    flush(id);
    const d = get(id),
      text = content(d) ?? options.empty;
    if (!saveAs && d.path && text === d.saved && !d.conflict) return true;
    if (!saveAs && d.conflict) throw new Error(d.conflict);
    clearTimeout(autosaves.get(id));
    update(id, { saving: true });
    try {
      const outcome = await drawingsBackend.save({
        kind: options.kind,
        path: saveAs ? null : d.path,
        current: d.path,
        text,
        revision: saveAs ? null : d.revision,
        bom: d.bom,
        ending: d.ending,
        name: d.path && !saveAs ? d.name : baseName(d.name),
      });
      if (!has(id)) return outcome.kind === "saved";
      if (outcome.kind === "cancelled") {
        update(id, { saving: false });
        return false;
      }
      if (outcome.kind === "conflict") {
        update(id, { saving: false, conflict: outcome.message });
        return false;
      }
      update(id, {
        path: outcome.file.path,
        name: outcome.file.name,
        revision: outcome.file.revision,
        saved: text,
        saving: false,
        error: null,
        conflict: null,
      });
      // Changes made while the file was being written are saved next.
      scheduleAutosave(id);
      return true;
    } catch (error) {
      if (has(id)) update(id, { saving: false, error: message(error) });
      throw error;
    }
  }
  /** Lets pending automatic saves finish before a close asks about unsaved changes. */
  async function settle(id: string) {
    if (!has(id)) return;
    flush(id);
    clearTimeout(autosaves.get(id));
    autosaves.delete(id);
    const d = get(id);
    const pending = saves.get(id);
    if (d.path && !d.conflict && dirty(d)) await save(id).catch(() => false);
    else if (pending) await pending.catch(() => false);
  }

  function fromFile(file: FileData) {
    return {
      path: file.path,
      name: file.name,
      revision: file.revision,
      bom: file.bom,
      ending: file.ending,
      saved: file.text,
      text: null,
    };
  }
  /** Opens a file, or returns the item that already shows it. `null` when the dialog was
   * cancelled or another window shows the file. */
  async function openFile(path: string | null) {
    const outcome = await drawingsBackend.open(path, options.kind);
    if (!outcome || outcome.kind === "elsewhere") return null;
    const existing = all().find((d) => d.path === outcome.file.path);
    return existing?.id ?? create(fromFile(outcome.file));
  }
  const findByPath = (path: string) =>
    all().find((d) => d.path === path)?.id ?? null;
  /** The previous session's files, reopened the first time the module is opened. */
  async function restoreSession() {
    const result = { ids: [] as string[], errors: [] as string[] };
    if (restored) return result;
    restored = true;
    const paths = await drawingsBackend
      .takePending(options.kind)
      .catch(() => []);
    for (const path of paths) {
      try {
        const id = await openFile(path);
        if (id) result.ids.push(id);
      } catch (error) {
        result.errors.push(message(error));
      }
    }
    return result;
  }
  /** Applies a newer disk version to a clean item, or marks the item as conflicting. */
  async function check(id: string) {
    const d = get(id);
    // Our own write in progress changes the file before its revision is known here.
    if (!d.path || d.conflict || saves.has(id)) return;
    const file = await drawingsBackend.check(d.path, d.revision);
    if (!file || !has(id) || saves.has(id)) return;
    const current = get(id);
    if (current.path !== d.path || current.revision !== d.revision) return;
    flush(id);
    if (dirty(get(id)))
      update(id, {
        conflict: `The ${options.noun} changed on disk. Save As to keep your version, or reload the disk version.`,
      });
    else reload(id, file);
  }
  function reload(id: string, file: FileData) {
    clearTimeout(autosaves.get(id));
    update(id, { ...fromFile(file), conflict: null, error: null });
    runtimes.get(id)?.reload(file.text);
  }

  return {
    kind: options.kind,
    subscribe,
    all,
    has,
    get,
    baseName,
    create,
    update,
    dispose,
    useAll,
    useOne,
    registerRuntime,
    flush,
    setText,
    save,
    settle,
    openFile,
    findByPath,
    restoreSession,
    check,
    reload,
    /** The workspace opens files for the File Manager and the module's own menu. */
    setOpener(fn: ((path: string | null) => void) | null) {
      opener = fn;
    },
    requestOpen: (path: string | null = null) => opener?.(path),
    onError(fn: (message: string) => void) {
      errorListeners.add(fn);
      return () => {
        errorListeners.delete(fn);
      };
    },
    reportError: (error: unknown) =>
      errorListeners.forEach((fn) => fn(message(error))),
    isPath: (path: string) => extension.test(path),
  };
}
export type BoundFiles = ReturnType<typeof createBoundFiles>;
