import { useSyncExternalStore } from "react";
import { IDE_FONT_SIZE, type FontSizes } from "../services/preferences";

/**
 * The font size of the modules other than the IDE (`ideZoom.ts`), from Workspace Settings.
 * As in the IDE, a module's text, tabs and rows follow it: each size sets `--zoom-<module>`,
 * which App.css gives a module's panels as their `--ide-zoom`, and `--font-size-<module>`, the
 * size of its editor's text in whole pixels. The panel keeps the size from the CSS variables,
 * since a menu or a floating panel inside it inherits them.
 */
const MODULES: Record<keyof FontSizes, string> = {
  textEditor: "text-editor",
  terminal: "terminal",
  fileManager: "file-manager",
  tasks: "tasks",
  notes: "notes",
};
let zooms: Record<keyof FontSizes, number> = {
  textEditor: 1,
  terminal: 1,
  fileManager: 1,
  tasks: 1,
  notes: 1,
};
const listeners = new Set<() => void>();

export function applyFontSizes(sizes: FontSizes) {
  const root = document.documentElement;
  let changed = false;
  const next = { ...zooms };
  for (const module of Object.keys(MODULES) as (keyof FontSizes)[]) {
    const zoom = sizes[module] / IDE_FONT_SIZE.default;
    if (zoom === zooms[module]) continue;
    changed = true;
    next[module] = zoom;
    root.style.setProperty(`--zoom-${MODULES[module]}`, String(zoom));
    root.style.setProperty(
      `--font-size-${MODULES[module]}`,
      `${sizes[module]}px`,
    );
  }
  if (!changed) return;
  zooms = next;
  // CodeMirror measures its lines again on a window resize.
  window.dispatchEvent(new Event("resize"));
  listeners.forEach((fn) => fn());
}
export function onModuleZoom(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const useModuleZoom = (module: keyof FontSizes) =>
  useSyncExternalStore(onModuleZoom, () => zooms[module]);
