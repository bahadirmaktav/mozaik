import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  tasksBackend,
  type Status,
  type TaskPatch,
  type TasksDocument,
} from "../../services/tasks";
import { defaultCollapsed, type Collapsed } from "./model";

export type Screen = { kind: "list" } | { kind: "task"; id: string };
export interface TasksView {
  screen: Screen;
  collapsed: Collapsed;
}
export type DraftField = "title" | "descriptionMarkdown";
/** Text typed in the details that is not yet saved. It is shown instead of the saved
 * value until a save of exactly this text succeeds. */
export interface Draft {
  value: string;
  saving: Promise<boolean> | null;
  error: string | null;
  timer: number | undefined;
}
interface Store {
  document: TasksDocument | null;
  loading: boolean;
  /** The file could not be read; nothing can be changed until it is fixed. */
  loadError: string | null;
  /** The last change that failed to save. */
  error: string | null;
  views: Map<string, TasksView>;
  drafts: Map<string, Draft>;
  listeners: Set<() => void>;
  version: number;
  started: boolean;
}
// The document is shared by the whole window; views only hold navigation and collapse state.
const store: Store = import.meta.hot?.data.tasksStore ?? {
  document: null,
  loading: false,
  loadError: null,
  error: null,
  views: new Map(),
  drafts: new Map(),
  listeners: new Set(),
  version: 0,
  started: false,
};
if (import.meta.hot) import.meta.hot.data.tasksStore = store;
const { views, drafts, listeners } = store;
export const TASKS_ID = "tasks";
const DESCRIPTION_DELAY = 600;
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
function apply(document: TasksDocument) {
  if (store.document && document.revision < store.document.revision) return;
  store.document = document;
  store.loadError = null;
  const live = new Set(document.tasks.map((t) => t.id));
  for (const [key, draft] of drafts)
    if (!live.has(key.split(":")[0])) {
      clearTimeout(draft.timer);
      drafts.delete(key);
    }
  for (const view of views.values())
    if (view.screen.kind === "task" && !live.has(view.screen.id))
      view.screen = { kind: "list" };
  emit();
}
export async function refresh() {
  store.loading = true;
  emit();
  try {
    apply(await tasksBackend.snapshot());
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
  void listen<TasksDocument>("tasks-changed", (event) => apply(event.payload));
  window.addEventListener("focus", () => void refresh());
}
/** Runs a mutation; resolves with the error message, or null once it was saved. */
export async function attempt(request: () => Promise<TasksDocument>) {
  try {
    apply(await request());
    return null;
  } catch (error) {
    return message(error);
  }
}
/** Like `attempt`, but reports a failure above the list. */
async function run(request: () => Promise<TasksDocument>) {
  const error = await attempt(request);
  store.error = error;
  emit();
  return error === null;
}
export const tasks = {
  selectList: (id: string) => run(() => tasksBackend.selectList(id)),
  createList: (name: string) => attempt(() => tasksBackend.createList(name)),
  renameList: (id: string, name: string) =>
    attempt(() => tasksBackend.renameList(id, name)),
  deleteList: (id: string) => run(() => tasksBackend.deleteList(id)),
  createTask: (listId: string, status: Status, title: string) =>
    attempt(() => tasksBackend.createTask(listId, status, title)),
  update: (id: string, patch: TaskPatch) =>
    run(() => tasksBackend.updateTask(id, patch)),
  move: (
    id: string,
    status: Status,
    before: string | null,
    after: string | null,
  ) => run(() => tasksBackend.moveTask(id, status, before, after)),
  remove: (id: string) => run(() => tasksBackend.deleteTask(id)),
  dismissError() {
    store.error = null;
    emit();
  },
};

const key = (task: string, field: DraftField) => `${task}:${field}`;
export const draftOf = (task: string, field: DraftField) =>
  drafts.get(key(task, field));
export function setDraft(task: string, field: DraftField, value: string) {
  const id = key(task, field);
  const draft = drafts.get(id) ?? {
    value,
    saving: null,
    error: null,
    timer: undefined,
  };
  draft.value = value;
  clearTimeout(draft.timer);
  // Descriptions save shortly after typing pauses; titles save on Enter or blur.
  if (field === "descriptionMarkdown")
    draft.timer = window.setTimeout(
      () => void commit(task, field),
      DESCRIPTION_DELAY,
    );
  drafts.set(id, draft);
  emit();
}
export function discardDraft(task: string, field: DraftField) {
  const draft = drafts.get(key(task, field));
  if (!draft) return;
  clearTimeout(draft.timer);
  drafts.delete(key(task, field));
  emit();
}
/** Saves a draft. Saves of one field run in order; typing during a save stays a draft. */
export function commit(task: string, field: DraftField): Promise<boolean> {
  const id = key(task, field),
    draft = drafts.get(id);
  if (!draft) return Promise.resolve(true);
  clearTimeout(draft.timer);
  if (draft.saving) return draft.saving.then(() => commit(task, field));
  const value = draft.value;
  if (field === "title" && !value.trim()) {
    draft.error = "A task needs a title";
    emit();
    return Promise.resolve(false);
  }
  draft.error = null;
  draft.saving = (async () => {
    const error = await attempt(() =>
      tasksBackend.updateTask(task, { [field]: value }),
    );
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
      const [task, field] = id.split(":") as [string, DraftField];
      return commit(task, field);
    }),
  );
  return results.every(Boolean) && drafts.size === 0;
}
export const hasDrafts = () => drafts.size > 0;
export const current = () => store.document;

export function createInstance() {
  start();
  // A reopened panel starts in list view with the default sections.
  if (!views.has(TASKS_ID))
    views.set(TASKS_ID, {
      screen: { kind: "list" },
      collapsed: defaultCollapsed(),
    });
  void refresh();
  emit();
  return TASKS_ID;
}
export function disposeInstance(id: string) {
  views.delete(id);
  // Closing was confirmed: remaining drafts were explicitly discarded.
  for (const draft of drafts.values()) clearTimeout(draft.timer);
  drafts.clear();
  store.error = null;
  if (isTauri()) void tasksBackend.releasePanel().catch(() => {});
  emit();
}
export function claimPanel() {
  return isTauri() ? tasksBackend.claimPanel() : Promise.resolve(true);
}
function view(id: string) {
  return views.get(id);
}
export function navigate(id: string, screen: Screen) {
  const current = view(id);
  if (!current) return;
  current.screen = screen;
  emit();
}
export function toggleSection(id: string, status: Status) {
  const current = view(id);
  if (!current) return;
  current.collapsed = {
    ...current.collapsed,
    [status]: !current.collapsed[status],
  };
  emit();
}
export function useTasks(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return {
    document: store.document,
    loading: store.loading,
    loadError: store.loadError,
    error: store.error,
    view: views.get(id) ?? null,
  };
}
