# 007 — Workspace control key (V0.6)

Specification: local `.plans/Tessera_v0.6_Plan.md`, section 5 (gitignored like earlier plans).
It replaces the V0.1 "hold Alt" workspace control mode as the default.

## Behavior

- The workspace control key is a **physical key**, identified by `KeyboardEvent.code`:
  `ControlRight` (default), `ControlLeft` or `AltLeft`. `event.ctrlKey` alone cannot tell the
  two Ctrl keys apart.
- Only these combinations belong to Tessera, in every module: **key+K** opens the launcher,
  **key+arrows** move focus to the neighbouring panel, **key+C** closes the focused panel with
  all its tabs (unsaved work asks as usual; a part of an IDE, its code editors included, closes
  the whole IDE after a question) and **key+E** closes the window (the same close as the OS
  close: unsaved work asks). C and E were added in the fifth V0.7 review, when the title bar
  and its window buttons were removed. With Left Ctrl as the key, Left Ctrl+C no longer
  copies; Settings warns about it. Holding the key lets the panel grip
  start a whole-panel drag (the drag continues under pointer capture after release, as
  before). They are taken in the window's capture phase with `preventDefault` and
  `stopPropagation`, so no shell byte, editor command or Excalidraw tool sees them.
- Every other combination, including other Right Ctrl combinations (Right Ctrl+Z/A/C…), goes
  to the focused module unchanged. **Left Ctrl+K is no longer the launcher**: it belongs to the
  focused module (Excalidraw's link shortcut, for example). The existing Tessera shortcuts
  (Ctrl+N/O/S/Shift+S/W/G/,, Ctrl+Alt+N) are unchanged and keep their terminal exceptions; the
  plan asks not to redesign module shortcuts.
- There is no F12 toggle and no WORKSPACE/MODULE indicator. The status bar shows the Tessera
  mark and a static hint (`Right Ctrl+K launcher · +arrows focus · +C close panel · +E close
window`) and the empty window names the key.
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

Settings (`Ctrl+,`, which works with either Ctrl and so stays reachable if a keyboard lacks
Right Ctrl) offers Right Ctrl, Left Ctrl and Left Alt. Left Ctrl and Left Alt show a warning
about the shortcuts they take. **Right Alt / AltGr is listed as unavailable**: it types
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
save, save as, close tab, new window, settings) with their shortcuts, and `CMake: …` while an
IDE project has CMake. **Go to File…** in the IDE sidebar opens the file mode.

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

Added in the second V0.7 review at the user's request: Settings list **every shortcut Tessera
defines**, grouped by where it acts, with short labels. Click one and press the new keys
(Escape cancels); × removes it and ↺ restores the default.

- One registry (`src/workspace/keybindings.ts`) holds IDs, labels and defaults. Handlers ask
  `matches(event, id)`, so a change applies at once without reopening a tool. CodeMirror's
  own keys (Ctrl+D, Ctrl+F, …) and Excalidraw's are not part of it.
- Workspace-key shortcuts (`Mod+K`, `Mod+arrows`) record only the key; the held key stays the
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

Settings also have a **Window opacity** slider (30–100 %). Windows are created transparent and
the whole content takes the chosen opacity (text included, like an OS window opacity), so
every tool, xterm and Excalidraw's canvas fade alike. Dialogs are in the top layer and stay
opaque. At 100 % nothing changes.

## Not verified

Physical left/right reporting is browser-tested only (Playwright's `ControlRight`). WebView2
and WebKitGTK reporting of `ControlRight`, laptop keyboards without a Right Ctrl, AltGr layouts,
IME candidates and compositor bindings must be checked natively ([VALIDATION](../VALIDATION.md#v06-qualification)).
Rebinding, the opacity of transparent windows and settings shared between windows are
browser-tested only.
