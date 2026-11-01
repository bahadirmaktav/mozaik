# 019: Fonts

Status: accepted (fifteenth review). The user asked to choose fonts in Workspace Settings: a
General font with a choice to use it in every module, and a font in each module's settings
that applies while the General font is not used for all.

## Decisions

- **General font = interface font.** Workspace Settings → General → Font sets the font of
  the interface (tabs, palette, dialogs, sidebars). Modules without their own font follow it;
  code editors and terminals keep their monospace font. **Use for all modules** makes every
  module use it instead of its own choice (only while a General font is set).
- **One font per module:** Text Editor (also the Mermaid source), IDE (code editors,
  comparisons, coverage tabs, Output, Debug Console and search results; the sidebar trees
  stay in the interface font), Terminal (every terminal, also the IDE's), File Manager, Tasks
  and Notes (the Tasks and Notes tab has one field each). Excalidraw keeps its own fonts
  (decision [006](006-excalidraw.md)) and the Mermaid preview its diagram font. Empty is the
  module's default.
- **A family name, not a stack.** A setting is one family name. It is written into CSS
  variables (`--font-ui`, `--font-<module>`) on the page root with the module's kind of
  fallback (monospace for editors and terminals), so a missing font never shows a serif
  font. Quotes, commas, brackets, `;`, `:`, `\` and control characters are rejected in the
  renderer and in `preferences.rs`, so a name cannot end the CSS value. Each panel's content
  carries `data-plugin`, which picks its variable; xterm.js gets the font as an option and
  terminals refit at once, and code editors measure again.
- **No font list from the system.** The field suggests a fixed list of common families that
  are installed (detected by measuring text on a canvas) and accepts any other name, with a
  note when it is not found. Listing system fonts would need a new crate, a font process
  (`fc-list`) or the browser's Local Font Access permission prompt. No font is bundled or
  downloaded; the application stays offline.
- **Family only.** Font size and line height stay as they are; the user asked for the font.
