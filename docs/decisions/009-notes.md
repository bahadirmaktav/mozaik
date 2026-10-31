# 009 — Notes (V0.6, notes folder in the twelfth review)

Specification: local `.plans/Tessera_v0.6_Plan.md`, section 4. The twelfth review replaced
the original store (one `notes.json` in app data) with a folder of Markdown files. The
thirteenth review dropped the word "vault" and the comparison with other note apps: Mozaik
shows the notes of a folder the user chooses and adds nothing of another application.

## Model

- The user chooses a **notes folder** in Workspace Settings → Tasks and Notes, or
  from the Notes panel while none is chosen. It is the `notesFolder` preference
  (`preferences.rs`), an absolute path.
- A **note** is a `.md` file of the notes folder; its file name without `.md` is its title and its text
  is the Markdown content. A **group** is a subfolder, and groups nest. Entries whose name
  starts with a dot (such as `.git` or `.trash`) and other files are not shown. Links are
  not followed.
- There is no `notes.json`, schema, seed note, manual order or saved selection any more:
  the files are the data. Groups come first, then notes, both by name. The old `notes.json`
  is not read or migrated (the user chose to drop it); it stays where it was.

## Storage (`notes.rs`)

- The renderer names notes and groups by their path relative to the notes folder, `/`-separated.
  Every command reads the notes folder from the preferences again and resolves the path component
  by component (valid names, no dot entries, no `..`); a note's canonical file must stay
  inside the folder.
- Reading and saving use the text document rules (`files.rs`): UTF-8 with or without BOM,
  LF/CRLF kept, binary or mixed line endings refused, a save only while the file still has
  the revision that was read, under the cooperating-writer lock, through an atomic replace.
- Creating, renaming and moving never replace an existing name (`create_new`,
  `rename_no_replace`); a change of case only is a plain rename. A group cannot move into
  itself.
- Removal moves a note, or a group with everything in it, to the Trash (never a permanent
  delete), after the panel asked.
- The scan stops at 16 levels and 20,000 entries and then says the folder is not listed
  completely.

## Panel

- One Notes panel per application, like Tasks: opening it again focuses the existing panel
  (also in another window).
- The tree beside the page lists groups and notes; a group opens with a click, Right/Left or
  Enter. **+ Note** and **+ Group** create in the selected group (the group of the selected
  note; a click on the free space selects the folder's top). The right-click menu offers New
  Note, New Group (on groups), Rename and Move to Trash; F2 and Delete do the same on a
  focused row. Below 460 px of width the tree stacks above the page.
- The page has the title (Enter or blur renames the file, Escape reverts), a **Group** select
  that moves the note, Edit / Preview and Move to Trash. A note opens in Preview when it has
  text and in Edit when empty; the choice is kept per note for the session. Preview is the
  safe Markdown renderer shared with Tasks.

## Autosave and safety

- Content saves 500 ms after typing pauses and on blur. A draft is shown until a save of
  exactly that text succeeds, so typing during a save stays pending.
- If the file changed on disk, the save is refused and the page offers **Reload from Disk**
  (drop the unsaved text) or **Overwrite** (write it over the file); nothing is overwritten
  without that choice.
- The folder and its groups are watched; another program's changes list again and reload notes
  without unsaved text. Renaming or moving saves unsaved text first.
- Closing the panel or the window waits for pending saves (`settle`); only a failed save
  leads to the Save / Discard / Cancel question.

## Not verified

Browser tests use an in-memory notes folder. The native dialog, real files and watcher, Trash,
case-only renames on Windows and the cross-window panel claim have not been exercised in the
desktop app ([VALIDATION](../VALIDATION.md)).
