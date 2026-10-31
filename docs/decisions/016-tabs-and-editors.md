# 016: Tab menu, editor split and shared editing keys

Status: accepted (tenth review). The user asked, with VS Code as the reference, for tabs that
close with the middle button and offer Close, Close Others, Close All and Split from a right
click; a split for the Code Editor and the Text Editor; new text tabs from a double click on
the tab strip and a `+`; the Code Editor's text shortcuts in the Text Editor; split
terminals in the IDE bottom panel; and Kanban-like task dragging.

## Decisions

- **The tab menu belongs to the workspace tab strip** (`WorkspaceView.tsx`), so every tabbed
  panel has it. Close, Close Others and Close All go through App's ordinary close, so unsaved
  documents still ask and the IDE still keeps its empty code area (decision 010), which has no
  tab at all. The middle button
  closes a tab where its close button would; its mousedown is prevented so WebView2's
  autoscroll never starts.
- **Split Right / Split Down moves the tab** into a new panel on that side, as dragging it to
  that edge does. A text or code editor alone in its panel opens a new, empty editor of its
  kind there instead. VS Code shows the same file in both groups; here a tab owns its
  document (instance ID = document ID) and a file is open in one document only (decision
  [010](010-ide.md)), and two live views of one document would need shared undo, close and
  recovery rules. Floating panels offer no split (they have no edges).
- **New text tabs**: a panel whose active tab is a Text Editor shows a `+` before its panel
  buttons, and a double click on the free part of its tab strip does the same.
- **The Text Editor shares the editing shortcuts** of the Code Editor
  (`src/plugins/text-editor/editing.ts`): Ctrl+L, Ctrl+D, Ctrl+Alt+Up/Down, Alt+click and
  Shift+Alt+drag, Ctrl+K Ctrl+C / Ctrl+K Ctrl+U (in files whose language has comments) and
  CodeMirror's Find / Replace (Ctrl+F). In Workspace Settings these moved to the Editors
  scope (Text Editor tab, "text and code editors"); their IDs are unchanged, so saved
  bindings stay. Language features (completion, servers, folding, brackets) stay in the
  Code Editor; this supersedes the "no search UI or multicursor" line of decision
  [002](002-editor-and-data.md).
- **Split terminals**: the bottom panel keeps terminal groups (`groups: string[][]`); a
  group is shown side by side. Hovering a terminal in the list offers Split (a shell of the
  same kind in the same folder, added to its group) and Kill; split terminals hang under the
  first of their group. The list is shown from the first terminal on, so a single terminal
  can be killed there; the bar's Kill Terminal button is gone. The shell chooser sits left
  of New Terminal, against it.
- **IDE terminals start in the plain folder**: project roots are canonical (`\\?\C:\…` on
  Windows). Command Prompt cannot use such a working directory and falls back to the
  Windows folder, and PowerShell shows it as a provider path, so `create_terminal` passes
  `git::plain` of the folder.
- **Tasks**: the sections are shown without tasks too, and the per-section "+ Add Task" rows
  are gone (each section header has its `+`). While a task is dragged, a card follows the
  pointer and the row leaves the list, which opens a slot where it would drop. The drag
  follows window pointer events instead of capture on the handle, because the handle leaves
  the layout with its row.
- The Code Editor bar has no `⋯` button any more; its actions are the right-click menu and
  the command palette (`Code Editor: …`).
