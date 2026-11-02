# 021: Color themes and IDE zoom

Status: accepted (eighteenth review). The user found the dark theme tiring and asked for
other themes in General settings and in the command palette, previewed while moving through
them as in VS Code, and for an IDE font size with zoom commands (Ctrl+Shift++ and
Ctrl+Shift+-).

## Decisions

- **Themes are token sets.** A theme (`src/workspace/themes.ts`) sets the visual tokens of
  `tokens.css` (canvas, surface, editor, popup, hover, border, text, muted, accent, warning,
  selection…) and the code highlighting colors (`--syntax-*`) on the page root, and
  `color-scheme`. CodeMirror's theme and highlight style use these variables, so editors
  follow a change without being rebuilt; terminals get new xterm.js colors (a darker ANSI
  palette on light themes). Six original palettes ship: Mozaik Dark (the default), Mozaik
  Dim (lower contrast), Night Blue, Warm Dark, Mozaik Light and Paper. No theme files are
  loaded or downloaded.
- **Choosing.** Workspace Settings → General → Window → Theme (a draft that previews like the
  window opacity and goes back on leaving without Save) and **Preferences: Color Theme…** in
  the palette: the theme under the cursor applies at once; Enter keeps it for every window,
  Escape restores the saved one. The ID is stored in `preferences.json` (`theme`), checked in
  Rust as a short lowercase name; an unknown ID shows the default.
- **What stays.** Excalidraw takes the light or dark scheme when a drawing opens; the
  Mermaid preview keeps its dark diagram theme; diff, coverage and debugging tints keep their
  colors, which read on both.
- **IDE zoom is the code text size.** `ideFontSize` (8–32 px, default 13) sets
  `--ide-font-size` for code editors, comparisons and coverage tabs; the sidebar, bars and
  terminals keep their size. IDE → Font → Font size sets it; **IDE: Zoom In/Out/Reset Zoom**
  (palette, while an IDE is open) and Ctrl+Shift++ / Ctrl+Shift+- step it by one pixel and
  save it for every window. `+` is matched by the character the key types (Shift+= on US,
  Shift+4 on Turkish Q, the keypad), since it has no unshifted key on many layouts.
