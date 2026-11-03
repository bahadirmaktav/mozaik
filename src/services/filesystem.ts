import { Channel, isTauri } from "@tauri-apps/api/core";
import { native } from "./native";

export type FileKind = "file" | "directory" | "symlink" | "other";
export interface FileEntry {
  path: string;
  name: string;
  kind: FileKind;
  targetKind: "file" | "directory" | "unknown" | null;
  hidden: boolean;
  size: number | null;
  /** Milliseconds since the Unix epoch. */
  modified: number | null;
  broken: boolean;
  /** The OS name is not valid Unicode: shown, but never operated on. */
  unsupported: boolean;
}
export interface Listing {
  directory: string;
  parent: string | null;
  crumbs: { name: string; path: string }[];
  separator: string;
  entries: FileEntry[];
  unreadable: number;
  fallbackFrom: string | null;
}
/** A drive (Windows) or mounted file system (Linux) of the This PC page. */
export interface Drive {
  path: string;
  name: string;
  kind: "fixed" | "removable" | "network" | "optical" | "other";
  total: number | null;
  free: number | null;
}
/** Search results as they are found; the last batch has `done`. */
export interface SearchBatch {
  entries: FileEntry[];
  done: boolean;
  /** More names matched than the search lists. */
  truncated: boolean;
}
export type TransferMode = "copy" | "move";
export type Resolution = "replace" | "keepBoth" | "skip";
export interface Conflict {
  source: string;
  target: string;
  name: string;
  sourceDirectory: boolean;
  targetDirectory: boolean;
  same: boolean;
}
export interface Failure {
  name: string;
  error: string;
}
export interface TransferReport {
  completed: string[];
  /** The source of each completed item, in the same order. */
  sources: string[];
  skipped: number;
  failed: Failure[];
  cancelled: boolean;
}
export interface TransferProgress {
  files: number;
  current: string;
}
export interface TransferRequest {
  id: string;
  sources: string[];
  destination: string;
  mode: TransferMode;
  resolutions: Record<string, Resolution>;
}

export const isDirectory = (entry: FileEntry) =>
  entry.kind === "directory" ||
  (entry.kind === "symlink" && entry.targetKind === "directory");

/**
 * Typed adapter for the native filesystem services. It is a mutable object so browser
 * tests can substitute a fake; panels must not call the IPC commands directly.
 */
export const fileSystem = {
  /** `null` lists the home directory. With `fallback`, a vanished folder shows its nearest ancestor. */
  list: (path: string | null, fallback = false) =>
    native<Listing>("read_directory", { path, fallback }),
  watch: (id: string, path: string | null) =>
    native<void>("watch_directory", { id, path }),
  create: (parent: string, name: string, directory: boolean) =>
    native<FileEntry>("create_entry", { parent, name, directory }),
  rename: (path: string, name: string) =>
    native<FileEntry>("rename_entry", { path, name }),
  open: (path: string) => native<void>("open_entry", { path }),
  plan: (sources: string[], destination: string, mode: TransferMode) =>
    native<{ conflicts: Conflict[] }>("plan_transfer", {
      sources,
      destination,
      mode,
    }),
  transfer(
    request: TransferRequest,
    onProgress: (progress: TransferProgress) => void,
  ) {
    if (!isTauri()) return native<TransferReport>("transfer_entries");
    const progress = new Channel<TransferProgress>();
    progress.onmessage = onProgress;
    return native<TransferReport>("transfer_entries", { request, progress });
  },
  cancel: (id: string) => native<void>("cancel_operation", { id }),
  trash: (paths: string[]) => native<Failure[]>("trash_entries", { paths }),
  /** Undo of `trash`: puts back what was trashed from each path, never replacing. */
  restore: (paths: string[]) =>
    native<Failure[]>("restore_from_trash", { paths }),
  deletePermanently: (paths: string[]) =>
    native<Failure[]>("delete_permanently", { paths, confirmed: true }),
  /** The drives or mount points of the This PC page. */
  drives: () => native<Drive[]>("list_drives"),
  /**
   * Names under `root` (and its subfolders) containing `query`, or matching it with `*` and
   * `?`; batches arrive through `onBatch`. A newer search of the same `id` cancels this one.
   */
  search(
    id: string,
    root: string,
    query: string,
    showHidden: boolean,
    onBatch: (batch: SearchBatch) => void,
  ) {
    if (!isTauri()) return native<void>("search_directory");
    const results = new Channel<SearchBatch>();
    results.onmessage = onBatch;
    return native<void>("search_directory", {
      id,
      root,
      query,
      showHidden,
      results,
    });
  },
  cancelSearch: (id: string) => native<void>("cancel_search", { id }),
  settings: () => native<{ showHidden: boolean }>("file_manager_settings"),
  setShowHidden: (show: boolean) => native<void>("set_show_hidden", { show }),
};
