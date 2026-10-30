import { matchesHeld } from "./keybindings";
import type { Edge } from "./model";

/** The physical key that, held, turns the arrows into focus moves between panels. */
export type Modifier = "ControlRight" | "ControlLeft" | "AltLeft";
export const DEFAULT_MODIFIER: Modifier = "ControlRight";
export const modifiers: { value: Modifier; label: string; warning?: string }[] =
  [
    { value: "ControlRight", label: "Right Ctrl" },
    {
      value: "ControlLeft",
      label: "Left Ctrl",
      warning:
        "Left Ctrl+arrows then move focus: they no longer move the cursor by word.",
    },
    {
      value: "AltLeft",
      label: "Left Alt",
      warning: "Left Alt+arrows then move focus.",
    },
  ];
export const modifierLabel = (modifier: Modifier) =>
  modifiers.find((m) => m.value === modifier)!.label;

export type Command = { kind: "focus"; edge: Edge };
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
/** The workspace command for a key pressed while the physical modifier is held. Only the
 * arrows are taken; everything else, including other Right Ctrl combinations, stays with
 * the focused module. */
export function command(
  event: Keys,
  modifier: Modifier,
  held: boolean,
): Command | null {
  if (!held || !modifierDown(event, modifier) || event.metaKey) return null;
  // The other modifier must not be down: Ctrl+Alt+arrows add cursors.
  if (modifier === "AltLeft" ? event.ctrlKey : event.altKey) return null;
  const edge = directions.find(([id]) => matchesHeld(event, id))?.[1];
  return edge ? { kind: "focus", edge } : null;
}
/** Ctrl+Shift held (and nothing else): a pointer on a panel's grip moves the whole panel. */
export const moveKeys = (event: Keys) =>
  event.ctrlKey &&
  event.shiftKey &&
  !event.altKey &&
  !event.metaKey &&
  !event.getModifierState("AltGraph");
