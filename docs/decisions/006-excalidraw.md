# 006 — Excalidraw (V0.5)

Specification: local `.plans/Tessera_v0.5_Excalidraw_Plan.md` (gitignored like earlier plans).

## Integration map

| Plan concept         | Implementation                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Module               | Fifth built-in `PluginDefinition` (`excalidraw`) in `src/plugins/registry.ts`, minimum 320×240      |
| Package              | `@excalidraw/excalidraw` **0.18.1**, pinned exactly (React 19 is a supported peer)                  |
| Drawing instance ID  | `Drawing.id` (UUID) in `src/plugins/excalidraw/drawings.ts`; also the tab and recovery ID           |
| File identity / path | `Drawing.path`: the canonical path returned by Rust; one drawing per path, checked across windows   |
| Scene state          | The live Excalidraw instance (`runtime.tsx`); `text`/`saved` hold its serialized `.excalidraw` JSON |
| Dirty/saving/error   | `dirty = text !== saved`, `saving`, `error`, `conflict` on the drawing                              |
| Recovery snapshot    | The existing recovery store with `kind: "drawing"`                                                  |
| Workspace placement  | Not restored (see below); Rust keeps the list of open drawing paths                                 |
| Native boundary      | `src-tauri/src/drawings.rs` through the typed adapter `src/services/drawings.ts`                    |
| File Manager / drops | `.excalidraw` opens in Mozaik; images dropped on a drawing go to Excalidraw's own drop at the point |

## Deliberate adaptations

- **Reopen on use, not at startup.** V0.1 `[KESİN]` forbids restoring a layout at startup and
  every window starts empty. As decided with the product owner, Rust remembers the drawing files
  that were open (`drawings.json` in the app data directory). The first time Excalidraw is opened
  from the launcher in a new session, those files reopen as tabs in that panel instead of a new
  `Untitled`; later launches create new drawings. Panel positions are not restored. A window
  closing while others stay open forgets its drawings; the last window keeps them. The list is
  only metadata: a damaged or newer `drawings.json` starts an empty list.
- **Unsaved drawings are recovered like documents.** An `Untitled` drawing (or a file-bound one
  whose save failed) is checkpointed every second while dirty. After a crash it appears in the
  existing recovery bar and comes back as a new unsaved drawing; it never writes to the original
  file. Discard (closing without saving) removes its snapshot, as for documents.
- **One theme.** Mozaik has a single dark theme (`color-scheme: dark`), so drawings use
  Excalidraw's dark theme; the prop is derived from the page's `color-scheme`, not a remount, and
  Excalidraw's own theme toggle is hidden because the theme is controlled.
- **File actions belong to Mozaik.** Excalidraw's own Open, Save and "Save to…" (JSON export)
  write through browser APIs without a known path, which would bypass file identity, revision
  checks and atomic replacement. They are turned off with `UIOptions.canvasActions` and replaced
  by **Open…**, **Save** and **Save as…** items in Excalidraw's own main menu (and **Open** on its
  welcome screen). Everything else in the menu, the toolbar, canvas and shortcuts is unchanged.
- **Exports keep Excalidraw's dialog.** `browser-fs-access`, which Excalidraw uses to save
  files, is aliased in `vite.config.ts` to `src/plugins/excalidraw/fs-access.ts`. Its `fileSave`
  sends the bytes to Rust, which shows a native save dialog and writes only `.png`, `.svg` or
  `.excalidrawlib` files atomically; it reports no file-handle support, so Excalidraw never writes
  back to a handle. The shim imports nothing from Mozaik (the dependency pre-bundle would get
  its own copy); the runtime registers the native save through a global symbol.
- **Offline.** Fonts are copied from the package into `/excalidraw/fonts` at build time and
  `EXCALIDRAW_ASSET_PATH` points there before Excalidraw loads (development serves them from
  `node_modules`). Web embeds are rejected (`validateEmbeddable` returns false) and web links on
  elements are not opened (a toast says so); element links still work. Excalidraw's library
  browser link leads to a web page and is inert. The CSP gains `connect-src 'self'` (fonts are
  fetched for SVG subsetting) and `img-src blob:`; nothing remote is allowed.

