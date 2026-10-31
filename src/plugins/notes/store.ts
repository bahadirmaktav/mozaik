import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FileData } from "../../services/native";
import { fileSystem } from "../../services/filesystem";
import { preferencesBackend } from "../../services/preferences";
import {
  groupOf,
  inGroup,
  isNote,
  notesBackend,
  type Vault,
} from "../../services/notes";
import { join, pathKey, relative } from "../ide/paths";

export type Mode = "edit" | "preview";
/** Text typed in a note that is not yet saved. It is shown instead of the saved text until a
 * save of exactly this text succeeds. */
export interface Draft {
  value: string;
  saving: Promise<boolean> | null;
  error: string | null;
  /** The file changed on disk since it was read: Reload or Overwrite decides. */
  conflict: boolean;
  timer: number | undefined;
}
interface Store {
  vault: Vault | null;
  loading: boolean;
  /** The vault could not be read; nothing can be changed until it is fixed. */
  loadError: string | null;
  /** The last change that failed. */
  error: string | null;
  /** Saved text of the notes read so far, by path. */
  files: Map<string, FileData>;
  /** Notes that could not be read, by path. */
  unreadable: Map<string, string>;
  drafts: Map<string, Draft>;
  modes: Map<string, Mode>;
  expanded: Set<string>;
  /** The note or group chosen in the tree; null is the vault itself. */
  selected: string | null;
  /** Directory watches by folder key. */
  watches: Map<string, string>;
  timer: number | undefined;
  folder: string | null | undefined;
  listeners: Set<() => void>;
  version: number;
  started: boolean;
}
// The vault is shared by the whole window; drafts survive switching notes.
const store: Store = import.meta.hot?.data.notesStore ?? {
  vault: null,
  loading: false,
  loadError: null,
  error: null,
  files: new Map(),
  unreadable: new Map(),
  drafts: new Map(),
  modes: new Map(),
  expanded: new Set(),
  selected: null,
  watches: new Map(),
  timer: undefined,
  folder: undefined,
  listeners: new Set(),
  version: 0,
  started: false,
};
if (import.meta.hot) import.meta.hot.data.notesStore = store;
const { files, drafts, modes, listeners } = store;
export const NOTES_ID = "notes";
/** Content saves shortly after typing pauses; a crash loses at most this much typing. */
export const CONTENT_DELAY = 500;
const message = (error: unknown) => String(error).replace(/^Error: /, "");
const CHANGED = "changed or disappeared on disk";

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

/** Watches the vault and its groups, so changes by other programs show up. */
function syncWatches(vault: Vault) {
  if (!isTauri()) return;
  const wanted = new Map<string, string>();
  if (vault.root) {
    wanted.set(pathKey(vault.root), vault.root);
    for (const group of vault.groups) {
      const path = join(vault.root, group);
      wanted.set(pathKey(path), path);
    }
  }
  for (const [key, owner] of store.watches)
    if (!wanted.has(key)) {
      store.watches.delete(key);
      void fileSystem.watch(owner, null).catch(() => {});
    }
  for (const [key, path] of wanted)
    if (!store.watches.has(key)) {
      const owner = crypto.randomUUID();
      store.watches.set(key, owner);
      void fileSystem.watch(owner, path).catch(() => store.watches.delete(key));
    }
}
export async function refresh() {
  store.loading = true;
  emit();
  try {
    const vault = await notesBackend.snapshot();
    store.vault = vault;
    store.loadError = null;
    syncWatches(vault);
  } catch (error) {
    store.loadError = message(error);
  } finally {
    store.loading = false;
    emit();
  }
}
/** Reads a note's saved text once; `force` reads it again (a clean note changed on disk). */
export async function load(path: string, force = false) {
  if (!force && (files.has(path) || store.unreadable.has(path))) return;
  try {
    const file = await notesBackend.read(path);
    files.set(path, file);
    // A note opens in Preview when it has text, else in Edit; saving keeps the choice.
    if (!modes.has(path)) modes.set(path, file.text ? "preview" : "edit");
    store.unreadable.delete(path);
  } catch (error) {
    store.unreadable.set(path, message(error));
  }
  emit();
}
/** Another program changed the vault: list it again and reload clean notes. */
function changed(paths: string[]) {
  const root = store.vault?.root;
  if (!root || (paths.length && !paths.some((p) => relative(root, p) !== null)))
    return;
  clearTimeout(store.timer);
  store.timer = window.setTimeout(() => {
    void refresh();
    for (const path of [...files.keys()])
      if (!drafts.has(path)) void load(path, true);
  }, 200);
}
function start() {
  if (store.started) return;
  store.started = true;
  if (!isTauri()) return;
  void listen<string[]>("disk-change", (event) => changed(event.payload));
  // Choosing another vault in Workspace Settings shows it.
  void preferencesBackend.onChange((preferences) => {
    if (preferences.notesFolder !== store.folder)
      switchVault(preferences.notesFolder);
  });
  window.addEventListener("focus", () => changed([]));
}
function switchVault(folder: string | null) {
  store.folder = folder;
  // Unsaved text of the previous vault stays a draft until it is saved or discarded; only
  // the clean state is dropped.
  for (const path of [...files.keys()])
    if (!drafts.has(path)) files.delete(path);
  store.unreadable.clear();
  store.expanded.clear();
  store.selected = null;
  void refresh();
}
/** Picks the vault folder in the native dialog and keeps it in the preferences. */
export function chooseVault() {
  return run(async () => {
    const folder = await preferencesBackend.chooseFolder();
    if (!folder) return;
    const preferences = await preferencesBackend.get();
    await preferencesBackend.set({ ...preferences, notesFolder: folder });
    if (!isTauri()) switchVault(folder);
  });
}

