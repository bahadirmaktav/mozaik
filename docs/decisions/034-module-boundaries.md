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
    it shares with the Mermaid module.
- Calls from one module to another go through the workspace (the App) rather than imports:
  a module asks the workspace to open something (a text file, a terminal, a drawing or a
  diagram, a File Manager), and the module that handles it registers how. This generalizes the
  existing openers (`textFiles`, `terminals`, `setOpener` of drawings).
- Behavior does not change; the boundary is a structure, kept by a test.

## Later

- The IDE's own features (CMake, Cargo, Git, debugging and the others) may get contribution
  points in a later decision; 024 keeps them trusted code that can be turned off.
