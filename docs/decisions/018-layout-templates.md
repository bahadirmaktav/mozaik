# 018: Layout templates

Status: accepted (thirteenth review). The user asked to save the modules of a workspace and
how they are placed as a named template from the command palette, and to open such a
template later with another command.

## Decisions

- **Explicit, never at startup.** A template opens only from **Open Layout Template…**. A new
  window still starts empty and no layout is restored on its own (decision
  [001](001-foundation.md)); a template is a layout the user chose to open, like a file.
  Once it opens successfully, its name identifies that window in the native window title
  until the window is empty again; this is presentation only and does not restore the layout later.
- **The layout only.** The user chose to keep modules and their places, not content: which
  modules each panel holds (in tab order), the splits with their axis and share, editor
  groups ([016](016-tabs-and-editors.md)) and floating panels with their rectangle relative
  to the workspace area. Documents, folders, terminal sessions, File Manager locations and
  IDE projects are not kept. Every module opens fresh: a Text Editor as a page to write on
  (a panel's several text tabs become one), Excalidraw and Mermaid as Untitled, terminals and
  File Managers in their start folders. The IDE is kept as its project sidebar; its other
  parts (code editors, bottom panel, status bar, comparisons, coverage tabs) are left out and
  the IDE opens them around its sidebar again, as it does from the launcher.
- **Opening replaces the workspace after asking.** In a window with panels, the user
  confirms that every panel closes; the usual questions about unsaved documents follow, and
  cancelling one keeps the workspace as it was. The new layout is checked like any other
  (minimum sizes): a template saved in a larger window may not fit, and then nothing opens.
  Tasks and Notes stay one panel per application: when another window shows them, the
  template opens without them (that window is focused, as from the launcher).
- **Storage.** `layouts.json` in the app config directory, written atomically by
  `src-tauri/src/layouts.rs`, shared by all windows. Rust validates every template (names of
  1 to 60 characters, unique without regard to case; at most 50 templates, 64 panels, 20
  tabs per panel, 32 levels; module IDs as plain words; shares and rectangles in range). A
  damaged file is reported and never overwritten. The preferences file was not used: an
  invalid template there would reset every setting to its default.
- **Commands.** **Save Layout as Template…** asks for a name (a name in use asks to replace
  that template), **Open Layout Template…** and **Delete Layout Template…** pick from the
  saved templates in the palette's pick list. They have no default shortcuts. Since the
  seventeenth review the name is typed in the palette's place (the saved names listed under
  it, Enter saves) and replacing, opening and deleting are confirmed in a pick list, so the
  whole flow stays in one place at the top of the window.
- `src/workspace/templates.ts` turns workspace state into a template and back (pure, with
  unit tests); the model's `load` action replaces the workspace and validates it.

## Not verified

Browser tests keep templates in memory. Saving and reading `layouts.json`, sharing templates
between windows and opening them in the desktop app have not been exercised natively.
