# 032: Explorer refresh, Text Editor syntax, panel motion, typed folders, deletes without a Recycle Bin

Status: accepted. The user reported that files a coding agent wrote did not show in the IDE
Explorer even after Refresh, asked for a syntax choice in the Text Editor's status bar as in
Sublime Text, smooth panel motion as in Hyprland, deletes on network shares, a project folder
typed in the palette instead of a system dialog, and files from the File Manager opening where
the text is rather than as tabs of the File Manager's panel.

## IDE Explorer refresh

Two faults kept new files out of the Explorer (`projects.ts`):

- **Collapse Folders** removed the root from the expanded folders and dropped its watch. The
  root's entries still showed (the tree always shows them), but neither the watcher nor
  Refresh reloaded them again. The root now stays expanded and watched; Refresh always lists
  the root and also starts its watch again.
- The watcher's 200 ms debounce kept only the last event's folders: a file written in one
  folder followed within 200 ms by a change elsewhere (Git's index, another file) was dropped.
  The folders now add up until the reload runs.

## Text Editor syntax

The status bar shows the document's language as a button, as Sublime Text's does; it and the
palette's **Text Editor: Select Syntax…** open a pick list: **Auto Detect** (the file name
decides), then every language CodeMirror knows, alphabetically, Plain Text first. The choice
is the document's, in the window's memory (`syntaxChoice.ts`), until the document is saved
under a name of a known type. `.jsonc` and `.json5` files are detected as JSON. The Code
Editor is not changed: its language follows the file and its language server.

## Panel motion

When the layout's structure changes (a panel added, split, moved, docked, minimized, maximized
or closed), every panel glides from its old place to its new one and a new panel grows in
(`useLayoutMotion` in `WorkspaceView.tsx`, 200 ms). It is a FLIP animation of the transform
only: the layout itself changes at once, so modules (terminals, editors) resize once, and
nothing waits for the animation. Splitter drags and window resizes are not animated (the
structure, not the ratios, is compared). While a tab is dragged, the drop preview glides
between halves and fades in. `prefers-reduced-motion: reduce` turns both off. A closed
panel disappears at once: animating its exit would keep a module mounted after its close.

## Typed folders

**Browse…** leads the palette's Open Project lists (Add to Workspace: IDE, and its new-window
form), and the IDE sidebar's and Text Editor's **Open Folder…** use the same browser
(`FolderBrowser.tsx`) instead of the system dialog, as VS Code's simple file dialog: the path
is typed, the typed folder's subfolders are listed (names starting with the text first, then
containing it), Tab or Enter goes into one, `~` is the home folder, `..` goes up, and Enter on
the first entry, **Open <folder>**, chooses it. It starts in the new terminals' start folder
(Workspace Settings; home when none is set). It only lists folders through the existing
`read_directory` command; nothing new reaches the renderer.

The user also asked that browsing inside Mozaik open the File Manager as a floating panel
instead of the system dialog. For folders the typed browser does that job. File dialogs stay
native for now: Open File and Save As go through dialogs whose chosen path is what Rust
accepts for drawings and diagrams (decisions 006, 008), so replacing them with a File Manager
panel needs its own decision about how Rust trusts a path picked in the renderer.

## Deletes without a Recycle Bin

Windows has no Recycle Bin on network shares (and some removable drives), and Mozaik refused
to delete there. Now a delete first asks Rust which items have none (`without_trash`, the same
`SHQueryRecycleBinW` check as before); if there are any, a confirmation says so and offers
**Delete permanently** (Cancel is the default). Only that answer deletes those items, through
the existing confirmed permanent delete; the others go to the Trash as before, and only those
can be undone. The IDE Explorer asks the same way. `trash_entries` still never deletes
permanently on its own.

## Files opened from the File Manager

A text file opened from the File Manager joins the last focused Text Editor panel, else any
Text Editor panel, else the Notes panel, else a new panel beside the File Manager, no longer a
tab of the File Manager's own panel.
