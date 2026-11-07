# 027: The IDE as a whole, editor groups, file tabs and coding agents

Status: accepted (twenty-seventh review). The user asked that the panels of an IDE be treated as
one whole, that code files split on the screen as in VS Code, that images show in the code area
and that Claude Code and Codex open beside the code from the IDE's folder.

This replaces the parts of [010](010-ide.md) that said the IDE shares a window with other
modules, that two files side by side are ordinary panels and that a document is never shown
twice.

## A window with an IDE holds only the IDE

- While a window has an IDE, another module opens beside it only as a floating panel: the
  launcher and the palette's **Add to Workspace** list every module, Ctrl+Shift+Enter floats it,
  and Enter or Ctrl+Enter is refused with a notice that points to floating or a new window.
  Such a module is a guest (`guests` in `App.tsx`): its panel floats with guests only, has no
  Dock, and a drop or dock that would put it in the layout or beside a part of the IDE (or a
  part of the IDE beside it) is refused. A tab added to a guest's panel is a guest too.
- An IDE is refused in a window that already holds other modules, instead of opening a second
  window by itself: every new window starts empty unless the user asks otherwise
  (`AGENTS.md`), and the notice says what to do.
- Ctrl+N and Ctrl+O make code tabs in such a window, and a file dropped from the OS opens the
  way the Explorer opens it.
- A layout template saved earlier with an IDE beside other modules opens with the IDE only.
- A recovered text document opens as a code tab; a recovered drawing or diagram waits for a
  window without an IDE, and keeps its snapshot.
- A tab cannot split a docked tool (a drop at its edge is refused, in `model.ts`), so the
  sidebar, bottom panel and status bar keep their places.
- A second IDE in the same window stays possible: it is not another module. Being a whole,
  it never splits a part of the first IDE: the whole layout splits and the new IDE takes the
  right half, while the first IDE's sidebar share doubles so it keeps its width. A window
  holds at most two IDEs; a third is refused with a pointer to a new window (Ctrl+Alt+N).

## Every file opens as a tab among the code editors

The Explorer, Go to File and an untracked file in Source Control all go through `reveal`:

- Text opens in a code tab.
- Images (the types Excalidraw accepts, SVG included) open in a **file tab** (`FileTab.tsx`):
  pan and zoom as in the Mermaid preview, size and bytes in its bar, read as bytes by the
  existing `drawings_read_image` and shown from a blob, so an SVG's scripts and links never run
  or load. It follows the file while it is shown. An SVG is shown as a picture rather than as
  text; it can be edited in a Text Editor in another window.
- Other binaries (known by extension, or found when reading refuses them) open a file tab with
  a note and **Open in Default Application**, the File Manager's own command.
- **`.excalidraw` and `.mmd` keep their own views as tabs among the code editors.** They are
  files shown in a tab, like an image, not modules added to the window: as plain text a drawing
  would be unreadable JSON and a diagram would lose its preview. Excalidraw and Mermaid
  themselves cannot be added beside an IDE.

## Editor groups

As in VS Code, code panels are **editor groups** of one code area: `Split.group` (the Text
Editor's divided panel) is now used here too. They are drawn as one panel divided by a line, and
anything else (the bottom panel, an agent) splits around the whole area.

- **Split Right/Down** in a tab's menu, **View: Split Editor Right/Left/Down/Up** and Ctrl+\
  show the same file in the new group. Any depth of splits works, limited only by the panels'
  minimum sizes.
- A tab dropped at a code panel's edge makes a new group, and Open to the Side does too.
- **View: Move Editor into Next/Previous Group** (Ctrl+Alt+Right/Left) moves a tab; past the last
  group it opens a new one. Ctrl+1/2/3 focus a group; **View: Close Editor Group** closes one.
- Closing a group's last tab removes the group; only the last group turns into the empty code
  area. An empty group has a close button.

Group keys act only while a code panel has focus, so a terminal keeps Ctrl+\ and Ctrl+1.

**One file in two groups** (`codeViews.ts`, plugin `code-view`): the document keeps its own tab,
whose ID is the document's. Another view's tab has its own ID and editor state over the same
document; their text is kept equal through the document store, the way a comparison already
edits a document. Closing the document's own tab while a view stays swaps the two tabs' places
and closes the view instead, so nothing asks and the document, with its undo history, stays.
Only the last tab of a file asks about unsaved changes. Each view keeps its own undo history;
an edit in one reaches the other as an ordinary change, which that view's undo can also revert.
A language server syncs through the focused view (`followView`), and diagnostics arrive in the
view focused last; another view shows them when it gets focus.

## Coding agents

The Claude Code and Codex icons in a code panel's header open a project's one agents panel beside
the code area, with the bottom panel still under both. The plugin `ide-agent` is a docked tool
(alone in its panel, with its own bar), on terminal sessions that run `claude` or `codex` in the
project's folder.

While the panel is shown the icons are on its bar instead of on the code panels, as tabs of the
agents, and the shown agent's sessions are tabs beside them. A press on another agent's icon shows
it (its last session, or its first new one); a press on the shown agent's icon adds a session. An
icon's lower right shows how many sessions of that agent are open, wherever the icon is.

Minimizing takes the panel out of the layout, so no bar or gap stays. The sessions live in
`agents.ts` and keep running. An icon returns the panel at its width (the code's share of the split
is kept) on the same sessions. We did not keep a zero-width docked panel: spatial focus, the
splitter gap and drops would each need an exception for something the user cannot see.

A session's tab shows "Session N" until its menu's **Rename** names it, as a terminal's tab; the
name stays when the panel is minimized or the session restarts. Its × or middle click ends it, Restart appears when it has ended, and closing the last one
minimizes the panel. Closing the IDE ends them all, minimized or not. Ctrl+Shift+C on the panel only
minimizes it, since closing would end every session at once. **IDE: Toggle Claude Code** and **IDE:
Toggle Codex** show the agent or, if it is already shown, minimize; **IDE: New Claude Code Session**
and **IDE: New Codex Session** add a session. Settings → IDE → Features can turn the feature off.

The renderer passes only the name `claude` or `codex`, which Rust checks as an enum
(`terminal.rs`); it never passes a program. The user's own shell runs the command (with
`-EncodedCommand` for PowerShell, after the chosen prompt file, `/k` for Command Prompt, `-C` for
fish, `-i -c` otherwise) and stays open afterwards, so the user's `PATH`, profile and login
apply and a missing program shows the shell's own message. Mozaik installs nothing, has no
knowledge of the agents' protocols and runs nothing without the user's press. Command Prompt
looks for a program in the current folder before `PATH`, so a `claude.bat` in the opened project
would run instead of the agent: its agent sessions get `NoDefaultCurrentDirectoryInExePath=1`, as
PowerShell behaves anyway (`.\name` still runs a program of the folder there). Found in the
v0.13.0 security check, before any release had agents. Nothing is
downloaded for the icons, which are inline in `AgentPanel.tsx`: the marks the Claude Code and Codex
VS Code extensions themselves use.

## Not verified

Everything native: `claude` and `codex` actually starting through each shell, ConPTY resizing when
the panel returns or another session shows, sessions running on while they have no view, images read from disk and following a change on disk, the file watcher
for file tabs, and native file drops into an IDE window. Browser tests cover the layout and
stand in for Rust. Language server sync across two views was checked by reading, not against
clangd.
