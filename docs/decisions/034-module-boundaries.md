# 034: Module boundaries

Status: accepted. The user asked whether Mozaik's modules (Text Editor, IDE, Tasks and the
others) could be plugins that Mozaik integrates through an API it offers.

## Decisions

- Modules stay **built-in plugins compiled with Mozaik**. A module developed separately is
  added by building it into Mozaik (in this repository, or later as a package dependency);
  nothing is loaded into an installed Mozaik at run time. There is still no runtime loader,
  manifest, sandbox or SDK: native code cannot be loaded safely at run time (Tauri commands are
  compiled in), and third-party code would break the offline guarantee and the narrow Rust
  commands. This is the user's choice; it can be revisited in a later decision.
- A module (`src/plugins/<module>/`) imports only the core (`src/workspace`, `src/services`,
  `src/components`), the shared layers and `src/plugins/contract` / `src/plugins/shared`, never
  another module's files.
- Code that several modules use is not a module's: it moved out of them, unchanged, into
  - `src/lib/`: pure helpers (path keys and URIs, folder tree rows, a text change, image types);
  - `src/documents/`: the text document store, syntax choices and the large-document policy,
    shared by the Text Editor, the IDE's code editors and the File Manager;
  - `src/editor-core/`: the editors' CodeMirror parts (editing keys, Find / Replace, theme,
    folding, highlighting by file name, places), the Markdown preview and the Mermaid renderer
    it shares with the Mermaid module;
  - `src/terminal-core/`: terminal sessions, the xterm.js runtime and the terminal view, which
    the Terminal module and the IDE's bottom panel and coding agents show;
  - `src/files/`: the window's Undo/Redo history of file operations and the cut and copied
    files, shared by File Managers and the IDE Explorer. The history no longer calls the File
    Manager: File Managers listen for the folders an Undo or Redo changed.
- Calls from one module to another go through the workspace (the App) rather than imports:
  `src/plugins/contract/workspace.ts` holds what a module may ask (open text files or a text
  folder, open a terminal, open a file a module owns such as a drawing or a diagram, a pick
  from a list in the palette), and the App sets each handler. It generalizes the openers that
  existed (`textFiles`, `terminals`, the drawing stores' `setOpener`).
- The App and `src/plugins/registry.ts` assemble the modules and may import them; they are
  the integration, not a module.
- Behavior does not change; the boundary is a structure, kept by
  `src/plugins/boundaries.test.ts` (test files may compare two modules, as the Mermaid
  store's test compares diagrams with drawings).

## Later

- The IDE's own features (CMake, Cargo, Git, debugging and the others) may get contribution
  points in a later decision; 024 keeps them trusted code that can be turned off.
