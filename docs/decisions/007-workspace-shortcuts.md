# 007 — Workspace control key (V0.6)

Specification: local `.plans/Tessera_v0.6_Plan.md`, section 5 (gitignored like earlier plans).
It replaces the V0.1 "hold Alt" workspace control mode as the default.

## Behavior

- The workspace control key is a **physical key**, identified by `KeyboardEvent.code`:
  `ControlRight` (default), `ControlLeft` or `AltLeft`. `event.ctrlKey` alone cannot tell the
  two Ctrl keys apart.
- Only **key+arrows** belong to the held key, in every module: they move focus to the
  neighbouring panel, taken in the window's capture phase with `preventDefault` and
  `stopPropagation`, so no shell byte, editor command or Excalidraw tool sees them.
- **Seventh V0.7 review** (user request): the launcher, settings and closing left the
  workspace key for ordinary shortcuts, also listed as palette commands: **Ctrl+Shift+I**
  Add to Workspace, **Ctrl+Shift+,** Workspace Settings (was Ctrl+,), **Ctrl+Shift+C** Close
  Panel (the focused panel with all its tabs; unsaved work asks; a part of an IDE, its code
  editors included, closes the whole IDE after a question) and **Ctrl+Shift+E** Close Window
  (the same close as the OS close). Until then they were key+K, key+C and key+E (C and E from
  the fifth review, when the title bar and its window buttons were removed). Focus stayed on
  key+arrows: Ctrl+Shift+arrows, also proposed, select by word in every editor and align in
  Excalidraw. Exceptions: while a drawing has focus Ctrl+Shift+, (font size) and Ctrl+Shift+E
  (export image) stay Excalidraw's, like Ctrl+Shift+P; inside a terminal Ctrl+Shift+C copies
  the selection, as terminals do (Close Panel is in the palette there). A changed `Mod+…`
  binding saved for those shortcuts before is ignored.
- **Eleventh review** (user request, with VS Code's key names): the launcher is
  **Ctrl+Shift+'** (`oem_7`), settings stay **Ctrl+Shift+,** (`oem_comma`). VS Code's `oem_7`
  is a key position, the key right of the semicolon key on US (`'`), i on Turkish Q, Ä on
  German, so the binding is written `Ctrl+Shift+[Quote]`: a key in brackets matches
  `KeyboardEvent.code`, and labels show what that key types on the user's layout (WebView2's
  layout map, else US). `oem_comma` is the key that types a comma wherever the layout has it
  (Turkish Q: right of Ü), which the existing `Ctrl+Shift+,` already names. A launcher binding
  the user changed before stays.
- **Whole-panel drag** starts from the panel grip (a docked tool: anywhere) while
  **Ctrl+Shift** is held, and continues under pointer capture after release. It was the held
  workspace key before the seventh review.
- With Shift, punctuation and digit keys are named unshifted (`Ctrl+Shift+,`, not `<` on US or
  `;` on Turkish Q): the key's character comes from the WebView's layout map where it has one
  (WebView2), else from the US layout by position. Keys that type letters (Turkish ö, ç) keep
  their letter.
