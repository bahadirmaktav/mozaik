import type { Edge } from "./model";

/** The physical key that, held, turns K and the arrows into workspace commands. */
export type Modifier = "ControlRight" | "ControlLeft" | "AltLeft";
export const DEFAULT_MODIFIER: Modifier = "ControlRight";
export const modifiers: { value: Modifier; label: string; warning?: string }[] =
  [
    { value: "ControlRight", label: "Right Ctrl" },
    {
      value: "ControlLeft",
      label: "Left Ctrl",
      warning:
        "Left Ctrl+K and Left Ctrl+arrows then belong to the workspace, not to editors or drawings.",
    },
    {
      value: "AltLeft",
      label: "Left Alt",
      warning:
        "Left Alt+arrows then move focus; some window managers also use Alt.",
    },
  ];
export const modifierLabel = (modifier: Modifier) =>
  modifiers.find((m) => m.value === modifier)!.label;

export type Command = { kind: "launcher" } | { kind: "focus"; edge: Edge };
const directions: Record<string, Edge> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "top",
  ArrowDown: "bottom",
};
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
  if (
    !held ||
    !modifierDown(event, modifier) ||
    event.shiftKey ||
    event.metaKey
  )
    return null;
  // The other modifier must not be down: Ctrl+Alt+K is a different shortcut.
  if (modifier === "AltLeft" ? event.ctrlKey : event.altKey) return null;
  const key = event.key.toLowerCase();
  // Layouts without Latin letters report another key; fall back to the K position.
  if (key === "k" || (!/^[a-z]$/.test(key) && event.code === "KeyK"))
    return { kind: "launcher" };
  const edge = directions[event.key];
  return edge ? { kind: "focus", edge } : null;
}
