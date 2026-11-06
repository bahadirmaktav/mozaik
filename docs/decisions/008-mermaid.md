# 008 — Mermaid diagrams (V0.6)

Specification: local `.plans/Tessera_v0.6_Plan.md`, section 3. PlantUML is out of scope; no
Java or external renderer is needed.

## Integration map

| Plan concept        | Implementation                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Module              | Built-in `PluginDefinition` `mermaid` (minimum 320×240) in `src/plugins/registry.ts`            |
| Package             | `mermaid` **12.2.0**, pinned exactly, imported only by `render.ts` when a preview first renders |
| Diagram identity    | `BoundFile` in the shared store `src/plugins/shared/boundFiles.ts` (kind `mermaid`)             |
| Source editor       | CodeMirror 6 (already used by the Text Editor) with the shared theme; no new editor package     |
| Native boundary     | `src-tauri/src/drawings.rs` with `kind: "mermaid"`, through `src/services/drawings.ts`          |
| Recovery            | The existing recovery store with `kind: "mermaid"`                                              |
| Reopen              | `diagrams.json` in the app data directory, like Excalidraw's `drawings.json`                    |
| File Manager / drop | `.mmd` and `.mermaid` open in Mermaid; opening an open file focuses its tab (or other window)   |

## Shared with Excalidraw

Diagrams follow the V0.5 drawing rules ([decision 006](006-excalidraw.md)), so the drawing
store became a factory (`createBoundFiles`) used by both modules, and the native drawing
commands take a `kind`:

- New diagrams open as `Untitled`/`Untitled 2` with an editable example and are written only
  through Save As (`.mmd` appended when missing; `.mermaid` accepted). Nothing is written to the
  user's folders before a destination is chosen.
- Bound diagrams autosave 1 s after the last edit through a per-diagram queue with revision
  checks and atomic replacement. Without a dialog Rust writes only paths registered to the
  calling window. A disk change reloads a clean diagram and marks a dirty one as conflicting
  (Save As / Reload); a failed save shows Retry / Save As. Closing lets saves settle, then asks
  Save / Discard / Cancel for unsaved content.
- Unsaved diagrams are checkpointed for crash recovery and come back as new unsaved diagrams.
- The first Mermaid opened in a session reopens the previous session's diagram files as tabs
  (the window itself starts empty; panel positions are not restored), as decided for V0.5.
- Mermaid sources are UTF-8 text: BOM and LF/CRLF are preserved and binary, invalid or
  mixed-ending files are rejected unchanged, as for text documents. Syntax errors are not a
  reason to refuse a file.

## Rendering

- **Split view**: source and preview side by side with a separator that is dragged (pointer
  capture) or moved with arrow keys; each pane keeps at least 120 px. Below 520 px of width the
  panes stack vertically. The share is kept per diagram across remounts, as is the editor
  state (undo history).
- **Debounce and races**: the preview renders 300 ms after typing stops (immediately when
  first shown). Renders run one at a time through a queue because Mermaid keeps global state,
  and a result is applied only if it belongs to the latest source.
- **Errors**: a syntax error never touches the source. The message is shown above the last good
  diagram, which stays visible but dimmed and marked outdated (explicit choice; it keeps
  context while typing). Exports are disabled until the diagram renders again.
- **Security**: `securityLevel: "strict"` (Mermaid sanitizes the SVG with DOMPurify and drops
  click callbacks and scripts), `htmlLabels: false` (labels are SVG text, not HTML in
  `foreignObject`), `suppressErrorRendering`, and a `secure` list so `%%{init}%%` directives in
  a file cannot change the security level, label mode or sanitizer settings. The resulting
  markup is inserted as sanitized SVG. Browser tests check that `<img onerror>`, `<script>`,
  `click … call` and `javascript:` links do not run and that nothing is requested from the
  network.
- **Theme**: Mermaid's dark theme with Mozaik's editor background, system UI font; no remote
  fonts or icon packs are registered.

## Export

The diagram menu (⋯) offers Open…, Save, Save as…, Export SVG… and Export PNG…. SVG export
writes the rendered SVG with an XML header and the preview background. PNG export draws that
SVG at twice its size (capped at 16384 px per side) onto a canvas with the same background;
because labels are SVG text the canvas is not tainted (a diagram type that still embeds HTML
reports that PNG is unavailable). Both go through the existing `drawings_export` command:
native save dialog, `.svg`/`.png` only, atomic write. The `.mmd` file, its tab and its saved
state do not change.

## Shortcuts

Ctrl+O opens a diagram and Ctrl+S / Ctrl+Shift+S save it while a Mermaid panel is focused, as
for drawings. CodeMirror's own editing keys apply in the source. Workspace keys follow
[decision 007](007-workspace-shortcuts.md).

## Layout without ELK

Mermaid 12 lays diagrams out with ELK by default, but elkjs is EPL-2.0 and cannot ship with
Mozaik's GPL-3.0 code. Vite resolves it to `src/plugins/mermaid/no-elk.ts` and Mozaik sets
`layout: "dagre"` (also for state diagrams), the default up to Mermaid 11. A file that asks for
`layout: elk` shows a message instead of a diagram.

## Size

Mermaid and its diagram chunks are lazy-loaded; the main bundle does not grow. The release
`dist` is about 27 MB (Excalidraw fonts included).

## Not verified

Native dialogs, autosave on disk, the watcher, `diagrams.json` across a restart, crash
recovery, cross-window focusing, PNG export under WebView2/WebKitGTK and the app CSP
([VALIDATION](../VALIDATION.md#v06-qualification)).

## Zoom, moving and colors (twenty-seventh review)

Ctrl+wheel zooms the preview at the pointer, dragging with the left button (or the wheel) moves
it, and a double click or the percentage in its corner fits it to the panel again
(`components/PanZoom.tsx`, shared with the IDE's image tabs). The place the user chose survives
a re-render and a tab switch. Until then the diagram fits the panel by itself.

Mermaid's `dark` theme glowed around nodes, drew a mindmap's first branch black and filled a
Gantt's excluded days bright yellow, so diagrams use its `base` theme with colors set in
`render.ts` for every diagram type. Hues are muted so light text reads on them. A diagram's own
`classDef` colors still apply.
