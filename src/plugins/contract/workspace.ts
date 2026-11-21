/**
 * What the workspace (the App) does for modules. A module never imports another module: it
 * asks the workspace, which knows the panels and which module handles what, and the App sets
 * each handler here (docs/decisions/034-module-boundaries.md).
 */

/**
 * Text files other modules (the File Manager) open in a Text Editor: in the panel they were
 * dropped on, else in a Text Editor panel of the workspace, else as a tab in the panel of the
 * tab `from` (the File Manager it came from), else in a new panel beside.
 */
export interface TextOpener {
  open(paths: string[], panelId?: string, from?: string): void;
  /** A new Text Editor panel with the folder at its left. */
  openFolder(directory: string): void;
  /** Whether a drop on this panel opens files there: it shows a Text Editor. */
  accepts(panelId: string): boolean;
}
/** Files a module opens in its own tabs (drawings, diagrams), by extension. */
export interface ModuleFiles {
  isPath(path: string): boolean;
  /** Opens the file in its module, which focuses a tab already showing it. */
  requestOpen(path: string): void;
}
export interface PickItem {
  id: string;
  label: string;
  detail?: string;
}
export type Picker = (
  title: string,
  items: PickItem[],
  options?: { selected?: string },
) => Promise<string | null>;

interface Handlers {
  text: TextOpener | null;
  terminal: ((directory: string) => void) | null;
  files: ModuleFiles[];
  pick: Picker | null;
}
const handlers: Handlers = {
  text: null,
  terminal: null,
  files: [],
  pick: null,
};

export function setTextOpener(opener: TextOpener | null) {
  handlers.text = opener;
}
export function setTerminalOpener(
  opener: ((directory: string) => void) | null,
) {
  handlers.terminal = opener;
}
export function setModuleFiles(files: ModuleFiles[]) {
  handlers.files = files;
}
export function setPicker(picker: Picker | null) {
  handlers.pick = picker;
}

export const textFiles = {
  /** False without an opener; the caller then opens the files as before. */
  open(paths: string[], panelId?: string, from?: string) {
    if (!handlers.text) return false;
    handlers.text.open(paths, panelId, from);
    return true;
  },
  accepts: (panelId: string) => handlers.text?.accepts(panelId) ?? false,
  /** False without an opener. */
  openFolder(directory: string) {
    if (!handlers.text) return false;
    handlers.text.openFolder(directory);
    return true;
  },
};
/**
 * How other modules open a terminal in a folder (the File Manager's Open in Terminal): the
 * workspace adds it as a tab of a Terminal panel, or a new panel beside.
 */
export const terminals = {
  /** Returns false when no workspace takes terminals (nothing is opened). */
  open(directory: string) {
    if (!handlers.terminal) return false;
    handlers.terminal(directory);
    return true;
  },
};
export const moduleFiles = {
  /** Opens the file in its module; false when no module takes it. */
  open(path: string) {
    const files = handlers.files.find((f) => f.isPath(path));
    files?.requestOpen(path);
    return Boolean(files);
  },
};
/** A choice from a list in the command palette; null when cancelled or without a workspace. */
export function pick(
  title: string,
  items: PickItem[],
  options?: { selected?: string },
) {
  return handlers.pick?.(title, items, options) ?? Promise.resolve(null);
}