/** Runs a change; reports a failure above the panel and resolves false. */
async function run(work: () => Promise<unknown>) {
  try {
    await work();
    store.error = null;
    return true;
  } catch (error) {
    store.error = message(error);
    return false;
  } finally {
    emit();
  }
}
/** Moves caches from a renamed or moved note or group to its new path. */
function remap(from: string, to: string) {
  const moved = (path: string) =>
    path === from
      ? to
      : path.startsWith(`${from}/`)
        ? to + path.slice(from.length)
        : null;
  for (const map of [files, drafts, modes, store.unreadable] as Map<
    string,
    unknown
  >[])
    for (const [path, value] of [...map]) {
      const next = moved(path);
      if (next === null) continue;
      map.delete(path);
      map.set(next, value);
    }
  for (const group of [...store.expanded]) {
    const next = moved(group);
    if (next === null) continue;
    store.expanded.delete(group);
    store.expanded.add(next);
  }
  if (store.selected) store.selected = moved(store.selected) ?? store.selected;
}
/** Shows a note or group: its groups open and it is selected. */
function reveal(path: string) {
  for (let group = groupOf(path); group; group = groupOf(group))
    store.expanded.add(group);
  store.selected = path;
}
/** The group new notes and groups go to: the selected group, or the selected note's. */
export function targetGroup() {
  const selected = store.selected;
  if (!selected) return "";
  return isNote(selected) ? groupOf(selected) : selected;
}
export const notes = {
  async create(title: string, group = targetGroup()) {
    try {
      const path = await notesBackend.create(group, title);
      await refresh();
      reveal(path);
      modes.set(path, "edit");
      emit();
      return null;
    } catch (error) {
      return message(error);
    }
  },
  async createGroup(name: string, parent = targetGroup()) {
    try {
      const path = await notesBackend.createGroup(parent, name);
      await refresh();
      reveal(path);
      emit();
      return null;
    } catch (error) {
      return message(error);
    }
  },
  select(path: string | null) {
    store.selected = path;
    if (path && isNote(path)) void load(path);
    emit();
  },
  toggle(group: string, open = !store.expanded.has(group)) {
    if (open) store.expanded.add(group);
    else store.expanded.delete(group);
    emit();
  },
  /** A note's title or a group's name; unsaved text is saved first. */
  async rename(path: string, name: string) {
    for (const note of [...drafts.keys()])
      if (inGroup(note, path) && !(await commit(note)))
        return "Save the note's changes before renaming it";
    try {
      const next = await notesBackend.rename(path, name);
      remap(path, next);
      await refresh();
      return null;
    } catch (error) {
      return message(error);
    } finally {
      emit();
    }
  },
  async move(path: string, group: string) {
    for (const note of [...drafts.keys()])
      if (inGroup(note, path) && !(await commit(note))) {
        store.error = "Save the note's changes before moving it";
        emit();
        return false;
      }
    return run(async () => {
      const next = await notesBackend.move(path, group);
      remap(path, next);
      reveal(next);
      await refresh();
    });
  },
  /** Moves a note or group to the Trash; the caller asked for confirmation. */
  trash(path: string) {
    return run(async () => {
      await notesBackend.trash(path);
      for (const map of [files, drafts, modes, store.unreadable] as Map<
        string,
        unknown
      >[])
        for (const key of [...map.keys()])
          if (inGroup(key, path)) {
            if (map === drafts) clearTimeout(drafts.get(key)!.timer);
            map.delete(key);
          }
      if (store.selected && inGroup(store.selected, path))
        store.selected = groupOf(path) || null;
      await refresh();
    });
  },
  dismissError() {
    store.error = null;
    emit();
  },
};

