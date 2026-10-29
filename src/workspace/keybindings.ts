import { useSyncExternalStore } from "react";

/**
 * Every shortcut Tessera defines, rebindable in Workspace Settings. A key is written as
 * `Ctrl+Shift+S`: modifiers (`Ctrl`, `Alt`, `Shift`, and `Mod` for the held workspace key),
 * then one key by its `KeyboardEvent.key` name (letters upper case). An empty key is
 * unbound. `fixed` ones are listed for reference only.
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
    keys: "Mod+K",
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
    id: "palette",
    scope: "Workspace",
    label: "Command palette",
    keys: "Ctrl+Shift+P",
  },
  { id: "new", scope: "Workspace", label: "New text tab", keys: "Ctrl+N" },
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
  { id: "settings", scope: "Workspace", label: "Settings", keys: "Ctrl+," },
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
    scope: "Code Editor",
    label: "Expand line selection",
    keys: "Ctrl+L",
  },
  {
    id: "code.cursor.up",
    scope: "Code Editor",
    label: "Add cursor above",
    keys: "Ctrl+Alt+ArrowUp",
  },
  {
    id: "code.cursor.down",
    scope: "Code Editor",
    label: "Add cursor below",
    keys: "Ctrl+Alt+ArrowDown",
  },
  {
    id: "code.cursor.click",
    scope: "Code Editor",
    label: "Add cursor",
    keys: "Alt+Click",
    fixed: true,
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
  {
    id: "items.delete",
    scope: "Tasks and Notes",
    label: "Delete",
    keys: "Delete",
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
/** Replaces the user's changes (shortcut ID to keys); unknown or fixed IDs are ignored. */
export function setCustom(custom: Record<string, string>) {
  store.custom = Object.fromEntries(
    Object.entries(custom).filter(
      ([id]) => shortcuts.find((s) => s.id === id && !s.fixed) !== undefined,
    ),
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
/** The key's name as bindings write it; layouts without Latin letters use the position. */
export function keyName(event: Pick<KeyboardEvent, "key" | "code">) {
  if (event.key.length !== 1) return event.key === "Spacebar" ? " " : event.key;
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  if (/^Key[A-Z]$/.test(event.code) && /\p{L}/u.test(event.key))
    return event.code.slice(3);
  return event.key;
}
/** Whether a key event is the shortcut. Workspace-key (`Mod`) shortcuts never match here. */
export function matches(event: Keys, id: string) {
  const combo = parse(keysOf(id));
  if (!combo || combo.mod || event.metaKey) return false;
  // AltGr reads as Ctrl+Alt: a typed character is never a shortcut.
  if (event.getModifierState("AltGraph") && event.key.length === 1)
    return false;
  return (
    event.ctrlKey === combo.ctrl &&
    event.altKey === combo.alt &&
    event.shiftKey === combo.shift &&
    keyName(event) === combo.key
  );
}
/** The keys of a workspace-key shortcut, pressed while that key is held. */
export function matchesHeld(event: Keys, id: string) {
  const combo = parse(keysOf(id));
  if (!combo?.mod) return false;
  return event.shiftKey === combo.shift && keyName(event) === combo.key;
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
/** For menus and the settings list: `Mod` is the workspace key's own name. */
export function label(keys: string, workspaceKey: string) {
  return keys
    .split("+")
    .map((part) =>
      part === "Mod"
        ? workspaceKey
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
        own.scope === "Workspace"),
  );
}
