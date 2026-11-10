import { pathKey, baseName } from "./paths";

/**
 * Comparisons, as in VS Code's Source Control: a working tree change compares the staged
 * text with the current one, which can be edited (it is the file's document); a staged change
 * compares the last commit with the staged text, read only. A file of a commit in the
 * Source Control graph compares its first parent's text with the commit's, read only.
 */
export interface CommitSide {
  /** The project's root, whose repository holds the commit. */
  root: string;
  hash: string;
  /** The first parent; null for a first commit. */
  parent: string | null;
  /** The file's name in the parent, when the commit renamed it. */
  oldPath: string | null;
}
export interface DiffSource {
  path: string;
  staged: boolean;
  commit?: CommitSide;
  /** The document a working tree comparison shows and edits, once loaded. */
  document: string | null;
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
export const diffDocument = (id: string) =>
  store.diffs.get(id)?.document ?? null;
export function setDiffDocument(id: string, document: string | null) {
  const diff = store.diffs.get(id);
  if (!diff || diff.document === document) return;
  store.diffs.set(id, { ...diff, document });
  emit();
}
export function createDiff(path = "", staged = false, commit?: CommitSide) {
  const id = crypto.randomUUID();
  store.diffs.set(id, { path, staged, document: null, commit });
  emit();
  return id;
}
export const diffFor = (path: string, staged = false) =>
  [...store.diffs].find(
    ([, d]) =>
      d.path &&
      !d.commit &&
      d.staged === staged &&
      pathKey(d.path) === pathKey(path),
  )?.[0] ?? null;
/** The open comparison of a file of a commit, if any. */
export const commitDiffFor = (path: string, hash: string) =>
  [...store.diffs].find(
    ([, d]) => d.commit?.hash === hash && pathKey(d.path) === pathKey(path),
  )?.[0] ?? null;
export function diffTitle(id: string) {
  const diff = store.diffs.get(id);
  const kind = diff?.commit
    ? diff.commit.hash.slice(0, 7)
    : diff?.staged
      ? "staged"
      : "changes";
  return `${baseName(diff?.path || "Changes")} (${kind})`;
}
export function disposeDiff(id: string) {
  store.diffs.delete(id);
  emit();
}
export const usedByDiff = (document: string) =>
  [...store.diffs.values()].some((d) => d.document === document);
