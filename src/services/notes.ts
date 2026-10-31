import { native, type FileData } from "./native";

/** A note: a Markdown file of the vault, named by its path relative to the vault. */
export interface NoteEntry {
  /** `/`-separated, relative to the vault, with the `.md` extension. */
  path: string;
  /** The file name without `.md`. */
  title: string;
  modified: number;
}
/** The vault folder's groups (subfolders) and notes, without content. */
export interface Vault {
  /** The vault folder; null until one is chosen. */
  root: string | null;
  groups: string[];
  notes: NoteEntry[];
  /** The vault was too large to list completely. */
  truncated: boolean;
}

/** Rust owns the vault (see `notes.rs`); every path is relative to it. Mutable so browser
 * tests can substitute it. */
export const notesBackend = {
  snapshot: () => native<Vault>("notes_snapshot"),
  read: (path: string) => native<FileData>("notes_read", { path }),
  /** Saves only while the file still has `revision`; resolves with the new revision. */
  write: (path: string, text: string, file: Omit<FileData, "text">) =>
    native<FileData>("notes_write", {
      path,
      text,
      revision: file.revision,
      bom: file.bom,
      ending: file.ending,
    }),
  /** Resolves with the new note's path. */
  create: (group: string, title: string) =>
    native<string>("notes_create", { group, title }),
  createGroup: (parent: string, name: string) =>
    native<string>("notes_create_group", { parent, name }),
  /** A note's new title or a group's new name; resolves with the new path. */
  rename: (path: string, name: string) =>
    native<string>("notes_rename", { path, name }),
  /** Into another group (`""` is the vault); resolves with the new path. */
  move: (path: string, group: string) =>
    native<string>("notes_move", { path, group }),
  /** To the Trash, a group with its notes. */
  trash: (path: string) => native<void>("notes_trash", { path }),
  /** False when another window already shows the Notes panel; that window is focused. */
  claimPanel: () => native<boolean>("notes_claim_panel"),
  releasePanel: () => native<void>("notes_release_panel"),
};

export const isNote = (path: string) => /\.md$/i.test(path);
/** The group a note or group is in; `""` is the vault. */
export const groupOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
export const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
/** Whether `path` is `group` or inside it. */
export const inGroup = (path: string, group: string) =>
  !group || path === group || path.startsWith(`${group}/`);
