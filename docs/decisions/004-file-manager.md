# 004 — File Manager (V0.3)

Specification: local `.plans/Tessera_v0.3_File_Manager_Plan.md` (gitignored like earlier plans).

## Integration map (phase 0)

The plan's illustrative names map onto the existing architecture; no second panel host,
persistence store or plugin loader was added.

| Plan concept         | Implementation                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Panel type           | Third built-in `PluginDefinition` (`file-manager`) in `src/plugins/registry.ts`, minimum 320×180          |
| Panel state          | `src/plugins/file-manager/instances.ts`, a store independent of views (like terminal sessions)            |
| Pure logic           | `src/plugins/file-manager/model.ts`: sort, filter, history, selection, path identity                      |
| FileSystemService    | `src-tauri/src/directory.rs`: listing, path resolution, create, rename, open, hidden-files preference     |
| FileOperationService | `src-tauri/src/operations.rs`: plan, copy/move with conflicts, Trash, permanent delete, cancellation      |
| FileWatcherService   | `src-tauri/src/watching.rs`: the existing reference-counted watcher, now also keyed by File Manager views |
| PinRegistry          | `src-tauri/src/pins.rs` + `src/services/pins.ts` (list/add/remove/reorder/subscribe), no panel dependency |
| Typed IPC bridge     | `src/services/filesystem.ts`; panels never call the commands directly                                     |

## Deliberate deviations from the plan

- **No restart restoration.** The plan asks to restore panel location and sort "with the
  existing layout persistence". Tessera has none by a V0.1 `[KESİN]` invariant: every launch
  and window starts empty. The plan's restoration therefore applies to what Tessera has:
  a File Manager keeps location, history, sort, filter and selection across tab switches,
  panel moves and view remounts, and every _new_ panel opens in home. When the displayed
  folder disappears, the next refresh shows the nearest existing ancestor (or home) with a
  notice — the plan's "missing folder" fallback.
- **Alt+Left/Right/Up.** With the default workspace modifier (Alt), Alt+arrows stay spatial
  panel focus, as for the Terminal. Back/Forward/Up remain available through the toolbar,
  mouse back/forward buttons, Backspace (Up), and Alt+arrows when another modifier is chosen.
- **Program files are not launched.** Opening runs the OS default handler, which for
  executables and scripts (`.exe`, `.bat`, `.ps1`, `.lnk`, `.desktop`, `.sh`, `.AppImage`, …)
  would run a program. Tessera only executes programs in an interactive Terminal, so these
  are refused with an explanation.

## Paths