export const draftOf = (path: string) => drafts.get(path);
export function setDraft(path: string, value: string) {
  const draft = drafts.get(path) ?? {
    value,
    saving: null,
    error: null,
    conflict: false,
    timer: undefined,
  };
  draft.value = value;
  clearTimeout(draft.timer);
  draft.timer = window.setTimeout(() => void commit(path), CONTENT_DELAY);
  drafts.set(path, draft);
  emit();
}
export function discardDraft(path: string) {
  const draft = drafts.get(path);
  if (!draft) return;
  clearTimeout(draft.timer);
  drafts.delete(path);
  emit();
}
/** Saves a draft. Saves of one note run in order; typing during a save stays a draft. A
 * file changed on disk is never overwritten without the user's Overwrite. */
export function commit(path: string): Promise<boolean> {
  const draft = drafts.get(path);
  if (!draft) return Promise.resolve(true);
  clearTimeout(draft.timer);
  if (draft.saving) return draft.saving.then(() => commit(path));
  const saved = files.get(path);
  if (!saved || draft.conflict) return Promise.resolve(false);
  const value = draft.value;
  draft.error = null;
  draft.saving = (async () => {
    let error: string | null = null;
    try {
      files.set(path, await notesBackend.write(path, value, saved));
    } catch (e) {
      error = message(e);
    }
    draft.saving = null;
    if (drafts.get(path) === draft) {
      if (error) {
        draft.error = error;
        draft.conflict = error.includes(CHANGED);
      } else if (draft.value === value) drafts.delete(path);
    }
    emit();
    return error === null;
  })();
  emit();
  return draft.saving;
}
/** The note changed on disk: drop the unsaved text and show the file. */
export async function reloadNote(path: string) {
  discardDraft(path);
  await load(path, true);
}
/** The note changed on disk: replace the file with the unsaved text. */
export async function overwriteNote(path: string) {
  const draft = drafts.get(path);
  if (!draft) return;
  try {
    files.set(path, await notesBackend.read(path));
  } catch {
    // Gone from disk: nothing to compare against; the save below reports it.
  }
  draft.conflict = false;
  await commit(path);
}
export async function saveAll() {
  const results = await Promise.all([...drafts.keys()].map((p) => commit(p)));
  return results.every(Boolean) && drafts.size === 0;
}
/** Lets pending content saves finish before closing decides whether to ask. */
export async function settle() {
  await saveAll();
}
export const hasDrafts = () => drafts.size > 0;
export const savedText = (path: string) => files.get(path)?.text;
export const unreadable = (path: string) => store.unreadable.get(path);
export const isExpanded = (group: string) => store.expanded.has(group);
export const selected = () => store.selected;

export function modeOf(path: string): Mode {
  return modes.get(path) ?? "edit";
}
export function setMode(path: string, mode: Mode) {
  modes.set(path, mode);
  emit();
}

export function createInstance() {
  start();
  void preferencesBackend
    .get()
    .then((p) => (store.folder = p.notesFolder))
    .catch(() => {});
  void refresh();
  emit();
  return NOTES_ID;
}
export function disposeInstance() {
  // Closing was confirmed: remaining drafts were explicitly discarded.
  for (const draft of drafts.values()) clearTimeout(draft.timer);
  drafts.clear();
  store.error = null;
  syncWatches({ root: null, groups: [], notes: [], truncated: false });
  if (isTauri()) void notesBackend.releasePanel().catch(() => {});
  emit();
}
export function claimPanel() {
  return isTauri() ? notesBackend.claimPanel() : Promise.resolve(true);
}
export function useNotes() {
  useSyncExternalStore(subscribe, () => store.version);
  return {
    vault: store.vault,
    loading: store.loading,
    loadError: store.loadError,
    error: store.error,
    selected: store.selected,
  };
}