## Files and saving

- **Open**: `drawings_open` (dialog filtered to `.excalidraw`, or a path from the File Manager,
  an OS drop or the session list) reads through `files::read` (64 MiB limit, UTF-8, revision
  digest, canonical path) and requires JSON with `"type": "excalidraw"` and an `elements` array.
  Damaged or foreign files are reported and never written. If another window shows the file,
  that window is focused (event `focus-drawing`) and asked to activate the tab; in the same
  window the existing tab is activated without reloading.
- **Save**: `drawings_save` writes without a dialog only to a path registered to the calling
  window, so the renderer cannot write arbitrary paths. Save As shows a dialog filtered to
  `.excalidraw`; a missing extension is appended, refusing a name that then exists (the dialog's
  replace confirmation did not cover it). A target open in another drawing is refused. Writing
  reuses `files::save`: cooperative lock, revision check, same-directory temporary file, fsync,
  atomic rename. A revision mismatch returns a `conflict` result instead of an error.
- **Autosave** applies only to drawings bound to a file. The live scene is serialized
  (`serializeAsJSON(..., "local")`, which embeds referenced image files as data URLs) 300 ms after
  the persisted scene stops changing, never while a pointer is down. A file-bound dirty drawing
  saves 1 s after the last serialized change. Saves are queued per drawing, each carries the
  revision of the previous one, and a drawing stays dirty until a save of exactly that text
  succeeded. Changes that happen before the first user input (loading, font metrics) are not
  edits, so opening a file never rewrites it.
- **Failures**: a failed save keeps the drawing dirty and shows "Not saved" with Retry and Save
  As. A conflict stops autosave and shows Save As / Reload (Reload confirms before discarding
  edits). The disk watcher reloads a clean drawing whose file changed and marks a dirty one as
  conflicting; checks are skipped while a save of that drawing is in flight.
- **Closing**: the optional contract member `settle` lets pending autosaves finish first; then
  an unsaved drawing asks Save / Discard / Cancel. Save on an `Untitled` drawing opens Save As,
  and a cancelled Save As keeps the drawing open.

## Keyboard and focus

- Excalidraw keeps `handleKeyboardGlobally={false}`: its shortcuts act only while its container
  has focus, so hidden, unfocused or other modules' panels never receive them.
- Mozaik's capture-phase handler keeps Ctrl+N/W/,/Ctrl+Alt+N. In a drawing, Ctrl+O opens a
  drawing, Ctrl+S saves it (Save As when new) and Ctrl+Shift+S always asks for a destination.
  Ctrl+K stays Excalidraw's link shortcut while focus is inside Excalidraw; the launcher remains
  available from other panels. The workspace modifier still moves focus with arrows. Since V0.6
  Left Ctrl+K always stays with Excalidraw; since the seventh V0.7 review the launcher is
  Ctrl+Shift+I (Ctrl+Shift+' since the eleventh), also from a drawing, while Ctrl+Shift+P, Ctrl+Shift+, and Ctrl+Shift+E stay
  Excalidraw's there ([decision 007](007-workspace-shortcuts.md)).
- Each drawing renders in its own React root whose element is re-parented between views, so the
  scene, selection and undo history survive tab switches and panel moves (`api.refresh()` updates
  pointer offsets after a move).

## Drag and drop

Tauri's native drop handler receives OS file drops (HTML5 file drops would be intercepted).
Dropping `.excalidraw` files opens them; dropping images (png, jpeg, gif, webp, svg, bmp, ico,
avif) onto a drawing reads them through `drawings_read_image` and dispatches a synthetic `drop`
with those files at the pointer, so Excalidraw's own insertion and resizing apply; other files
open in the Text Editor as before. Excalidraw's internal HTML5 drags (for example dragging a
library item onto the canvas) may be blocked on Windows by the native drop handler; clicking a
library item still inserts it. Excalidraw's own image tool and paste work as in the browser.
