import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  notesBackend,
  type NotePatch,
  type NotesDocument,
} from "../../services/notes";

export type Mode = "edit" | "preview";
export type DraftField = "title" | "contentMarkdown";
/** Text typed in a note that is not yet saved. It is shown instead of the saved value until
 * a save of exactly this text succeeds. */
export interface Draft {
  value: string;
  saving: Promise<boolean> | null;
  error: string | null;
  timer: number | undefined;
}
interface Store {
  document: NotesDocument | null;
  loading: boolean;
  /** The file could not be read; nothing can be changed until it is fixed. */
  loadError: string | null;
  /** The last change that failed to save. */
  error: string | null;
  drafts: Map<string, Draft>;
  modes: Map<string, Mode>;
  /** The note chosen in this window; shown at once, while saving the choice follows. */
  selected: string | null;
  listeners: Set<() => void>;
  version: number;
  started: boolean;
}
// The document is shared by the whole window; drafts survive switching notes.
const store: Store = import.meta.hot?.data.notesStore ?? {
  document: null,
  loading: false,
  loadError: null,
  error: null,
  drafts: new Map(),
  modes: new Map(),
  selected: null,
  listeners: new Set(),
  version: 0,
  started: false,
};
if (import.meta.hot) import.meta.hot.data.notesStore = store;
const { drafts, modes, listeners } = store;
export const NOTES_ID = "notes";
/** Content saves shortly after typing pauses; a crash loses at most this much typing. */
export const CONTENT_DELAY = 500;
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
/** Applies a saved document unless a newer one is already shown. */
function apply(document: NotesDocument) {
  if (store.document && document.revision < store.document.revision) return;
  store.document = document;
  store.loadError = null;
  const live = new Set(document.notes.map((n) => n.id));
  for (const [key, draft] of drafts)
    if (!live.has(key.split(":")[0])) {
      clearTimeout(draft.timer);
      drafts.delete(key);
    }
  emit();
}
export async function refresh() {
  store.loading = true;
  emit();
  try {
    apply(await notesBackend.snapshot());
  } catch (error) {
    store.loadError = message(error);
  } finally {
    store.loading = false;
    emit();
  }
}
function start() {
  if (store.started) return;
  store.started = true;
  if (!isTauri()) return;
  // Other windows announce saved changes; another process is picked up on focus.
  void listen<NotesDocument>("notes-changed", (event) => apply(event.payload));
  window.addEventListener("focus", () => void refresh());
}
/** Runs a change; resolves with the error message, or null once it was saved. */
export async function attempt(request: () => Promise<NotesDocument>) {
  try {
    apply(await request());
    return null;
  } catch (error) {
    return message(error);
  }
}
/** Like `attempt`, but reports a failure above the note. */
async function run(request: () => Promise<NotesDocument>) {
  const error = await attempt(request);
  store.error = error;
  emit();
  return error === null;
}
export const notes = {
  async create(title: string) {
    const error = await attempt(() => notesBackend.create(title));
    // The new note is selected by the saved document.
    if (!error) store.selected = null;
    emit();
    return error;
  },
  select(id: string) {
    // Typing right after a click must reach the clicked note, not the previous one.
    store.selected = id;
    emit();
    return run(() => notesBackend.select(id));
  },
  move: (id: string, before: string | null, after: string | null) =>
    run(() => notesBackend.move(id, before, after)),
  async remove(id: string) {
    if (store.selected === id) store.selected = null;
    return run(() => notesBackend.remove(id));
  },
  dismissError() {
    store.error = null;
    emit();
  },
};

const key = (note: string, field: DraftField) => `${note}:${field}`;
export const draftOf = (note: string, field: DraftField) =>
  drafts.get(key(note, field));
export function setDraft(note: string, field: DraftField, value: string) {
  const id = key(note, field);
  const draft = drafts.get(id) ?? {
    value,
    saving: null,
    error: null,
    timer: undefined,
  };
  draft.value = value;
  clearTimeout(draft.timer);
  // Content saves while typing pauses; titles save on Enter or blur.
  if (field === "contentMarkdown")
    draft.timer = window.setTimeout(
      () => void commit(note, field),
      CONTENT_DELAY,
    );
  drafts.set(id, draft);
  emit();
}
export function discardDraft(note: string, field: DraftField) {
  const draft = drafts.get(key(note, field));
  if (!draft) return;
  clearTimeout(draft.timer);
  drafts.delete(key(note, field));
  emit();
}
/** Saves a draft. Saves of one field run in order; typing during a save stays a draft. */
export function commit(note: string, field: DraftField): Promise<boolean> {
  const id = key(note, field),
    draft = drafts.get(id);
  if (!draft) return Promise.resolve(true);
  clearTimeout(draft.timer);
  if (draft.saving) return draft.saving.then(() => commit(note, field));
  const value = draft.value;
  if (field === "title" && !value.trim()) {
    draft.error = "A note needs a title";
    emit();
    return Promise.resolve(false);
  }
  draft.error = null;
  const patch: NotePatch = { [field]: value };
  draft.saving = (async () => {
    const error = await attempt(() => notesBackend.update(note, patch));
    draft.saving = null;
    if (drafts.get(id) === draft) {
      if (error) draft.error = error;
      else if (draft.value === value) drafts.delete(id);
    }
    emit();
    return error === null;
  })();
  emit();
  return draft.saving;
}
export async function saveAll() {
  const results = await Promise.all(
    [...drafts.keys()].map((id) => {
      const [note, field] = id.split(":") as [string, DraftField];
      return commit(note, field);
    }),
  );
  return results.every(Boolean) && drafts.size === 0;
}
/** Lets pending content saves finish before closing decides whether to ask. */
export async function settle() {
  await saveAll();
}
export const hasDrafts = () => drafts.size > 0;
export const current = () => store.document;
/** The note shown in the panel. */
export function selectedId(document: NotesDocument) {
  return store.selected && document.notes.some((n) => n.id === store.selected)
    ? store.selected
    : document.preferences.selectedNoteId;
}

export function modeOf(note: string, content: string): Mode {
  return modes.get(note) ?? (content ? "preview" : "edit");
}
export function setMode(note: string, mode: Mode) {
  modes.set(note, mode);
  emit();
}

export function createInstance() {
  start();
  void refresh();
  emit();
  return NOTES_ID;
}
export function disposeInstance() {
  // Closing was confirmed: remaining drafts were explicitly discarded.
  for (const draft of drafts.values()) clearTimeout(draft.timer);
  drafts.clear();
  store.error = null;
  if (isTauri()) void notesBackend.releasePanel().catch(() => {});
  emit();
}
export function claimPanel() {
  return isTauri() ? notesBackend.claimPanel() : Promise.resolve(true);
}
export function useNotes() {
  useSyncExternalStore(subscribe, () => store.version);
  return {
    document: store.document,
    loading: store.loading,
    loadError: store.loadError,
    error: store.error,
  };
}