- Every other combination, including other Right Ctrl combinations (Right Ctrl+Z/A/C…), goes
  to the focused module unchanged. **Left Ctrl+K is no longer the launcher**: it belongs to the
  focused module (Excalidraw's link shortcut, for example), and since the seventh review so
  does Right Ctrl+K. The other Mozaik shortcuts (Ctrl+N/O/S/Shift+S/W/G, Ctrl+Alt+N) are
  unchanged and keep their terminal exceptions; the plan asks not to redesign module shortcuts.
- There is no F12 toggle and no WORKSPACE/MODULE indicator. The status line shows the Mozaik
  mark and the clock. The sixth V0.7 review gave it a keyboard button listing the workspace
  keys; the eighth removed it, as the palette lists and runs the same commands with their
  keys. A tool's own state (a text file's line ending and encoding, a drawing's autosave) is
  in that tool's bar since the eighth review. The empty window names the launcher and
  palette keys.
- **Ctrl+`** toggles the IDE terminal (VS Code's View: Toggle Terminal, also a palette
command): it shows and focuses the bottom panel's Terminal of the current code file's
project, and when that terminal has focus minimizes the panel and returns to the code. The
key left of 1 is read by position, so it is the same key on layouts where it types `"`
  (Turkish Q) or another character.
- In the launcher **Enter** adds the tool as an automatic split, **Ctrl+Enter** as a tab
  and **Ctrl+Shift+Enter** as a floating panel (eighth review, [decision
  002](002-editor-and-data.md#floating-panels)); a click with the same modifiers does the
  same. The palette's **Add to Workspace: <tool>** commands take the same keys and show them
  under the list. The palette also has **Float Panel** / **Dock Panel** for the focused
  panel.
- Cancelling the launcher returns focus to the element that had it (editor, terminal, canvas).
- **No title bar** (fifth V0.7 review): the window is undecorated and only a 10 px canvas
  strip above the panels is a drag region (double-click maximizes). Minimize is left to the
  OS (Win+Down, the taskbar, the compositor); resizing uses the window edges.

## Held state

`src/workspace/shortcuts.ts` is a pure module (unit tested). The handler tracks the key from
its own `keydown`/`keyup` and clears it on window `blur`, when the document becomes hidden,
and when a later key event shows the logical modifier is up (a keyup missed while another
application had focus). A command also requires the logical modifier state on that event, no
Shift/Meta, and not the other modifier (Ctrl+Alt+K is a different shortcut). Events with
`AltGraph` are ignored: on Windows AltGr also reports a synthetic Left Ctrl, so AltGr
characters never trigger workspace commands even with Left Ctrl selected. A bare Left Alt
press is prevented to keep the WebView from activating menu handling.

On layouts without Latin letters K is matched by its physical position (`KeyK`).

## Settings

Settings (`Ctrl+Shift+,`, which works with either Ctrl and so stays reachable if a keyboard
lacks Right Ctrl) offers Right Ctrl, Left Ctrl and Left Alt. Left Ctrl and Left Alt show a warning
about the shortcuts they take. **Right Alt / AltGr is not offered** (until the seventeenth review it was listed
as unavailable): it types
characters on many layouts (Turkish `@`, `€`, `{`…) and cannot be used safely. Shift was
dropped as a choice because Shift+arrows select text.

The choice is stored in `modifier.json` (app config directory) by Rust, validated against the
three codes. Values saved before V0.6 migrate to the matching physical key: `Alt` → Left Alt,
`Control` → Left Ctrl, `Shift` → Right Ctrl. A user who never changed the setting gets Right
Ctrl.

## Command palette

Added during the V0.7 review at the user's request as a field centred in the title bar; the
fourth V0.7 review removed the field: the palette opens **only by its shortcut**, like VS
Code's. **Ctrl+Shift+P** opens it with `>` (commands), **Ctrl+P** without a prefix (files of
the IDE project used last) and **Ctrl+Shift+O** with `@` (symbols of the code file focused
last, from the language server); typing or deleting the prefix switches between them. While
a drawing has focus these keys stay Excalidraw's (Ctrl+Shift+P is its own command palette).
Escape or a click outside closes it and returns focus to the tool that had it, so a command
acts on that tool. The commands are the workspace actions (launcher, new text tab, open,
save, save as, close tab, close panel, close window, new window, settings) with their
shortcuts, `CMake: …` while an IDE project has CMake and `Debug: …`. **Go to File…** in the
IDE sidebar opens the file mode.

Since the eleventh review commands are listed as in VS Code: the five run last first (newest
first, marked "recently used"), a line, then the others (marked "other commands") by how well
they match the query (the whole label, the query at its start, the query as one piece, only
its words) and alphabetically. The recent labels are kept in the WebView's local storage, so
every window and later sessions share them; files, symbols and pick lists keep their order.
The arrow keys scroll the selected entry into view, in the palette and in the launcher.

Since the seventh review the palette serves the whole workspace: **Add to Workspace: <tool>**
for every launcher entry (an automatic split, as Enter in the launcher), and the commands of
the modules in the workspace, named `Module: Action`. A view registers its own menu actions
while it is mounted (`useCommands` in `src/workspace/commands.ts`), so a command runs on that
view with its current state and disabled actions are left out; of several views of a module
the focused one, else the one focused last, gives them, and the focused module's commands
come first. Registered: File Manager (back, forward, parent folder, edit path, new
file/folder, hidden files, refresh, delete permanently), Tasks (new task, new list, manage
lists), Notes (new note), Mermaid (open, save, save as, export SVG/PNG), IDE (go to file,
open folder, refresh, problems, project settings, close IDE, show each sidebar view) and the
Code Editor (its editor menu: navigation, references, rename, quick fix, format, find, go to
line, breakpoints, changes). Terminal, Text Editor and Excalidraw add none: their actions are
already workspace commands or Excalidraw's own.

## Rebindable shortcuts

Workspace Settings (fourth V0.7 review, after VS Code's settings): a search field over tabs —
**General** (workspace key, window opacity, workspace shortcuts), then one per module:
**Text Editor**, **IDE** (clangd, CMake, kits, Code Editor shortcuts), **Terminal** (default
shell), **File Manager**, **Tasks and Notes** — each with its own shortcuts. Sections fold;
a search shows matches from every tab. Changes are a draft: **Save** applies them, Cancel or
Escape asks when something changed, and **Reset to Default** resets the settings shown (the
tab, or the search results). Window opacity previews while chosen. Programs (clangd, CMake)
are chosen in a native dialog and apply at once, as the renderer never names a program.
CMake palette commands have no default shortcut.

Added in the second V0.7 review at the user's request: Settings list **every shortcut Mozaik
defines**, grouped by where it acts, with short labels. Click one and press the new keys
(Escape cancels); × removes it and ↺ restores the default.

- One registry (`src/workspace/keybindings.ts`) holds IDs, labels and defaults. Handlers ask
  `matches(event, id)`, so a change applies at once without reopening a tool. CodeMirror's
  own keys (Ctrl+D, Ctrl+F, …) and Excalidraw's are not part of it.
- Workspace-key shortcuts (`Mod+arrows`) record only the key; the held key stays the
  separate setting above.
- Keys already used in the same place, or by a workspace shortcut, are refused with a note
  naming the other shortcut. The same keys in tools never focused together (Ctrl+L in the File
  Manager and in the Code Editor) are allowed.
- Mouse gestures (Ctrl+click, Alt+click) and the terminal's copy/paste are listed but fixed.
- Inside a terminal a plain Ctrl+letter workspace shortcut still reaches the shell.
- Changes are stored with the window opacity in `preferences.json` (app config directory)
  by Rust, which validates IDs and lengths and tells every window, so all windows follow at
  once. A damaged file is reported and defaults are used until settings change.

## Window opacity

Settings also have a **Window opacity** slider (30–100 %, in 1 % steps since the eighth
review). Windows are created transparent and
the whole content takes the chosen opacity (text included, like an OS window opacity), so
every tool, xterm and Excalidraw's canvas fade alike. Dialogs are in the top layer and stay
opaque. At 100 % nothing changes.

## Not verified

Physical left/right reporting is browser-tested only (Playwright's `ControlRight`). WebView2
and WebKitGTK reporting of `ControlRight`, laptop keyboards without a Right Ctrl, AltGr layouts,
IME candidates and compositor bindings must be checked natively ([VALIDATION](../VALIDATION.md#v06-qualification)).
Rebinding, the opacity of transparent windows and settings shared between windows are
browser-tested only.
