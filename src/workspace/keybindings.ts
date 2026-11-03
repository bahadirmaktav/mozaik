import { useSyncExternalStore } from "react";

/**
 * Every shortcut Mozaik defines, rebindable in Workspace Settings. A key is written as
 * `Ctrl+Shift+S`: modifiers (`Ctrl`, `Alt`, `Shift`, and `Mod` for the held workspace key),
 * then one key by its `KeyboardEvent.key` name (letters upper case), or by its position in
 * brackets (`[Quote]`, a `KeyboardEvent.code`) where the key types different characters on
 * different layouts. A chord is two such keys pressed one after the other, written with a
 * space (`Ctrl+K Ctrl+C`, as in VS Code).
 * An empty key is unbound. `fixed` ones are listed for reference only.
 */
export type Scope =
  | "Workspace"
  | "Editors"
  | "Code Editor"
  | "File Manager"
  | "Tasks and Notes"
  | "Terminal";
export interface Shortcut {
  id: string;
  scope: Scope;
  label: string;
  keys: string;
  fixed?: boolean;
}
export const shortcuts: Shortcut[] = [
  {
    id: "launcher",
    scope: "Workspace",
    label: "Add to workspace",
    // VS Code's oem_7, a key position: ' on US, i on Turkish Q, Ä on German.
    keys: "Ctrl+Shift+[Quote]",
  },
  {
    id: "focus.left",
    scope: "Workspace",
    label: "Focus left",
    keys: "Mod+ArrowLeft",
  },
  {
    id: "focus.right",
    scope: "Workspace",
    label: "Focus right",
    keys: "Mod+ArrowRight",
  },
  {
    id: "focus.up",
    scope: "Workspace",
    label: "Focus up",
    keys: "Mod+ArrowUp",
  },
  {
    id: "focus.down",
    scope: "Workspace",
    label: "Focus down",
    keys: "Mod+ArrowDown",
  },
  {
    id: "module.close",
    scope: "Workspace",
    label: "Close panel",
    keys: "Ctrl+Shift+C",
  },
  {
    id: "window.close",
    scope: "Workspace",
    label: "Close window",
    keys: "Ctrl+Shift+E",
  },
  {
    id: "palette",
    scope: "Workspace",
    label: "Command palette",
    keys: "Ctrl+Shift+P",
  },
  { id: "new", scope: "Workspace", label: "New file", keys: "Ctrl+N" },
  {
    id: "new.split",
    scope: "Workspace",
    label: "New text split",
    keys: "Ctrl+Shift+N",
  },
  { id: "open", scope: "Workspace", label: "Open file", keys: "Ctrl+O" },
  { id: "save", scope: "Workspace", label: "Save", keys: "Ctrl+S" },
  { id: "save.as", scope: "Workspace", label: "Save as", keys: "Ctrl+Shift+S" },
  { id: "close", scope: "Workspace", label: "Close tab", keys: "Ctrl+W" },
  { id: "window", scope: "Workspace", label: "New window", keys: "Ctrl+Alt+N" },
  {
    id: "settings",
    scope: "Workspace",
    label: "Workspace settings",
    // VS Code's oem_comma: the key that types a comma, wherever the layout puts it.
    keys: "Ctrl+Shift+,",
  },
  {
    id: "view.terminal",
    scope: "Workspace",
    label: "Toggle IDE terminal",
    keys: "Ctrl+`",
  },
  {
    id: "ide.zoom.in",
    scope: "Code Editor",
    label: "Zoom in",
    // `+` is whichever key types it: Shift+= on US, Shift+4 on Turkish Q, the keypad.
    keys: "Ctrl+Shift++",
  },
  {
    id: "ide.zoom.out",
    scope: "Code Editor",
    label: "Zoom out",
    keys: "Ctrl+Shift+-",
  },
  { id: "editor.line", scope: "Editors", label: "Go to line", keys: "Ctrl+G" },
  {
    id: "palette.files",
    scope: "Code Editor",
    label: "Go to file",
    keys: "Ctrl+P",
  },
  {
    id: "palette.symbols",
    scope: "Code Editor",
    label: "Go to symbol in editor",
    keys: "Ctrl+Shift+O",
  },
  {
    id: "code.definition",
    scope: "Code Editor",
    label: "Go to definition",
    keys: "F12",
  },
  {
    id: "code.definition.click",
    scope: "Code Editor",
    label: "Go to definition",
    keys: "Ctrl+Click",
    fixed: true,
  },
  {
    id: "code.references",
    scope: "Code Editor",
    label: "Find references",
    keys: "Shift+F12",
  },
  {
    id: "code.rename",
    scope: "Code Editor",
    label: "Rename symbol",
    keys: "F2",
  },
  {
    id: "code.line",
    scope: "Editors",
    label: "Expand line selection",
    keys: "Ctrl+L",
  },
  {
    id: "code.next",
    scope: "Editors",
    label: "Add selection to next find match",
    keys: "Ctrl+D",
  },
  {
    id: "code.comment.add",
    scope: "Editors",
    label: "Add line comment",
    keys: "Ctrl+K Ctrl+C",
  },
  {
    id: "code.comment.remove",
    scope: "Editors",
    label: "Remove line comment",
    keys: "Ctrl+K Ctrl+U",
  },
  {
    id: "code.cursor.up",
    scope: "Editors",
    label: "Add cursor above",
    keys: "Ctrl+Alt+ArrowUp",
  },
  {
    id: "code.cursor.down",
    scope: "Editors",
    label: "Add cursor below",
    keys: "Ctrl+Alt+ArrowDown",
  },
  {
    id: "code.cursor.click",
    scope: "Editors",
    label: "Add cursor",
    keys: "Alt+Click",
    fixed: true,
  },
  {
    id: "code.back",
    scope: "Code Editor",
    label: "Go back",
    keys: "Alt+ArrowLeft",
  },
  {
    id: "code.forward",
    scope: "Code Editor",
    label: "Go forward",
    keys: "Alt+ArrowRight",
  },
  {
    id: "code.header",
    scope: "Code Editor",
    label: "Switch header/source",
    keys: "Alt+O",
  },
  {
    id: "files.path",
    scope: "File Manager",
    label: "Edit path",
    keys: "Ctrl+L",
  },
  { id: "files.refresh", scope: "File Manager", label: "Refresh", keys: "F5" },
  {
    id: "files.up",
    scope: "File Manager",
    label: "Parent folder",
    keys: "Backspace",
  },
  {
    id: "files.back",
    scope: "File Manager",
    label: "Back",
    keys: "Alt+ArrowLeft",
  },
  {
    id: "files.forward",
    scope: "File Manager",
    label: "Forward",
    keys: "Alt+ArrowRight",
  },
  { id: "files.rename", scope: "File Manager", label: "Rename", keys: "F2" },
  {
    id: "files.trash",
    scope: "File Manager",
    label: "Move to Trash",
    keys: "Delete",
  },
  {
    id: "files.delete",
    scope: "File Manager",
    label: "Delete permanently",
    keys: "Shift+Delete",
  },
  {
    id: "files.all",
    scope: "File Manager",
    label: "Select all",
    keys: "Ctrl+A",
  },
  { id: "files.copy", scope: "File Manager", label: "Copy", keys: "Ctrl+C" },
  { id: "files.cut", scope: "File Manager", label: "Cut", keys: "Ctrl+X" },
  { id: "files.paste", scope: "File Manager", label: "Paste", keys: "Ctrl+V" },
  // One history of file operations for every File Manager and the IDE Explorer.
  {
    id: "files.undo",
    scope: "File Manager",
    label: "Undo file operation",
    keys: "Ctrl+Z",
  },
  {
    id: "files.redo",
    scope: "File Manager",
    label: "Redo file operation",
    keys: "Ctrl+Y",
  },
  // The IDE Explorer's tree (not its code editors), sharing the File Manager's clipboard.
  {
    id: "explorer.copy",
    scope: "Code Editor",
    label: "Explorer: copy files",
    keys: "Ctrl+C",
  },
  {
    id: "explorer.cut",
    scope: "Code Editor",
    label: "Explorer: cut files",
    keys: "Ctrl+X",
  },
  {
    id: "explorer.paste",
    scope: "Code Editor",
    label: "Explorer: paste files",
    keys: "Ctrl+V",
  },
  {
    id: "explorer.undo",
    scope: "Code Editor",
    label: "Explorer: undo file operation",
    keys: "Ctrl+Z",
  },
  {
    id: "explorer.redo",
    scope: "Code Editor",
    label: "Explorer: redo file operation",
    keys: "Ctrl+Y",
  },
  {
    id: "explorer.all",
    scope: "Code Editor",
    label: "Explorer: select all",
    keys: "Ctrl+A",
  },
  {
    id: "items.delete",
    scope: "Tasks and Notes",
    label: "Delete",
    keys: "Delete",
  },
  {
    id: "items.rename",
    scope: "Tasks and Notes",
    label: "Rename",
    keys: "F2",
  },
  {
    id: "items.up",
    scope: "Tasks and Notes",
    label: "Move up",
    keys: "Ctrl+ArrowUp",
  },
  {
    id: "items.down",
    scope: "Tasks and Notes",
    label: "Move down",
    keys: "Ctrl+ArrowDown",
  },
  {
    id: "terminal.copy",
    scope: "Terminal",
    label: "Copy (with a selection)",
    keys: "Ctrl+C",
    fixed: true,
  },
  {
    id: "terminal.paste",
    scope: "Terminal",
    label: "Paste",
    keys: "Ctrl+Shift+V",
    fixed: true,
  },
];
export const scopes = [...new Set(shortcuts.map((s) => s.scope))];

