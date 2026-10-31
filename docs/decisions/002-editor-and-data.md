# 002 — Editor, interaction and data decisions

## CodeMirror 6

Select CodeMirror over Monaco: the V0.1 surface is text editing, not an IDE. It supports
independent EditorState / EditorView lifetimes and individually selectable extensions,
without a worker/language-service setup. No search UI, regex, multicursor or LSP was enabled;
since the tenth review the Text Editor shares the Code Editor's editing shortcuts (multiple
cursors) and Find / Replace, still without LSP ([decision 016](016-tabs-and-editors.md)).
This is a scope-based choice, not a claim that Monaco is always slower.

The editor view and its bundled language parsers are dynamically imported on first use.
Hidden tabs retain immutable document/undo/selection state but destroy their EditorView.
Closing a document clears its state and syntax compartment; native directory watchers
are reference-counted by document and window and released on close.

### Measured large-document policy

`node scripts/benchmark-editor.mjs`, Windows x64, Node 24.14.1, 2026-10-29.
Repeated JavaScript declarations; one run, cold/warm effects not controlled. The parser
was explicitly asked to parse the entire document with a 500 ms measurement budget.
This is **not** a WebView2/WebKitGTK render or memory benchmark.

| Text size | State with syntax (ms) | Full parse attempt (ms) | Parsed all | Plain state (ms) |
| --------- | ---------------------: | ----------------------: | ---------- | ---------------: |
| 64 KiB    |                  12.39 |                   49.69 | Yes        |             0.30 |
| 1 MiB     |                   7.48 |                  500.92 | No         |             1.81 |
| 4 MiB     |                  13.73 |                  503.87 | No         |             3.78 |

At 1,048,576 UTF-16 code units, omit syntax parsing/highlighting and display a small
notice. Once a visible view enters lightweight mode, it stays there until remounted.
This provisional threshold follows the measured step-up; re-measure on both target
webviews. CodeMirror still virtualizes visible lines and retains undo. Files over 64 MiB
are rejected before unbounded allocation: this is a safety ceiling, not a performance SLA.

## Interaction

- Alt is held, not toggled; alternatives are Control and Shift. Settings take effect in
  the current window immediately and are persisted for future windows. AltGraph is excluded.
  V0.6 replaces this with a physical workspace key, Right Ctrl by default
  ([decision 007](007-workspace-shortcuts.md)).
- Panel grip drag requires the modifier at start; captured pointer drag continues after
  modifier release. Tabs can always be dragged. Five CSS pixels distinguish drag from click.
- Outer 20% of a panel are edge targets (left/right priority at corners); middle is center.
  Dropping onto a tab header means insertion/reordering, not a top edge split.
- Native files open as tabs in the panel under the physical-pixel drop position (converted
  using window scale factor), otherwise in the focused panel. Empty workspace gets a panel.
- Ctrl+K launcher (Right Ctrl+K since V0.6), Ctrl+N tab, Ctrl+Shift+N auto split, Ctrl+O open, Ctrl+S save,
  Ctrl+Shift+S save as, Ctrl+W close, Ctrl+G go to line. Splitters are keyboard accessible.
- Ctrl+, opens settings and Ctrl+Alt+N creates an independent window. Workspace actions are
  shortcut-driven. Since the fifth V0.7 review there is no title bar, only a drag strip; the
  logo is in the status line and the window closes with the workspace key+E
  ([decision 007](007-workspace-shortcuts.md#behavior)).

## Floating panels

Added in the eighth V0.7 review at the user's request. A floating panel is an ordinary panel
(tabs, focus, close, maximize) that lies over the split tree instead of in it:
`Workspace.floating` holds each with its rectangle in workspace pixels, later ones in front.

- It opens from the launcher or a palette Add command with Ctrl+Shift+Enter: centered, half
  the area wide and 60 % high (never below the tool's minimum), each next one 24 px further
  down and right. **Float Panel** takes the focused tiled panel out of the tree at its size;
  **Dock Panel** or its header's dock button splits the largest tiled panel with it.
- It moves by dragging its grip or empty header space (no Ctrl+Shift) and resizes at its
  edges and corners, never below the tool's minimum; the header stays reachable inside the
  workspace area. Focusing it brings it to the front (elements keep a stable DOM order, so
  terminals, editors and drawings are not re-parented by a click).
- Tabs dragged onto it join it (it has no edge targets); its tabs drag out to the tree like
  any tab. Whole tiled panels swap only with tiled panels. Right Ctrl+arrows reach floating
  panels by their rectangles. A new split while a floating panel has focus goes into the
  tree; a new tab joins the floating panel.
- Docked tools (IDE sidebar, bottom panel, status bar) never float; asking for one floats
  nothing and splits instead. Layouts are still never restored.

## Text Editor display

- **Word wrap** (eighth review, on by default; Settings → Text Editor): long lines wrap at the
  panel's width and the wrapped rows start under the line's indentation, as in Sublime Text
  (a line decoration with `padding-left` and a negative `text-indent` of the indentation's
  columns, for visible lines only). The gutter numbers each line once. Stored as `wordWrap`
  in `preferences.json`.
- The Text Editor has its own status bar under the text: Ln/Col, line ending, encoding
  (BOM) and Modified. Excalidraw drawings show their autosave state in the same kind of bar;
  Mermaid already shows it in its own bar. The workspace status line shows none of this.

## Files and recovery

- UTF-8 (with/without BOM), LF and CRLF round-trip. Binary, invalid UTF-8, mixed and
  CR-only endings are rejected explicitly; they are never silently rewritten.
- Save writes a same-directory temporary file, syncs it and atomically replaces the target.
  Existing permission bits are preserved; owner/ACL, extended attributes and timestamps
  are not promised to be preserved by replacement and require platform-specific follow-up.
- SHA-256 revision checks prevent stale writes; `<hash of the path>.lock` files serialize
  Mozaik writers across processes. Since the V0.7 review they live in the app's local data
  (`locks/`), not beside the file, so saving never leaves files in a user's folder (older
  versions left `.mozaik-<hash>.lock` there; they can be deleted). Lock files intentionally
  remain (unlinking a lock can break exclusion). A non-cooperating external writer can still race the final
  check/replace boundary; no portable filesystem compare-and-swap guarantee is claimed.
- `notify` watches parent directories to observe atomic replacements/deletion. Renderer
  checks are coalesced at 150 ms and rechecked on focus. Clean documents reload; dirty
  documents retain edits and offer Save As or explicitly confirmed disk reload.
- Recovery checkpoints changed documents every second, including continuous typing.
  They are not autosaves to the user file. Last interval/in-flight edits can be lost on crash.
- Recovery is JSON in the platform app-data `recovery/<session UUID>` folder. A process-held
  OS lock excludes live sessions. Each window owns its snapshot filenames. Normal close
  waits for pending writes and removes that window's snapshots. Recoverable content stays
  until recovered or explicitly discarded; no time-based data expiration.
- Recovery opens detached, dirty documents; no layout is restored and no source file is
  overwritten automatically. A new durable checkpoint is created before deleting the old one.
- Unsupported/corrupt snapshots are kept and reported, never silently removed.

References: [CodeMirror composition](https://codemirror.net/examples/basic/),
[Tauri security capabilities](https://v2.tauri.app/security/capabilities/).
