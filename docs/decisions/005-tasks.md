# 005 — Tasks (V0.4)

Specification: local `.plans/Tessera_v0.4_Tasks_Plan.md` (gitignored like earlier plans).

## Integration map (phase 1)

| Plan concept        | Implementation                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Panel type          | Fourth built-in `PluginDefinition` (`tasks`) in `src/plugins/registry.ts`, minimum 260×200           |
| TasksPanel          | `src/plugins/tasks/Tasks.tsx`: list/detail navigation, dialogs; lazy chunk                           |
| TaskListView        | `ListScreen` in the same file: picker, sections, quick add, rows, drag and collapse state            |
| TaskDetailView      | `TaskDetail`: title, list, status, priority, Markdown Edit/Preview, Delete                           |
| Panel state         | `src/plugins/tasks/store.ts`: shared document, per-view screen and collapse state, unsaved drafts    |
| Pure logic          | `src/plugins/tasks/model.ts` (grouping, order anchors) and `markdown.ts` (safe Markdown tree)        |
| TasksService        | `src-tauri/src/tasks.rs` `Document` methods: every domain rule and validation                        |
| TasksJsonRepository | `src-tauri/src/tasks.rs` `Tasks`: load, repair, lock, atomic save                                    |
| IPC bridge          | `src/services/tasks.ts`; the view never calls commands directly                                      |
| Singleton           | `PanelOwner` in Rust plus two optional contract members, `claim` and `save` (see below)              |
| Menu                | The File Manager popup menu moved to `src/components/Menu.tsx`, shared by both plugins, not modified |

## Deliberate adaptations

- **No layout restoration, so no rehydration.** Mozaik never restores panels at startup
  (V0.1 `[KESİN]`), so duplicate Tasks panels cannot be rehydrated. "Reopen" means opening
  the panel again: it starts in list view with Todo/In Progress expanded and Done collapsed,
  while the selected list comes from `tasks.json`.
- **Singleton per process.** Rust records which window shows the Tasks panel. Opening Tasks
  in another window raises that window and asks it (event `focus-plugin`) to activate the
  panel; the owner is released when the tab closes or the window is destroyed. A second
  Mozaik _process_ has its own owner, so two processes can each show one panel. Both
  processes still write the same file safely (see storage).
- **No in-memory master copy.** Rust is authoritative, but it re-reads the file under the
  lock for every snapshot and mutation instead of caching it, so a second process can never
  be overwritten with stale data. The document is small; this is not a hot path.
- **No optimistic UI.** Drags, selects, list changes and new tasks are shown after the save
  succeeded. Every saved document carries a `revision`; older snapshots arriving late are
  ignored.
- **Ctrl+N is unchanged.** Tasks adds no Ctrl+N; the workspace Ctrl+N (new Text Editor tab)
  still works while Tasks is focused.

## Storage

- `tasks.json` in the Tauri app data directory (`%APPDATA%\<identifier>` on Windows,
  `~/.local/share/<identifier>` on Linux), next to the existing `recovery` folder. Fields:
  `schemaVersion` (1), `revision`, `lists`, `tasks`, `preferences.selectedListId`. Status is
  `todo | in_progress | done`; priority `low | medium | high`; no other task fields.
- **Missing** file: a fresh document with the Inbox; it is written on the first change.
  **Damaged** JSON, an unknown schema version, or duplicate list/task IDs: an error naming the
  file, and every mutation is refused, so it is never overwritten. A **newer** schema is
  reported as such. **Repairs** on load, written with the next change: the Inbox is recreated
  if missing (and is the only system list), a task whose list is missing is shown in the Inbox,
  and a stale selected list becomes All Lists.
- Each mutation: in-process mutex + cross-process `tasks.lock` (fs2), re-read, validate,
  increment `revision`, then `files::atomic_write` (same-directory temporary file, `fsync`,
  atomic rename, directory sync on Linux). A read-only file is refused up front. The command
  returns only after the rename, and the `tasks-changed` event carries the saved document.
- Interrupted saves leave the previous `tasks.json` intact; an orphaned temporary file
  (`.tmp*`) is ignored and not deleted automatically. No extra backup file is kept: the
  primary is never truncated in place, and a backup would need its own recovery rules.
- Order: one integer `orderKey` sequence per status across all lists, renumbered on every
  move. All Lists shows that order; a single list shows its subsequence. A move is sent as
  the neighbours visible in the dropped-on view (`before`/`after`), never as an index, so
  hidden tasks of other lists keep their places. A stale neighbour fails without a change.
  New tasks and status changes made in the details append at the end of the status.

## Validation

- List names: trimmed, 1–80 characters, no control characters, unique case-insensitively
  with Rust `to_lowercase` (not full Unicode case folding). "Inbox" and "All Lists" are
  reserved. The Inbox cannot be renamed or deleted.
- Titles: trimmed, 1–500 characters. Descriptions: up to 100,000 characters.
- Deleting a list moves its tasks to the Inbox and removes the list in one save; if it was
  selected, the selection becomes the Inbox.

## Editing and saving

- Title saves on Enter or blur; Escape reverts to the saved title; an empty title shows a
  validation message and is never sent. The description saves 600 ms after typing pauses and
  on blur. Text typed during a save stays a draft until a save of exactly that text succeeds.
- A failed save keeps the draft, shows "Not saved" with the error and a Retry button, and
  marks the tab modified. Back waits for pending saves and stays on the details if one fails.
  Closing the tab or the window with drafts asks Save / Discard / Cancel, like the editor;
  Save retries through the optional plugin `save` member.
- Edit and Preview are explicit buttons. A task opens in Preview when it has a description,
  otherwise in Edit; focus never switches the mode.

## Markdown preview

Parsed with `@lezer/markdown` (already installed through `@codemirror/lang-markdown`; now a
direct dependency, shared chunk with the editor) into a fixed set of elements: headings,
paragraphs, emphasis, strong, strikethrough, inline/fenced code, lists, task-list markers
(disabled checkboxes), block quotes, rules and breaks. Raw HTML is shown as text. Links and
images are inert text with the URL as a tooltip: the panel never navigates or loads anything.
No `dangerouslySetInnerHTML` is used.

## Interaction

- Rows: a drag handle, the title (full title as tooltip), the list name in All Lists, and
  the priority. Clicking or Enter opens the details in the panel. No context menu.
- Drag starts on the handle and follows window pointer events (HTML5 drag-and-drop would be
  intercepted by the native window drop handler). Since the tenth review a card follows the
  pointer and the row leaves the list, which opens a slot at the drop position. Targets are positions between rows of any section and the
  header of a collapsed section (append). Escape, pointer cancellation or a drop outside the
  sections changes nothing. The list never changes by dragging.
- Keyboard: Up/Down move between rows; Ctrl+Up/Down moves the focused task within its
  section (with Left Ctrl as workspace key, Ctrl+arrows stay spatial focus, as for the File
  Manager; see [decision 007](007-workspace-shortcuts.md)); Delete on a focused row asks for confirmation. Inputs, the Markdown editor and
  dialogs never receive these actions. Status changes without dragging use the details.
- In All Lists, quick add shows a list selector defaulting to the Inbox; a task never lacks
  a list. A selection with no tasks shows the empty sections (tenth review); tasks are added
  from a section header's `+`.
