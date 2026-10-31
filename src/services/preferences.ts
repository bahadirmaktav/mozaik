import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { native } from "./native";

/** App-wide choices from Workspace Settings (see `preferences.rs`). */
export interface Preferences {
  /** Shortcut ID to keys, only where they differ from the default. */
  keybindings: Record<string, string>;
  /** Opacity of the window's contents, from 0.3 to 1. */
  opacity: number;
  /** The comment tags the IDE's TODO view lists and the code editor highlights. */
  todoTags: string[];
  /** Text Editor lines wrap at the panel width, keeping their number and indentation. */
  wordWrap: boolean;
  /** The folder new terminals start in; null is the home folder. */
  terminalFolder: string | null;
  /** The folder a new File Manager panel shows; null is the home folder. */
  fileManagerFolder: string | null;
}
export const DEFAULT_TODO_TAGS = [
  "TODO",
  "FIXME",
  "BUG",
  "HACK",
  "XXX",
  "NOTE",
  "INFO",
];
export const defaultPreferences: Preferences = {
  keybindings: {},
  opacity: 1,
  todoTags: DEFAULT_TODO_TAGS,
  wordWrap: true,
  terminalFolder: null,
  fileManagerFolder: null,
};

// Outside the desktop app the choices last for the page, so the settings stay usable.
let memory = defaultPreferences;
/** Typed adapter for the native preference commands; every window follows a change. */
export const preferencesBackend = {
  get: () =>
    isTauri()
      ? native<Preferences>("get_preferences")
      : Promise.resolve(memory),
  set: (preferences: Preferences) =>
    isTauri()
      ? native<Preferences>("set_preferences", { preferences })
      : Promise.resolve((memory = preferences)),
  /** A folder from the native dialog, or null when cancelled. */
  chooseFolder: () => native<string | null>("choose_start_folder"),
  onChange: (fn: (preferences: Preferences) => void) =>
    isTauri()
      ? listen<Preferences>("preferences-changed", (event) => fn(event.payload))
      : Promise.resolve(() => {}),
};
