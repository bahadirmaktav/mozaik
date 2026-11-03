import { useSyncExternalStore } from "react";

/**
 * The IDE's zoom (IDE: Zoom In/Out), as in VS Code: the code text size over its default.
 * App sets it from `ideFontSize`; every IDE panel scales its text, icons, rows, bars and
 * spacing by it (`--ide-zoom` in App.css), its docked bars grow with it
 * (`plugins/registry.ts`) and its terminals take it as their font size.
 */
let zoom = 1;
const listeners = new Set<() => void>();

export const ideZoom = () => zoom;
export function setIdeZoom(next: number) {
  if (next === zoom) return;
  zoom = next;
  document.documentElement.style.setProperty("--ide-zoom-level", String(next));
  for (const listener of listeners) listener();
}
export function onIdeZoom(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const useIdeZoom = () => useSyncExternalStore(onIdeZoom, ideZoom);
