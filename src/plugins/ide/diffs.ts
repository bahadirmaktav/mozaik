import { pathKey, baseName } from "./paths";

/** Read-only comparisons of a file's committed text with its current text. */
interface Store {
  diffs: Map<string, string>;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideDiffs ?? {
  diffs: new Map(),
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideDiffs = store;
export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => {
    store.listeners.delete(fn);
  };
}
const emit = () => {
  store.version++;
  store.listeners.forEach((fn) => fn());
};
export const version = () => store.version;
export const diffPath = (id: string) => store.diffs.get(id) ?? "";
export function createDiff(path = "") {
  const id = crypto.randomUUID();
  store.diffs.set(id, path);
  emit();
  return id;
}
export const diffFor = (path: string) =>
  [...store.diffs].find(([, p]) => p && pathKey(p) === pathKey(path))?.[0] ??
  null;
export const diffTitle = (id: string) =>
  `${baseName(store.diffs.get(id) || "Changes")} (changes)`;
export function disposeDiff(id: string) {
  store.diffs.delete(id);
  emit();
}