const store = {
  custom: {} as Record<string, string>,
  listeners: new Set<() => void>(),
  version: 0,
};
export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => {
    store.listeners.delete(fn);
  };
}
export function useKeybindings() {
  useSyncExternalStore(subscribe, () => store.version);
  return store.custom;
}
/** Replaces the user's changes (shortcut ID to keys); unknown or fixed IDs are ignored, and
 * so are workspace-key keys for a shortcut that no longer uses the workspace key (the
 * launcher and closing were `Mod+…` before). */
export function setCustom(custom: Record<string, string>) {
  store.custom = Object.fromEntries(
    Object.entries(custom).filter(([id, keys]) => {
      const shortcut = shortcuts.find((s) => s.id === id && !s.fixed);
      return (
        !!shortcut &&
        (!keys || keys.startsWith("Mod+") === shortcut.keys.startsWith("Mod+"))
      );
    }),
  );
  store.version++;
  store.listeners.forEach((fn) => fn());
}
export const customBindings = () => store.custom;
/** The keys of a shortcut with the user's changes, or with `custom` (an unsaved draft). */
export function keysOf(id: string, custom = store.custom) {
  const shortcut = shortcuts.find((s) => s.id === id);
  if (!shortcut) return "";
  return shortcut.fixed ? shortcut.keys : (custom[id] ?? shortcut.keys);
}

