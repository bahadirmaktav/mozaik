import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_TODO_TAGS } from "../../services/preferences";
import { ideBackend } from "../../services/ide";
import { message } from "./editors";
import { within } from "./paths";
import { getProject } from "./projects";
import { parseTodo, todoSearchPattern, type TodoItem } from "./todoModel";

export interface TodoFile {
  path: string;
  relative: string;
  items: TodoItem[];
}
export interface ProjectTodos {
  files: TodoFile[];
  running: boolean;
  error: string | null;
  /** Only the first matches were listed. */
  truncated: boolean;
}
interface Store {
  /** The tags of Workspace Settings → IDE. */
  tags: string[];
  /** Listed by tag instead of by file. */
  byTag: boolean;
  projects: Map<string, ProjectTodos>;
  timers: Map<string, number>;
  listeners: Set<() => void>;
  version: number;
  started: boolean;
}
const store: Store = import.meta.hot?.data.ideTodos ?? {
  tags: DEFAULT_TODO_TAGS,
  byTag: false,
  projects: new Map(),
  timers: new Map(),
  listeners: new Set(),
  version: 0,
  started: false,
};
if (import.meta.hot) import.meta.hot.data.ideTodos = store;

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
export function useTodos() {
  useSyncExternalStore(subscribe, () => store.version);
  return store;
}
export const todoTags = () => store.tags;

/** New tags from the settings: lists already shown are searched again. */
export function setTodoTags(tags: string[]) {
  if (tags.join("\n") === store.tags.join("\n")) return;
  store.tags = tags;
  emit();
  for (const id of store.projects.keys()) void scanTodos(id);
}
export function setByTag(byTag: boolean) {
  store.byTag = byTag;
  emit();
}

/**
 * Lists the tagged comments of a project's files with the project search (it skips what
 * .gitignore and the project's exclusions leave out). Saved files only, as in Todo Tree.
 */
export async function scanTodos(id: string) {
  const root = getProject(id)?.root;
  if (!root) return;
  start();
  const tags = store.tags;
  const previous = store.projects.get(id);
  store.projects.set(id, {
    files: previous?.files ?? [],
    truncated: previous?.truncated ?? false,
    running: true,
    error: null,
  });
  emit();
  const pattern = todoSearchPattern(tags);
  try {
    const result = pattern
      ? await ideBackend.search(root, {
          text: pattern,
          regex: true,
          matchCase: true,
          wholeWord: false,
        })
      : { files: [], truncated: false };
    if (getProject(id)?.root !== root || store.tags !== tags) return;
    const files = result.files
      .map((file) => ({
        path: file.path,
        relative: file.relative,
        items: file.matches
          .map((m) => parseTodo(m, tags))
          .filter((item): item is TodoItem => !!item),
      }))
      .filter((file) => file.items.length)
      .sort((a, b) => a.relative.localeCompare(b.relative));
    store.projects.set(id, {
      files,
      truncated: result.truncated,
      running: false,
      error: null,
    });
  } catch (e) {
    store.projects.set(id, {
      files: [],
      truncated: false,
      running: false,
      error: message(e),
    });
  }
  emit();
}
export function disposeTodos(id: string) {
  clearTimeout(store.timers.get(id));
  store.timers.delete(id);
  if (store.projects.delete(id)) emit();
}

/** Lists already shown follow saved changes, a little after the last one. */
function start() {
  if (store.started || !isTauri()) return;
  store.started = true;
  void listen<string[]>("disk-change", (event) => {
    for (const id of store.projects.keys()) {
      const root = getProject(id)?.root;
      if (!root) continue;
      const paths = event.payload;
      if (paths.length && !paths.some((p) => within(root, p))) continue;
      clearTimeout(store.timers.get(id));
      store.timers.set(
        id,
        window.setTimeout(() => void scanTodos(id), 800),
      );
    }
  });
}
