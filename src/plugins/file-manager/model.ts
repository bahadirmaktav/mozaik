import { isDirectory, type FileEntry } from "../../services/filesystem";

export type SortKey = "name" | "size" | "modified";
export interface Sort {
  by: SortKey;
  direction: "asc" | "desc";
}
export const defaultSort: Sort = { by: "name", direction: "asc" };
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const byName = (a: FileEntry, b: FileEntry) =>
  collator.compare(a.name, b.name) ||
  (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** Folders always come first; ties fall back to name, then path, so rows never jump. */
export function sortEntries(entries: FileEntry[], sort: Sort) {
  const sign = sort.direction === "asc" ? 1 : -1;
  const value = (e: FileEntry) =>
    sort.by === "size" ? (e.size ?? -1) : (e.modified ?? -1);
  return [...entries].sort((a, b) => {
    const folders = Number(isDirectory(b)) - Number(isDirectory(a));
    if (folders) return folders;
    const primary =
      sort.by === "name" ? byName(a, b) : value(a) - value(b) || 0;
    return primary ? primary * sign : byName(a, b);
  });
}
/** Filters by name within the listed folder only; never searches subfolders. */
export function visibleEntries(
  entries: FileEntry[],
  filter: string,
  showHidden: boolean,
) {
  const query = filter.trim().toLocaleLowerCase();
  return entries.filter(
    (e) =>
      (showHidden || !e.hidden) &&
      (!query || e.name.toLocaleLowerCase().includes(query)),
  );
}
export function toggleSort(sort: Sort, by: SortKey): Sort {
  return sort.by === by
    ? { by, direction: sort.direction === "asc" ? "desc" : "asc" }
    : { by, direction: "asc" };
}

export interface History {
  back: string[];
  forward: string[];
}
/** A new location after Back discards the forward branch. */
export const visit = (h: History, from: string | null): History =>
  from ? { back: [...h.back, from], forward: [] } : h;
export function goBack(h: History, current: string) {
  const target = h.back[h.back.length - 1];
  return target === undefined
    ? null
    : {
        target,
        history: {
          back: h.back.slice(0, -1),
          forward: [current, ...h.forward],
        },
      };
}
export function goForward(h: History, current: string) {
  const [target, ...forward] = h.forward;
  return target === undefined
    ? null
    : { target, history: { back: [...h.back, current], forward } };
}

export interface Selection {
  paths: Set<string>;
  anchor: string | null;
  cursor: string | null;
}
export const emptySelection = (): Selection => ({
  paths: new Set(),
  anchor: null,
  cursor: null,
});
/** Click selects one, Ctrl toggles, Shift selects the range from the anchor in visible order. */
export function select(
  selection: Selection,
  order: string[],
  path: string,
  modifiers: { ctrl?: boolean; shift?: boolean },
): Selection {
  if (modifiers.shift && selection.anchor && order.includes(selection.anchor)) {
    const [a, b] = [order.indexOf(selection.anchor), order.indexOf(path)].sort(
      (x, y) => x - y,
    );
    const range = order.slice(a, b + 1);
    const paths = modifiers.ctrl
      ? new Set([...selection.paths, ...range])
      : new Set(range);
    return { paths, anchor: selection.anchor, cursor: path };
  }
  if (modifiers.ctrl) {
    const paths = new Set(selection.paths);
    if (paths.has(path)) paths.delete(path);
    else paths.add(path);
    return { paths, anchor: path, cursor: path };
  }
  return { paths: new Set([path]), anchor: path, cursor: path };
}
/** Keeps only selected paths that are still listed (after a refresh or filter change). */
export function retain(selection: Selection, order: string[]): Selection {
  const listed = new Set(order);
  const keep = (p: string | null) => (p && listed.has(p) ? p : null);
  return {
    paths: new Set([...selection.paths].filter((p) => listed.has(p))),
    anchor: keep(selection.anchor),
    cursor: keep(selection.cursor),
  };
}

const units = ["B", "KB", "MB", "GB", "TB"];
export function formatSize(bytes: number | null) {
  if (bytes === null) return "—";
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0
    ? `${value} B`
    : `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
const dates = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
export const formatDate = (ms: number | null) =>
  ms === null ? "" : dates.format(ms);

/** Path identity as the native side defines it: case-insensitive on Windows. */
export function samePath(a: string, b: string, separator: string) {
  return separator === "\\" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
/** True when `path` is `base` or lies below it (lexically). */
export function within(path: string, base: string, separator: string) {
  const prefix = base.endsWith(separator) ? base : base + separator;
  return (
    samePath(path, base, separator) ||
    samePath(path.slice(0, prefix.length), prefix, separator)
  );
}
/** True when `path` names an item directly inside `directory`, or the directory itself. */
export function affects(path: string, directory: string, separator: string) {
  if (samePath(path, directory, separator)) return true;
  const prefix = directory.endsWith(separator)
    ? directory
    : directory + separator;
  return (
    samePath(path.slice(0, prefix.length), prefix, separator) &&
    !path.slice(prefix.length).includes(separator)
  );
}
