import { pathKey } from "./paths";

/** A folder tree's entries and visible rows, shared by the IDE Explorer and the Text
 * Editor's folder sidebar. */

export interface Entry {
  path: string;
  name: string;
  directory: boolean;
}
export interface Row {
  entry: Entry;
  depth: number;
}
export function sortEntries(entries: Entry[]) {
  return [...entries].sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name),
  );
}
/** The visible rows of a tree whose expanded folders have loaded `children`. */
export function rows(
  root: string,
  expanded: { has(key: string): boolean },
  children: ReadonlyMap<string, Entry[]>,
): Row[] {
  const result: Row[] = [];
  const walk = (directory: string, depth: number) => {
    for (const entry of children.get(pathKey(directory)) ?? []) {
      result.push({ entry, depth });
      if (entry.directory && expanded.has(pathKey(entry.path)))
        walk(entry.path, depth + 1);
    }
  };
  walk(root, 0);
  return result;
}
