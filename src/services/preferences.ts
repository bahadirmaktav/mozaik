import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { native } from "./native";
import type { PinsPlacement } from "./pins";

/** Font family names from Workspace Settings; null keeps the default. */
export interface FontPreferences {
  /** The interface font; modules without their own font follow it. */
  ui: string | null;
  /** The interface font replaces every module's own font. */
  all: boolean;
  textEditor: string | null;
  ide: string | null;
  terminal: string | null;
  fileManager: string | null;
  tasks: string | null;
  notes: string | null;
}
export const defaultFonts: FontPreferences = {
  ui: null,
  all: false,
  textEditor: null,
  ide: null,
  terminal: null,
  fileManager: null,
  tasks: null,
  notes: null,
};
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
  /** The notes folder: notes are its Markdown files, groups its subfolders. */
  notesFolder: string | null;
  fonts: FontPreferences;
  /** A PowerShell script new PowerShell terminals run after the profile (the prompt). */
  powershellPrompt: string | null;
  /** The color theme (`workspace/themes.ts`). */
  theme: string;
  /** The text size of the IDE's code editors, in pixels (IDE: Zoom In/Out). */
  ideFontSize: number;
  /** The IDE features turned off (`plugins/ide/features.ts`). */
  ideDisabledFeatures: string[];
  /** The Explorer's file icon theme (`plugins/ide/fileIcons.tsx`). */
  ideIconTheme: string;
  /** The Code Editor's minimap at the right of the code. */
  ideMinimap: boolean;
  /** The C/C++ highlighting colors (`plugins/ide/cppThemes.ts`). */
  ideCppTheme: string;
  /** The size of the command palette and the launcher, in percent. */
  paletteSize: number;
  /** Where a File Manager shows pinned items. */
  pinsPlacement: PinsPlacement;
}
/** The IDE's text sizes, in pixels: the default and the range zooming stays in. */
export const IDE_FONT_SIZE = { default: 13, min: 8, max: 32 };
export const PALETTE_SIZE = { default: 100, min: 80, max: 200, step: 10 };
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
  notesFolder: null,
  fonts: defaultFonts,
  powershellPrompt: null,
  theme: "mozaik-dark",
  ideFontSize: IDE_FONT_SIZE.default,
  ideDisabledFeatures: [],
  ideIconTheme: "seti",
  ideMinimap: true,
  ideCppTheme: "follow",
  paletteSize: PALETTE_SIZE.default,
  pinsPlacement: "menu",
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
  /** A .ps1 file from the native dialog, or null when cancelled. */
  choosePrompt: () => native<string | null>("choose_prompt_file"),
  onChange: (fn: (preferences: Preferences) => void) =>
    isTauri()
      ? listen<Preferences>("preferences-changed", (event) => fn(event.payload))
      : Promise.resolve(() => {}),
};
