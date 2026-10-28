# 002 — Editor, interaction and data decisions

## CodeMirror 6

Select CodeMirror over Monaco: the V0.1 surface is text editing, not an IDE. It supports
independent EditorState / EditorView lifetimes and individually selectable extensions,
without a worker/language-service setup. No search UI, regex, multicursor or LSP is enabled.
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
- Panel grip drag requires the modifier at start; captured pointer drag continues after
  modifier release. Tabs can always be dragged. Five CSS pixels distinguish drag from click.
- Outer 20% of a panel are edge targets (left/right priority at corners); middle is center.
  Dropping onto a tab header means insertion/reordering, not a top edge split.
- Native files open as tabs in the panel under the physical-pixel drop position (converted
  using window scale factor), otherwise in the focused panel. Empty workspace gets a panel.
- Ctrl+K launcher, Ctrl+N tab, Ctrl+Shift+N auto split, Ctrl+O open, Ctrl+S save,
  Ctrl+Shift+S save as, Ctrl+W close, Ctrl+G go to line. Splitters are keyboard accessible.
- Ctrl+, opens settings and Ctrl+Alt+N creates an independent window. Workspace actions are
  shortcut-driven; the custom title bar only exposes the logo and window controls.

## Files and recovery

- UTF-8 (with/without BOM), LF and CRLF round-trip. Binary, invalid UTF-8, mixed and
  CR-only endings are rejected explicitly; they are never silently rewritten.
- Save writes a same-directory temporary file, syncs it and atomically replaces the target.
  Existing permission bits are preserved; owner/ACL, extended attributes and timestamps
  are not promised to be preserved by replacement and require platform-specific follow-up.
- SHA-256 revision checks prevent stale writes; directory-side `.tessera-<hash>.lock` files
  serialize Tessera writers across processes. Lock files intentionally remain (unlinking a
  lock can break exclusion). A non-cooperating external writer can still race the final
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
