# 007 — Workspace control key (V0.6)

Specification: local `.plans/Tessera_v0.6_Plan.md`, section 5 (gitignored like earlier plans).
It replaces the V0.1 "hold Alt" workspace control mode as the default.

## Behavior

- The workspace control key is a **physical key**, identified by `KeyboardEvent.code`:
  `ControlRight` (default), `ControlLeft` or `AltLeft`. `event.ctrlKey` alone cannot tell the
  two Ctrl keys apart.
- Only these combinations belong to Tessera, in every module: **key+K** opens the launcher,
  **key+arrows** move focus to the neighbouring panel, and holding the key lets the panel grip
  start a whole-panel drag (the drag continues under pointer capture after release, as
  before). They are taken in the window's capture phase with `preventDefault` and
  `stopPropagation`, so no shell byte, editor command or Excalidraw tool sees them.
- Every other combination, including other Right Ctrl combinations (Right Ctrl+Z/A/C…), goes
  to the focused module unchanged. **Left Ctrl+K is no longer the launcher**: it belongs to the
  focused module (Excalidraw's link shortcut, for example). The existing Tessera shortcuts
  (Ctrl+N/O/S/Shift+S/W/G/,, Ctrl+Alt+N) are unchanged and keep their terminal exceptions; the
  plan asks not to redesign module shortcuts.
- There is no F12 toggle and no WORKSPACE/MODULE indicator. The status bar shows a static hint
  (`Right Ctrl+K launcher · +arrows focus`) and the empty window names the key.
- Cancelling the launcher returns focus to the element that had it (editor, terminal, canvas).

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

Added during the V0.7 review at the user's request: a field centred in the title bar opens a
filterable command list below it, like an editor's command palette. It is a button, not part of
the drag region; Escape or a click outside closes it and returns focus to the tool that had
it, so a command acts on that tool. The starting commands are the existing workspace
actions (launcher, new text tab, open, save, save as, close tab, new window, settings) with
their shortcuts shown; which commands belong there is still open. It has **no shortcut** yet:
the IDE keymap is deferred, and Ctrl+Shift+P is Excalidraw's own command palette.

## Not verified

Physical left/right reporting is browser-tested only (Playwright's `ControlRight`). WebView2
and WebKitGTK reporting of `ControlRight`, laptop keyboards without a Right Ctrl, AltGr layouts,
IME candidates and compositor bindings must be checked natively ([VALIDATION](../VALIDATION.md#v06-qualification)).
