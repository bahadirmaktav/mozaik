/**
 * Undo and Redo of file operations, as in Windows' File Explorer: one history for the whole
 * window, shared by every File Manager and the IDE Explorer (Ctrl+Z, Ctrl+Y). Copies, moves,
 * renames, new items and moves to the Trash are recorded; a permanent delete or a paste that
 * replaced an item is not, since Undo could not bring the item back. Undo never overwrites:
 * a copy or new item goes to the Trash, a move or rename goes back only where nothing has
 * taken its place, a trashed item is restored only to a free path.
 */
import { useSyncExternalStore } from "react";
import {
  fileSystem,
  type Failure,
  type Resolution,
  type TransferMode,
  type TransferReport,
} from "../../services/filesystem";
import { allDocuments, updateDocument } from "../text-editor/documents";
import {
  baseName,
  join,
  parent,
  pathKey,
  relative,
  within,
} from "../ide/paths";
import { refreshShowing } from "./instances";

export type FileAction =
  | {
      kind: "transfer";
      mode: TransferMode;
      destination: string;
      /** Each placed item: its source and where it is now. */
      pairs: { from: string; to: string }[];
    }
  | { kind: "rename"; from: string; to: string }
  | { kind: "create"; path: string; directory: boolean }
  | { kind: "trash"; paths: string[] };

