import { native } from "./native";

export interface Note {
  id: string;
  title: string;
  contentMarkdown: string;
  orderKey: number;
  createdAt: string;
  updatedAt: string;
}
export interface NotesDocument {
  schemaVersion: number;
  revision: number;
  notes: Note[];
  preferences: { selectedNoteId: string | null };
}
export type NotePatch = Partial<Pick<Note, "title" | "contentMarkdown">>;

/** Rust owns the notes file; every change resolves with the saved document. Mutable so
 * browser tests can substitute it. */
export const notesBackend = {
  snapshot: () => native<NotesDocument>("notes_snapshot"),
  create: (title: string) => native<NotesDocument>("notes_create", { title }),
  update: (id: string, patch: NotePatch) =>
    native<NotesDocument>("notes_update", { id, patch }),
  move: (id: string, before: string | null, after: string | null) =>
    native<NotesDocument>("notes_move", { id, before, after }),
  remove: (id: string) => native<NotesDocument>("notes_delete", { id }),
  select: (id: string) => native<NotesDocument>("notes_select", { id }),
  /** False when another window already shows the Notes panel; that window is focused. */
  claimPanel: () => native<boolean>("notes_claim_panel"),
  releasePanel: () => native<void>("notes_release_panel"),
};
/** Notes in display order. */
export const ordered = (document: NotesDocument) =>
  [...document.notes].sort(
    (a, b) => a.orderKey - b.orderKey || a.id.localeCompare(b.id),
  );
