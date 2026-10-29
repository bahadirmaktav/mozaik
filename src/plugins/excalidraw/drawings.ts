import { useSyncExternalStore } from "react";
import { drawingsBackend } from "../../services/drawings";
import type { FileData } from "../../services/native";

export interface Drawing {
  id: string;
  name: string;
  path: string | null;
  revision: string | null;
  bom: boolean;
  ending: "lf" | "crlf" | "mixed";
  /** Scene last read from or written to the file; `null` until a new drawing is saved. */
  saved: string | null;
  /** Latest serialized scene; `null` while it is unchanged since it was loaded. */
  text: string | null;
  saving: boolean;
  /** The last failed save, kept until a save succeeds. */
  error: string | null;
  conflict: string | null;
  generation: number;
}
/** What the live Excalidraw instance of a drawing provides to the store. */
interface Runtime {
  /** Serializes pending scene changes now. */
  flush(): void;
  /** Replaces the live scene after the file was reloaded from disk. */
  reload(text: string): void;
  dispose(): void;
}
interface Store {
  drawings: Map<string, Drawing>;
  runtimes: Map<string, Runtime>;
  listeners: Set<() => void>;
  version: number;
}
const AUTOSAVE_MS = 1000;
// Preserve unsaved drawings during development HMR as well as ordinary view remounts.
const store: Store = import.meta.hot?.data.drawingStore ?? {
  drawings: new Map(),
  runtimes: new Map(),
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.drawingStore = store;
const { drawings, runtimes, listeners } = store;
const saves = new Map<string, Promise<boolean>>();
const autosaves = new Map<string, ReturnType<typeof setTimeout>>();
const errorListeners = new Set<(message: string) => void>();
let opener: ((path: string | null) => void) | null = null;
let restored = false;

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
export const allDrawings = () => [...drawings.values()];
export const hasDrawing = (id: string) => drawings.has(id);
export function getDrawing(id: string) {
  const drawing = drawings.get(id);
  if (!drawing) throw new Error("Drawing was closed");
  return drawing;
}
export const dirty = (d: Drawing) => d.text !== null && d.text !== d.saved;
/** The scene to show: unsaved changes first, then the file contents. */
export const content = (d: Drawing) => d.text ?? d.saved;
export const baseName = (name: string) => name.replace(/\.excalidraw$/i, "");

export function untitledName(taken: string[]) {
  for (let n = 1; ; n++) {
    const name = n === 1 ? "Untitled" : `Untitled ${n}`;
    if (!taken.includes(name)) return name;
  }
}
export function createDrawing(input: Partial<Omit<Drawing, "id">> = {}) {
  const id = crypto.randomUUID();
  const name =
    input.name ??
    untitledName(
      allDrawings()
        .filter((d) => !d.path)
        .map((d) => d.name),
    );
  drawings.set(id, {
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
export function updateDrawing(id: string, change: Partial<Drawing>) {
  const d = getDrawing(id);
  drawings.set(id, { ...d, ...change, generation: d.generation + 1 });
  emit();
}
export function disposeDrawing(id: string) {
  clearTimeout(autosaves.get(id));
  autosaves.delete(id);
  runtimes.get(id)?.dispose();
  runtimes.delete(id);
  drawings.delete(id);
  emit();
}
export function useDrawings() {
  useSyncExternalStore(subscribe, () => store.version);
  return allDrawings();
}
export function useDrawing(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return drawings.get(id) ?? null;
}

export function registerRuntime(id: string, runtime: Runtime) {
  runtimes.set(id, runtime);
}
export const flushDrawing = (id: string) => runtimes.get(id)?.flush();
/** Called by the live scene with its newly serialized contents. */
export function setScene(id: string, text: string) {
  if (!hasDrawing(id) || getDrawing(id).text === text) return;
  updateDrawing(id, { text });
  scheduleAutosave(id);
}
function scheduleAutosave(id: string) {
  clearTimeout(autosaves.get(id));
  const d = getDrawing(id);
  // Only a drawing bound to a file saves itself; a new one waits for Save As.
  if (!d.path || d.conflict || !dirty(d)) return;
  autosaves.set(
    id,
    setTimeout(() => {
      autosaves.delete(id);
      if (hasDrawing(id)) void saveDrawing(id).catch(() => {});
    }, AUTOSAVE_MS),
  );
}

/** Saves are serialized per drawing, so an older write never lands after a newer one. */
export function saveDrawing(id: string, saveAs = false): Promise<boolean> {
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
const EMPTY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "tessera",
  elements: [],
  appState: {},
  files: {},
});
async function performSave(id: string, saveAs: boolean) {
  if (!hasDrawing(id)) return false;
  flushDrawing(id);
  const d = getDrawing(id),
    text = content(d) ?? EMPTY;
  if (!saveAs && d.path && text === d.saved && !d.conflict) return true;
  if (!saveAs && d.conflict) throw new Error(d.conflict);
  clearTimeout(autosaves.get(id));
  updateDrawing(id, { saving: true });
  try {
    const outcome = await drawingsBackend.save({
      path: saveAs ? null : d.path,
      current: d.path,
      text,
      revision: saveAs ? null : d.revision,
      bom: d.bom,
      ending: d.ending,
      name: d.path && !saveAs ? d.name : baseName(d.name),
    });
    if (!hasDrawing(id)) return outcome.kind === "saved";
    if (outcome.kind === "cancelled") {
      updateDrawing(id, { saving: false });
      return false;
    }
    if (outcome.kind === "conflict") {
      updateDrawing(id, { saving: false, conflict: outcome.message });
      return false;
    }
    updateDrawing(id, {
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
    if (hasDrawing(id))
      updateDrawing(id, {
        saving: false,
        error: String(error).replace(/^Error: /, ""),
      });
    throw error;
  }
}
/** Lets pending automatic saves finish before a close asks about unsaved changes. */
export async function settleDrawing(id: string) {
  if (!hasDrawing(id)) return;
  flushDrawing(id);
  clearTimeout(autosaves.get(id));
  autosaves.delete(id);
  const d = getDrawing(id);
  const pending = saves.get(id);
  if (d.path && !d.conflict && dirty(d))
    await saveDrawing(id).catch(() => false);
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
/** Opens a drawing file, or returns the drawing that already shows it. `null` when the dialog
 * was cancelled or another window shows the file. */
export async function openDrawingFile(path: string | null) {
  const outcome = await drawingsBackend.open(path);
  if (!outcome || outcome.kind === "elsewhere") return null;
  const existing = allDrawings().find((d) => d.path === outcome.file.path);
  return existing?.id ?? createDrawing(fromFile(outcome.file));
}
export const findByPath = (path: string) =>
  allDrawings().find((d) => d.path === path)?.id ?? null;
/** The previous session's drawings, reopened the first time Excalidraw is opened. */
export async function restoreSession() {
  const result = { ids: [] as string[], errors: [] as string[] };
  if (restored) return result;
  restored = true;
  const paths = await drawingsBackend.takePending().catch(() => []);
  for (const path of paths) {
    try {
      const id = await openDrawingFile(path);
      if (id) result.ids.push(id);
    } catch (error) {
      result.errors.push(String(error).replace(/^Error: /, ""));
    }
  }
  return result;
}
/** Applies a newer disk version to a clean drawing, or marks the drawing as conflicting. */
export async function checkDrawing(id: string) {
  const d = getDrawing(id);
  // Our own write in progress changes the file before its revision is known here.
  if (!d.path || d.conflict || saves.has(id)) return;
  const file = await drawingsBackend.check(d.path, d.revision);
  if (!file || !hasDrawing(id) || saves.has(id)) return;
  const current = getDrawing(id);
  if (current.path !== d.path || current.revision !== d.revision) return;
  flushDrawing(id);
  if (dirty(getDrawing(id)))
    updateDrawing(id, {
      conflict:
        "The drawing changed on disk. Save As to keep your version, or reload the disk version.",
    });
  else reloadDrawing(id, file);
}
export function reloadDrawing(id: string, file: FileData) {
  clearTimeout(autosaves.get(id));
  updateDrawing(id, { ...fromFile(file), conflict: null, error: null });
  runtimes.get(id)?.reload(file.text);
}

/** The workspace opens drawings for the File Manager and the Excalidraw menu. */
export function setOpener(fn: ((path: string | null) => void) | null) {
  opener = fn;
}
export const requestOpen = (path: string | null = null) => opener?.(path);
export function onError(fn: (message: string) => void) {
  errorListeners.add(fn);
  return () => {
    errorListeners.delete(fn);
  };
}
export const reportError = (error: unknown) =>
  errorListeners.forEach((fn) => fn(String(error).replace(/^Error: /, "")));
export const isDrawingPath = (path: string) => /\.excalidraw$/i.test(path);
const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jfif", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["avif", "image/avif"],
]);
/** The MIME type of an image Excalidraw accepts, from its extension. */
export const imageType = (path: string) =>
  IMAGE_TYPES.get(/\.([^.\\/]+)$/.exec(path)?.[1].toLowerCase() ?? "");