const LIMIT = 50;
const done: FileAction[] = [];
const undone: FileAction[] = [];
let version = 0;
let busy = false;
const listeners = new Set<() => void>();
function emit() {
  version++;
  for (const listener of listeners) listener();
}
/** Called after Undo or Redo changed files, e.g. to re-read the IDE's tree. */
export function onFileHistory(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function useFileHistory() {
  useSyncExternalStore(onFileHistory, () => version);
  return {
    undo: done.length ? describe(done[done.length - 1]) : null,
    redo: undone.length ? describe(undone[undone.length - 1]) : null,
  };
}

/** Moves open documents along with a renamed or moved file or folder. */
export function followRename(from: string, to: string) {
  for (const doc of allDocuments()) {
    if (!doc.path || !within(from, doc.path)) continue;
    const rest = relative(from, doc.path);
    const path = rest ? join(to, rest) : to;
    updateDocument(doc.id, { path, name: baseName(path) });
  }
}

export function record(action: FileAction) {
  if (action.kind === "transfer" && !action.pairs.length) return;
  if (action.kind === "trash" && !action.paths.length) return;
  done.push(action);
  if (done.length > LIMIT) done.shift();
  undone.length = 0;
  emit();
}
/** Records a finished copy or move; one that replaced an item cannot be undone. */
export function recordTransfer(
  mode: TransferMode,
  destination: string,
  resolutions: Record<string, Resolution>,
  report: TransferReport,
) {
  if (Object.values(resolutions).includes("replace")) {
    // Undo would bring back the copy but not the replaced item: forget what came before.
    done.length = 0;
    undone.length = 0;
    return emit();
  }
  record({ kind: "transfer", mode, destination, pairs: pairsOf(report) });
}
function pairsOf(report: TransferReport) {
  return report.completed.map((to, i) => ({
    from: report.sources?.[i] ?? to,
    to,
  }));
}

function describe(action: FileAction) {
  const count = (n: number) => (n === 1 ? "" : ` ${n} items`);
  switch (action.kind) {
    case "transfer":
      return `${action.mode === "copy" ? "Copy" : "Move"}${count(action.pairs.length)}`;
    case "rename":
      return "Rename";
    case "create":
      return action.directory ? "New Folder" : "New File";
    case "trash":
      return `Delete${count(action.paths.length)}`;
  }
}
const failed = (list: Failure[]) =>
  list.map((f) => `${f.name}: ${f.error}`).join("\n");

/** Undoes the last file operation; resolves with what was undone, or null. */
export function undo() {
  return step(done, undone, reverse);
}
/** Does the last undone operation again; resolves with what was redone, or null. */
export function redo() {
  return step(undone, done, repeat);
}
async function step(
  from: FileAction[],
  to: FileAction[],
  run: (action: FileAction) => Promise<{ next: FileAction; error: string }>,
): Promise<string | null> {
  if (busy) return null;
  const action = from.pop();
  if (!action) return null;
  busy = true;
  try {
    const { next, error } = await run(action);
    to.push(next);
    if (error) throw new Error(error);
    return describe(action);
  } finally {
    busy = false;
    refreshShowing(folders(action));
    emit();
  }
}
function folders(action: FileAction): string[] {
  switch (action.kind) {
    case "transfer":
      return [
        action.destination,
        ...action.pairs.flatMap((p) => [parent(p.from), parent(p.to)]),
      ];
    case "rename":
      return [parent(action.from)];
    case "create":
      return [parent(action.path)];
    case "trash":
      return action.paths.map(parent);
  }
}

async function reverse(
  action: FileAction,
): Promise<{ next: FileAction; error: string }> {
  switch (action.kind) {
    case "transfer": {
      if (action.mode === "copy") {
        const error = failed(
          await fileSystem.trash(action.pairs.map((p) => p.to)),
        );
        return { next: action, error };
      }
      // Each item goes back to its folder under its former name.
      const errors: string[] = [];
      const back: { from: string; to: string }[] = [];
      for (const pair of action.pairs) {
        try {
          const home = parent(pair.from);
          const report = await fileSystem.transfer(
            {
              id: crypto.randomUUID(),
              sources: [pair.to],
              destination: home,
              mode: "move",
              resolutions: {},
            },
            () => {},
          );
          if (report.failed.length) throw new Error(failed(report.failed));
          let placed = report.completed[0];
          if (!placed) throw new Error(`${baseName(pair.to)} was not moved`);
          if (pathKey(baseName(placed)) !== pathKey(baseName(pair.from)))
            placed = (await fileSystem.rename(placed, baseName(pair.from)))
              .path;
          followRename(pair.to, placed);
          back.push(pair);
        } catch (e) {
          errors.push(String(e).replace(/^Error: /, ""));
        }
      }
      return { next: { ...action, pairs: back }, error: errors.join("\n") };
    }
    case "rename": {
      const entry = await fileSystem.rename(action.to, baseName(action.from));
      followRename(action.to, entry.path);
      return { next: action, error: "" };
    }
    case "create":
      return {
        next: action,
        error: failed(await fileSystem.trash([action.path])),
      };
    case "trash":
      return {
        next: action,
        error: failed(await fileSystem.restore(action.paths)),
      };
  }
}

async function repeat(
  action: FileAction,
): Promise<{ next: FileAction; error: string }> {
  switch (action.kind) {
    case "transfer": {
      // Never replaces: a name in use keeps both.
      const sources = action.pairs.map((p) => p.from);
      const report = await fileSystem.transfer(
        {
          id: crypto.randomUUID(),
          sources,
          destination: action.destination,
          mode: action.mode,
          resolutions: Object.fromEntries(
            sources.map((s) => [s, "keepBoth" as Resolution]),
          ),
        },
        () => {},
      );
      const pairs = pairsOf(report);
      if (action.mode === "move")
        for (const pair of pairs) followRename(pair.from, pair.to);
      return { next: { ...action, pairs }, error: failed(report.failed) };
    }
    case "rename": {
      const entry = await fileSystem.rename(action.from, baseName(action.to));
      followRename(action.from, entry.path);
      return { next: { ...action, to: entry.path }, error: "" };
    }
    case "create": {
      const entry = await fileSystem.create(
        parent(action.path),
        baseName(action.path),
        action.directory,
      );
      return { next: { ...action, path: entry.path }, error: "" };
    }
    case "trash":
      return {
        next: action,
        error: failed(await fileSystem.trash(action.paths)),
      };
  }
}
