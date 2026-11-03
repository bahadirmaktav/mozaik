# 025: Undo and Redo of file operations

Status: accepted (twentieth review). The user asked for Ctrl+Z and Ctrl+Y in the File Manager
and the IDE Explorer, as in Windows' File Explorer, and for a copy pasted into its own folder
to be added without a question.

## Decisions

- One history per window (`src/plugins/file-manager/history.ts`), shared by every File
  Manager and the IDE Explorer, as File Explorer shares one: **Ctrl+Z** undoes the last file
  operation of either, **Ctrl+Y** redoes it (`files.undo`/`files.redo`,
  `explorer.undo`/`explorer.redo`, rebindable). The right-click menu names what Undo and Redo
  would do. At most 50 operations are kept; a new operation clears Redo.
- Recorded: copies and moves (with each item's source and final path, from the transfer's
  report), renames, new files and folders, and moves to the Trash. Undo:
  - a copy or a new item goes to the **Trash**, never deleted permanently;
  - a moved item goes back to its folder under its former name, and a rename back to the old
    name, through the same no-replace placement as every move: when something has taken that
    place, that item fails and nothing is overwritten;
  - a trashed item is restored (`restore_from_trash`, the `trash` crate's restore on Windows
    and freedesktop Linux): the item most recently trashed from that path, only when the
    path is free.
- Redo repeats the operation; a name in use keeps both. Open tabs follow undone and redone
  moves and renames.
- Not recorded: a permanent delete, and a paste that **replaced** an item (its Undo could not
  bring the replaced item back from the Trash in place). Such a paste clears the history, so
  Undo never skips over it.
- Pasting items into **their own folder** adds a numbered copy (`name (2).ext`) without the
  conflict dialog, as Windows does ("- Copy"; Mozaik keeps its numbering). A name in use in
  another folder still asks Replace, Keep Both or Skip: nothing is replaced without a decision.
- The history lives in the renderer and ends with the window, as File Explorer's ends with
  its process.