type Combo = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  mod: boolean;
  key: string;
};
export function parse(keys: string): Combo | null {
  if (!keys) return null;
  const parts = keys.split("+");
  // `Ctrl++` would name the plus key.
  const key = parts.pop() || (parts.pop(), "+");
  return {
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    mod: parts.includes("Mod"),
    key,
  };
}
type Keys = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
> & { getModifierState(key: string): boolean };
// The unshifted character of each key position, from the WebView where it can tell
// (Chromium: WebView2), else the US layout.
const US: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  IntlBackslash: "<",
  Minus: "-",
  Equal: "=",
  ...Object.fromEntries(
    [..."0123456789"].map((digit) => [`Digit${digit}`, digit]),
  ),
};
let layout: { get(code: string): string | undefined } | null = null;
function loadLayout() {
  const keyboard = (
    globalThis.navigator as {
      keyboard?: { getLayoutMap?(): Promise<typeof layout> };
    }
  )?.keyboard;
  void keyboard
    ?.getLayoutMap?.()
    .then((map) => {
      layout = map;
      // Labels of position keys (`[Quote]`) show the layout's character.
      store.version++;
      store.listeners.forEach((fn) => fn());
    })
    .catch(() => {});
}
loadLayout();
// The user may switch layouts while another application has focus.
globalThis.addEventListener?.("focus", loadLayout);
/**
 * The key's name as bindings write it; layouts without Latin letters use the position. The
 * key left of 1 is always "`" (it types `"` on Turkish Q), as VS Code's Ctrl+` reads it.
 * With Shift a punctuation or digit key keeps its unshifted name: Ctrl+Shift+, is the comma
 * key, although Shift makes it type `<` (US) or `;` (Turkish Q).
 */
