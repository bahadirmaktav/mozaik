# 009 — Notes (V0.6)

Specification: local `.plans/Tessera_v0.6_Plan.md`, section 4.

## Model

- Each note is one independent long Markdown page: `id`, `title`, `contentMarkdown`,
  `orderKey`, `createdAt`, `updatedAt`. There are no folders, categories, sub-notes, tags or
  embedded cards.
- The document (`notes.json` in the app data directory) is
  `{ schemaVersion: 1, revision, notes, preferences: { selectedNoteId } }`.

## Storage

The plan asks to reuse an existing local database if there is one. Tessera's existing local
store is the Tasks pattern ([decision 005](005-tasks.md)): one versioned JSON document owned
by Rust. Notes uses the same rules instead of adding SQLite:

- Every change runs under an in-process gate and the `notes.lock` cross-process lock,
  re-reads the file, validates, increments `revision` and is reported only after an atomic
  same-directory replace. Other windows receive `notes-changed`; another process is picked up
  when the window gains focus.
- **Seed**: a missing file is the first run and yields one empty `QuickNotes` with the fixed ID
  `quick-notes`. Until the file is first written every read returns that same note, so edits
  reach it; once the file exists nothing is seeded again, even if QuickNotes was deleted.
- **Versioning**: `schemaVersion` is checked on load. A newer schema or a damaged file is
  reported with its path and never replaced; later schema changes migrate on load.
- Limits: titles 1–120 characters without control characters; content up to 5,000,000
  characters.

Whole-document rewrites are fine for personal notes; a much larger store would need another
format, which is out of scope.

## Panel

- One Notes panel per application, like Tasks: opening it again focuses the existing panel
  (also in another window). The single-panel owner moved from `tasks.rs` to `panels.rs` and is
  shared.
- A list of notes beside the selected page; below 460 px of width the list stacks above the
  page. **+ New note** asks for a title. Notes are reordered by dragging the handle or with
  Ctrl+Up/Down on a focused row; the order is persistent. Delete (button or the Delete key on
  a row) asks for confirmation and states that it cannot be undone.
- **Edit** and **Preview** are explicit buttons; clicking the preview never starts editing. A
  note opens in Preview when it has content and in Edit when empty; the choice is kept per
  note for the session. Edit is a plain textarea (comfortable for long text, no extra editor
  state). Preview reuses the safe Markdown renderer now shared with Tasks
  (`src/components/Markdown.tsx`): a fixed set of elements, raw HTML shown as text, links
  shown but never navigated, images never loaded.

## Autosave and safety

- Content saves 500 ms after typing pauses and on blur; titles save on Enter or blur (Escape
  reverts). A draft is shown until a save of exactly that text succeeds, so typing during a
  save stays pending and failures show "Not saved" with Retry.
- Switching notes changes the selection immediately and saves the choice in the background;
  without this, typing right after a click during a slow save went into the previous note
  (found by the browser test of fast switching).
- Closing the panel or the window waits for pending saves (`settle`); only a failed save
  leads to the Save / Discard / Cancel question.
- A crash can lose at most the last half second of typing. Notes are never sent anywhere.

## Not verified

The native file, the cross-process lock, `notes-changed` between windows, restart and crash
behavior, and IME/clipboard in the textarea ([VALIDATION](../VALIDATION.md#v06-qualification)).
