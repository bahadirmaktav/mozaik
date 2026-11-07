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
  Dim (lower contrast), Night Blue, Warm Dark, Mozaik Light and Paper; ten dark themes after
  VS Code's followed ([029](029-markdown-links-and-themes.md)). No theme files are loaded or
  downloaded.
- **Choosing.** Workspace Settings → General → Window → Theme (a draft that previews like the
  window opacity and goes back on leaving without Save) and **Preferences: Color Theme…** in
  the palette: the theme under the cursor applies at once; Enter keeps it for every window,
  Escape restores the saved one. The ID is stored in `preferences.json` (`theme`), checked in
  Rust as a short lowercase name; an unknown ID shows the default.
- **What stays.** Excalidraw takes the light or dark scheme when a drawing opens; the
  Mermaid preview keeps its dark diagram theme; diff, coverage and debugging tints keep their
  colors, which read on both.
- **IDE zoom scales the whole IDE, as in VS Code** (nineteenth review: the user found that
  only the code text grew). `ideFontSize` (8–32 px, default 13) is the code text size of
  code editors, comparisons and coverage tabs (`--ide-font-size`, whole pixels), and its
  ratio to 13 is the IDE's zoom (`workspace/ideZoom.ts`, `--ide-zoom`). Every IDE panel
  (sidebar, code editors and their tabs, bottom panel, status bar, comparisons, coverage
  tabs) and the floating debug toolbar scale their text, icons, rows, bars, spacing and
  menus by it; the docked bars' sizes grow with it (`limitsAt` in `plugins/registry.ts`,
  the 2px panel border stays), Output's virtual lines take whole pixels of it and the bottom
  panel's terminals take it as their font size. Other modules keep `--ide-zoom: 1`. The
  zoom is a CSS variable, not CSS `zoom` or the WebView's zoom: those would zoom the other
  modules too, or misplace menus, drags and xterm.js's pointer positions, which work in
  unscaled viewport pixels. IDE → Font → Font size sets it; **IDE: Zoom In/Out/Reset Zoom**
  (palette, while an IDE is open) and Ctrl+Shift++ / Ctrl+Shift+- step it by one pixel and
  save it for every window. `+` is matched by the character the key types (Shift+= on US,
  Shift+4 on Turkish Q, the keypad), since it has no unshifted key on many layouts.

## Font sizes of the other modules (twenty-seventh review)

The user asked for the setting the IDE and the command palette have in the other modules. Text
Editor (with the Mermaid source), Terminal, File Manager, Tasks and Notes each have a **Font size**
in their tab of Workspace Settings (`fontSizes` in `preferences.json`, 8–32 px, default 13, for
every window). As in the IDE it is the size of the text and scales the module around it, by giving
the module's panels its ratio to 13 as the same `--ide-zoom` (`workspace/moduleZoom.ts`): tabs, bars,
menus and text grow, and a File Manager's virtual rows take whole pixels of it. Terminal panels
take it as their font size; a terminal in an IDE follows the IDE. Excalidraw keeps its own sizes, as
its editor stays unmodified. There are no zoom shortcuts for these modules, only the setting.