export function keyName(
  event: Pick<KeyboardEvent, "key" | "code"> & { shiftKey?: boolean },
) {
  if (event.key.length !== 1) return event.key === "Spacebar" ? " " : event.key;
  if (event.code === "Backquote") return "`";
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  if (/^Key[A-Z]$/.test(event.code) && /\p{L}/u.test(event.key))
    return event.code.slice(3);
  // Other letter keys (Turkish ö, ç…) are named by their letter.
  if (/\p{L}/u.test(event.key)) return event.key;
  if (event.shiftKey) {
    const mapped = layout?.get(event.code);
    const base =
      mapped?.length === 1 && !/\p{L}/u.test(mapped) ? mapped : US[event.code];
    if (base) return base;
  }
  return event.key;
}
/** The keys of a chord (`Ctrl+K Ctrl+C`); one entry for other shortcuts. */
export function chordParts(keys: string) {
  // A space between two keys separates them; `Ctrl+ ` is the space key.
  return keys.split(/(?<=\S) (?=\S)/);
}
/**
 * Whether a key event is the shortcut. Workspace-key (`Mod`) shortcuts and chords never
 * match here (see `chordStart`).
 */
export function matches(event: Keys, id: string) {
  const keys = keysOf(id);
  return chordParts(keys).length === 1 && matchesKeys(event, keys);
}
/** The first keys of one of the chords, as written in bindings, or `null`. */
export function chordStart(event: Keys, ids: string[]) {
  for (const id of ids) {
    const parts = chordParts(keysOf(id));
    if (parts.length === 2 && matchesKeys(event, parts[0])) return parts[0];
  }
  return null;
}
/** Whether the key completes the chord `id` that began with `first`. */
export function matchesChord(event: Keys, first: string, id: string) {
  const parts = chordParts(keysOf(id));
  return (
    parts.length === 2 && parts[0] === first && matchesKeys(event, parts[1])
  );
}
function matchesKeys(event: Keys, keys: string) {
  const combo = parse(keys);
  if (!combo || combo.mod || event.metaKey) return false;
  // AltGr reads as Ctrl+Alt: a typed character is never a shortcut.
  if (event.getModifierState("AltGraph") && event.key.length === 1)
    return false;
  return (
    event.ctrlKey === combo.ctrl &&
    event.altKey === combo.alt &&
    event.shiftKey === combo.shift &&
    keyMatches(event, combo.key)
  );
}
const position = (key: string) => /^\[(\w+)\]$/.exec(key)?.[1] ?? null;
function keyMatches(
  event: Pick<KeyboardEvent, "key" | "code"> & { shiftKey?: boolean },
  key: string,
) {
  const code = position(key);
  if (code) return event.code === code;
  // With Shift, keys are named unshifted; `+` itself is found by what the key types.
  return keyName(event) === key || (key === "+" && event.key === "+");
}
/** The keys of a workspace-key shortcut, pressed while that key is held. */
export function matchesHeld(event: Keys, id: string) {
  const combo = parse(keysOf(id));
  if (!combo?.mod) return false;
  return event.shiftKey === combo.shift && keyMatches(event, combo.key);
}
/** The keys pressed, written as a binding; `null` while only modifiers are down. */
export function record(event: Keys): string | null {
  if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(event.key))
    return null;
  return [
    event.ctrlKey && "Ctrl",
    event.altKey && "Alt",
    event.shiftKey && "Shift",
    keyName(event),
  ]
    .filter(Boolean)
    .join("+");
}
/** The character a position key types on the user's layout, as labels show it. */
function positionLabel(code: string) {
  const typed = layout?.get(code) ?? US[code];
  return typed ? typed.toLocaleUpperCase() : code;
}
/** For menus and the settings list: `Mod` is the workspace key's own name. */
export function label(keys: string, workspaceKey: string) {
  return keys
    .split("+")
    .map((part) =>
      part === "Mod"
        ? workspaceKey
        : position(part)
          ? positionLabel(position(part)!)
          : part.startsWith("Arrow")
            ? { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓" }[
                part
              ]
            : part === " "
              ? "Space"
              : part,
    )
    .join("+");
}
/** Other shortcuts that the same keys would also trigger in that place. */
export function conflicts(id: string, keys: string, custom = store.custom) {
  const own = shortcuts.find((s) => s.id === id)!;
  return shortcuts.filter(
    (s) =>
      s.id !== id &&
      keys &&
      keysOf(s.id, custom) === keys &&
      (s.scope === own.scope ||
        s.scope === "Workspace" ||
        own.scope === "Workspace" ||
        // Editing shortcuts apply in the Code Editor too.
        [s.scope, own.scope].every((scope) =>
          ["Editors", "Code Editor"].includes(scope),
        )),
  );
}
