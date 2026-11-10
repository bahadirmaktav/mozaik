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
/** The modules' font sizes in pixels; the IDE has its own (`ideFontSize`). */
export interface FontSizes {
  textEditor: number;
  terminal: number;
  fileManager: number;
  tasks: number;
  notes: number;
}
export const defaultFontSizes: FontSizes = {
  textEditor: 13,
  terminal: 13,
  fileManager: 13,
  tasks: 13,
  notes: 13,
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
  fontSizes: FontSizes;
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
  /** The minimap's width in pixels at the IDE's default zoom. */
  ideMinimapWidth: number;
  /** How large the minimap draws the code: 1 to 3 times its smallest size. */
  ideMinimapScale: number;
  /** The C/C++ highlighting colors (`plugins/ide/cppThemes.ts`). */
  ideCppTheme: string;
  /** Comparisons open with only their changes, the unchanged lines folded. */
  ideDiffChangesOnly: boolean;
  /** The size of the command palette and the launcher, in percent. */
  paletteSize: number;
  /** Where a File Manager shows pinned items. */
  pinsPlacement: PinsPlacement;
}
/** The IDE's text sizes, in pixels: the default and the range zooming stays in. */
export const IDE_FONT_SIZE = { default: 13, min: 8, max: 32 };
export const MINIMAP_WIDTH = { default: 72, min: 40, max: 240, step: 8 };
export const MINIMAP_SCALES = [1, 2, 3];
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
  fontSizes: defaultFontSizes,
  powershellPrompt: null,
  theme: "mozaik-dark",
  ideFontSize: IDE_FONT_SIZE.default,
  ideDisabledFeatures: [],
  ideIconTheme: "seti",
  ideMinimap: true,
  ideMinimapWidth: MINIMAP_WIDTH.default,
  ideMinimapScale: 1,
  ideDiffChangesOnly: false,
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
