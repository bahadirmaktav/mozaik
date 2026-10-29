import type { GitState } from "../../services/ide";
import { parent, pathKey, within } from "./paths";

/** Pure IDE logic: explorer rows, Git decorations, quick open ranking, location history
 * and LSP text edits. No DOM, IPC or editor state. */

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

// A folder takes the color of its most important change, as in VS Code.
const WEIGHT: Record<GitState, number> = { C: 6, M: 5, R: 4, D: 3, A: 2, U: 1 };
export interface Decoration {
  status: GitState;
  /** A folder holding changed files, not a change itself. */
  folder: boolean;
}
/** Changed files by key, plus every folder above them (shown as containing changes). */
export function decorations(
  root: string,
  changes: { path: string; status: GitState }[],
) {
  const files = new Map<string, GitState>();
  const folders = new Map<string, GitState>();
  for (const change of changes) {
    files.set(pathKey(change.path), change.status);
    let directory = parent(change.path);
    while (within(root, directory)) {
      const key = pathKey(directory);
      const known = folders.get(key);
      if (known && WEIGHT[known] >= WEIGHT[change.status]) break;
      folders.set(key, change.status);
      if (key === pathKey(root)) break;
      directory = parent(directory);
    }
  }
  /** A file inside an untracked folder is untracked too. */
  function state(path: string): Decoration | undefined {
    const own = files.get(pathKey(path));
    if (own) return { status: own, folder: false };
    let directory = parent(path);
    while (within(root, directory)) {
      if (files.get(pathKey(directory)) === "U")
        return { status: "U", folder: false };
      if (pathKey(directory) === pathKey(root)) break;
      directory = parent(directory);
    }
    const folder = folders.get(pathKey(path));
    return folder ? { status: folder, folder: true } : undefined;
  }
  return state;
}
/** Whether Git ignores a path: it or a folder above it is in `ignored`. */
export function ignoredBy(root: string, ignored: string[]) {
  const keys = new Set(ignored.map(pathKey));
  return (path: string) => {
    for (
      let current = path;
      within(root, current) && pathKey(current) !== pathKey(root);
      current = parent(current)
    )
      if (keys.has(pathKey(current))) return true;
    return false;
  };
}

/** Subsequence match favouring the file name, word starts and runs; `null` if no match. */
export function score(query: string, candidate: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const c = candidate.toLowerCase();
  const nameStart = candidate.lastIndexOf("/") + 1;
  let total = 0,
    previous = -2,
    index = -1;
  for (const char of q) {
    index = c.indexOf(char, index + 1);
    if (index < 0) return null;
    const boundary = index === 0 || "/._- ".includes(c[index - 1]);
    total +=
      1 +
      (index === previous + 1 ? 3 : 0) +
      (boundary ? 2 : 0) +
      (index >= nameStart ? 2 : 0);
    previous = index;
  }
  // Prefer shorter paths when the match quality is equal.
  return total - candidate.length / 1000;
}
export function rank(query: string, files: string[], limit = 50) {
  return files
    .map((file) => ({ file, score: score(query, file) }))
    .filter((r): r is { file: string; score: number } => r.score !== null)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, limit)
    .map((r) => r.file);
}

/** A visited code location: a file and an editor offset. */
export interface Place {
  path: string;
  pos: number;
}
export interface Trail {
  back: Place[];
  forward: Place[];
}
const LIMIT = 50;
export const emptyTrail = (): Trail => ({ back: [], forward: [] });
const same = (a: Place | undefined, b: Place) =>
  !!a && pathKey(a.path) === pathKey(b.path) && a.pos === b.pos;
/** Records where a jump started; a new jump clears the forward list. */
export function visit(trail: Trail, from: Place): Trail {
  if (same(trail.back[trail.back.length - 1], from))
    return { ...trail, forward: [] };
  return { back: [...trail.back, from].slice(-LIMIT), forward: [] };
}
export function goBack(trail: Trail, current: Place | null) {
  const target = trail.back[trail.back.length - 1];
  if (!target) return null;
  return {
    target,
    trail: {
      back: trail.back.slice(0, -1),
      forward: current ? [current, ...trail.forward] : trail.forward,
    },
  };
}
export function goForward(trail: Trail, current: Place | null) {
  const [target, ...forward] = trail.forward;
  if (!target) return null;
  return {
    target,
    trail: {
      back: current ? [...trail.back, current].slice(-LIMIT) : trail.back,
      forward,
    },
  };
}

export interface LspPosition {
  line: number;
  character: number;
}
export interface TextEdit {
  range: { start: LspPosition; end: LspPosition };
  newText: string;
}
/** An LSP position (UTF-16 columns) as an offset in `text`, clamped to the line. */
export function offsetAt(text: string, position: LspPosition) {
  let offset = 0;
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return text.length;
    offset = next + 1;
  }
  const end = text.indexOf("\n", offset);
  return Math.min(offset + position.character, end < 0 ? text.length : end);
}
/** Offsets of the edits in `text`, last first, so applying them in order keeps offsets valid. */
export function resolveEdits(text: string, edits: TextEdit[]) {
  const resolved = edits
    .map((edit, index) => ({
      from: offsetAt(text, edit.range.start),
      to: offsetAt(text, edit.range.end),
      insert: edit.newText.replace(/\r\n?/g, "\n"),
      index,
    }))
    .sort((a, b) => a.from - b.from || a.index - b.index);
  for (let i = 1; i < resolved.length; i++)
    if (resolved[i].from < resolved[i - 1].to)
      throw new Error("The language server sent overlapping edits");
  return resolved.map(({ from, to, insert }) => ({ from, to, insert }));
}
export function applyEdits(text: string, edits: TextEdit[]) {
  let result = text;
  for (const edit of resolveEdits(text, edits).reverse())
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  return result;
}
export interface WorkspaceEdit {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: (
    | { textDocument: { uri: string }; edits: TextEdit[] }
    | { kind: string; uri?: string; oldUri?: string }
  )[];
}
/** Text edits per file. Creating, renaming or deleting files is refused as a whole. */
export function fileEdits(edit: WorkspaceEdit) {
  const result = new Map<string, TextEdit[]>();
  const add = (uri: string, edits: TextEdit[]) =>
    edits.length && result.set(uri, [...(result.get(uri) ?? []), ...edits]);
  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ("kind" in change)
        throw new Error(
          "This change would create, rename or delete files, which Tessera does not apply.",
        );
      add(change.textDocument.uri, change.edits);
    }
  } else
    for (const [uri, edits] of Object.entries(edit.changes ?? {}))
      add(uri, edits);
  return result;
}
