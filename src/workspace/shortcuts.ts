import { matchesHeld } from "./keybindings";
import type { Edge } from "./model";

/** The physical key that, held, turns K, C, E and the arrows into workspace commands. */
export type Modifier = "ControlRight" | "ControlLeft" | "AltLeft";
export const DEFAULT_MODIFIER: Modifier = "ControlRight";
export const modifiers: { value: Modifier; label: string; warning?: string }[] =
  [
    { value: "ControlRight", label: "Right Ctrl" },
    {
      value: "ControlLeft",
      label: "Left Ctrl",
      warning:
        "Left Ctrl+K, C, E and arrows then go to the workspace: Left Ctrl+C no longer copies.",
    },
    {
      value: "AltLeft",
      label: "Left Alt",
      warning: "Left Alt+arrows then move focus.",
    },
  ];
export const modifierLabel = (modifier: Modifier) =>
  modifiers.find((m) => m.value === modifier)!.label;

export type Command =
  | { kind: "launcher" }
  | { kind: "close" }
  | { kind: "quit" }
  | { kind: "focus"; edge: Edge };
const directions: [string, Edge][] = [
  ["focus.left", "left"],
  ["focus.right", "right"],
  ["focus.up", "top"],
  ["focus.down", "bottom"],
];
type Keys = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
> & { getModifierState(key: string): boolean };

export const isModifierKey = (event: Keys, modifier: Modifier) =>
  event.code === modifier;
/** Whether the modifier's logical state is still down; a missed keyup reads false here. */
export function modifierDown(event: Keys, modifier: Modifier) {
  if (event.getModifierState("AltGraph")) return false;
  return modifier === "AltLeft" ? event.altKey : event.ctrlKey;
}
/** The workspace command for a key pressed while the physical modifier is held. Only these
 * combinations are taken; everything else, including other Right Ctrl combinations, stays
 * with the focused module. */
export function command(
  event: Keys,
  modifier: Modifier,
  held: boolean,
): Command | null {
  if (!held || !modifierDown(event, modifier) || event.metaKey) return null;
  // The other modifier must not be down: Ctrl+Alt+K is a different shortcut.
  if (modifier === "AltLeft" ? event.ctrlKey : event.altKey) return null;
  if (matchesHeld(event, "launcher")) return { kind: "launcher" };
  if (matchesHeld(event, "module.close")) return { kind: "close" };
  if (matchesHeld(event, "window.close")) return { kind: "quit" };
  const edge = directions.find(([id]) => matchesHeld(event, id))?.[1];
  return edge ? { kind: "focus", edge } : null;
}
