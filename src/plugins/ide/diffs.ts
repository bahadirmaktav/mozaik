import { pathKey, baseName } from "./paths";

/**
 * Read-only comparisons, as in VS Code's Source Control: a working tree change compares the
 * staged text with the current one, a staged change the last commit with the staged text.
 */
export interface DiffSource {
  path: string;
  staged: boolean;
}
interface Store {
  diffs: Map<string, DiffSource>;
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
export const diffSource = (id: string) => store.diffs.get(id) ?? null;
export function createDiff(path = "", staged = false) {
  const id = crypto.randomUUID();
  store.diffs.set(id, { path, staged });
  emit();
  return id;
}
export const diffFor = (path: string, staged = false) =>
  [...store.diffs].find(
    ([, d]) =>
      d.path && d.staged === staged && pathKey(d.path) === pathKey(path),
  )?.[0] ?? null;
export function diffTitle(id: string) {
  const diff = store.diffs.get(id);
  return `${baseName(diff?.path || "Changes")} (${diff?.staged ? "staged" : "changes"})`;
}
export function disposeDiff(id: string) {
  store.diffs.delete(id);
  emit();
}