- The renderer sends UTF-8 strings. Rust accepts only absolute paths (plus `~` and a bare
  Windows drive like `D:`), and normalizes `.`/`..` **lexically**. Links are not resolved, so
  a folder reached through a link keeps the path the user chose (like a shell's logical `cd`).
- Names that are not valid Unicode (non-UTF-8 Linux names, unpaired UTF-16 surrogates on
  Windows) are listed lossily and flagged `unsupported`; every action on them is disabled,
  because the lossy string would name a different or nonexistent file. No reversible byte
  encoding was added for V0.3.
- Identity is case-insensitive on Windows and exact elsewhere, for pins, conflicts and
  watcher events. Windows directories that are case-sensitive are not special-cased.
- Hidden: dot-prefix on Linux, `FILE_ATTRIBUTE_HIDDEN` on Windows. Hidden entries are off
  by default; the toggle is global, persisted in `file-manager.json` and broadcast to windows.

## Listing and view

- One non-recursive `read_dir` per folder. Directory size is never computed. Links report
  their target's size/date; a loop or missing target is a broken link, not an error.
  Unreadable entries are counted, not fatal.
- Rows have a fixed height of 26 px and only visible rows (plus 8 above/below) are mounted;
  no frontend dependency was added for virtualization.
- Sort: folders (including links to folders) first in every order; name uses a numeric,
  case-insensitive collator; ties fall back to name and then path. The filter is a substring
  match on names in the current listing, cleared when the folder changes.
- Every request gets a token; only the latest is applied. A refresh arriving during a
  navigation waits for it instead of overriding it.

## Operations

- Conflicts use **plan → decisions → execute**. `plan_transfer` validates the destination
  (exists, is a folder, writable via a probe file), sources, and cycles (lexically and via
  canonical paths), then returns conflicts. The user picks Replace / Keep Both / Skip per
  conflict, optionally for the rest. `transfer_entries` re-checks everything: a conflict
  that appears later without a decision fails that item; nothing is replaced implicitly.
- Every item is first staged in the destination as `.tessera-<uuid>.partial` (a rename for
  same-volume moves, a copy otherwise) and placed with a **no-replace rename**
  (`MoveFileExW` without `REPLACE_EXISTING`; `renameat2(RENAME_NOREPLACE)` with a
  check-then-rename fallback on Linux file systems that lack it). A failed copy removes the
  staging item; a failed same-volume move renames it back.
- **Replace** sends the existing item to the Trash first, then places the new one. If the
  Trash refuses, nothing is replaced. Replacing an item with itself is not offered.
- **Cross-volume move**: copy to staging, place, then remove the source. A failed source
  removal is reported; both copies remain.
- **Keep Both** picks "name (2).ext", continuing an existing "(n)" series.
- Copies never follow links: links are recreated (on Windows this needs Developer Mode or
  elevation, otherwise that item fails), special files are refused. Permissions are kept;
  file modification times are restored where `std` allows. Owners, ACLs, extended
  attributes and alternate data streams are not promised.
- Progress is reported per file (throttled to 10/s) over a Tauri channel. Cancellation is
  checked between files: the current item's staging is removed, finished items stay.
- **Trash** uses the `trash` crate. Windows first queries `SHQueryRecycleBinW` for the
  drive and refuses where no Recycle Bin exists, because Windows would otherwise delete
  permanently. Linux follows the freedesktop spec; when the per-volume trash is unusable the
  crate copies into the home Trash. Tessera never falls back to permanent deletion.
- **Permanent delete** is a separate action (Shift+Delete or overflow menu) with a
  confirmation whose default button is Cancel; the command also requires `confirmed`.
- Roots, the home folder, its ancestors and well-known system folders are refused for
  Trash, permanent delete, move and rename.
- The cut/copy clipboard is Tessera-internal and shared by File Managers in one window. It
  does not read or write the OS clipboard.

## Watchers

The existing `Watches` map now keys File Manager views next to documents. A view watches
its displayed folder only while it is mounted, and releases it on navigation, unmount, tab
close and window destruction. `disk-change` events carry paths; a view refreshes when a path
is the folder or directly inside it, coalesced at 150 ms with at least one refresh per
second during bursts. Rescan events carry no paths and refresh every view. Watch failures
show a status message; F5 and the overflow menu always refresh manually.

## Pins

`pins.json` in the app config directory, written atomically under an in-process mutex and a
cross-process `pins.lock`. A damaged file is reported and left untouched. Pins are kept in
user order with an ID, path and the kind at pin time; missing targets stay listed as
"Missing" until unpinned. A `pins-changed` event updates all windows; another process is
picked up on window focus. Paths are not logged.

## Opening files

`open::that_detached` with the `shellexecute-on-windows` feature: `ShellExecuteExW` on
Windows, `xdg-open`/`gio`/KDE launchers with argument vectors on Linux. No shell parses the
path. Folders open inside the panel instead.

## Drag and drop

Pointer events with capture, as for workspace tabs; HTML5 drag-and-drop would be
intercepted by the native window drop handler. Rows and breadcrumb segments of any File
Manager in the same window are targets. Dropping onto a selected item, a descendant of a
dragged folder, or the items' own folder is shown as invalid; the native plan rejects
cycles again. No OS or cross-module drag integration.

## Dependencies

| Crate         | Version | Reason                                                                     |
| ------------- | ------- | -------------------------------------------------------------------------- |
| `trash`       | 5.2.9   | Recycle Bin / freedesktop Trash; default features write `DeletionDate`     |
| `open`        | 5.4.5   | Default-app launch; `shellexecute-on-windows` avoids a PowerShell launcher |
| `windows-sys` | 0.61    | Already in the lock file; `MoveFileExW`, `SHQueryRecycleBinW`, attributes  |

`notify`, `tempfile`, `fs2`, `uuid` and `libc` were already dependencies.
