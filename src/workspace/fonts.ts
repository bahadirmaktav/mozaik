import type { FontPreferences } from "../services/preferences";

/** The modules with their own font setting; each sets `--font-<module>` while chosen. */
export const FONT_MODULES = [
  "textEditor",
  "ide",
  "terminal",
  "fileManager",
  "tasks",
  "notes",
] as const;
export type FontModule = (typeof FONT_MODULES)[number];
const VARIABLE: Record<FontModule, string> = {
  textEditor: "--font-text-editor",
  ide: "--font-ide",
  terminal: "--font-terminal",
  fileManager: "--font-file-manager",
  tasks: "--font-tasks",
  notes: "--font-notes",
};
export const UI_FONT = "system-ui, sans-serif";
export const CODE_FONT = 'Consolas, "Liberation Mono", monospace';
const CODE = new Set<FontModule>(["textEditor", "ide", "terminal"]);
/** The Terminal's own stack: installed Nerd Fonts first so prompt icons render. */
export const TERMINAL_FONT =
  '"CaskaydiaCove Nerd Font Mono", "CaskaydiaCove NFM", "JetBrainsMono Nerd Font Mono", ' +
  '"JetBrainsMono NFM", Consolas, "Liberation Mono", "DejaVu Sans Mono", ' +
  '"Symbols Nerd Font Mono", monospace';
const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
]);

/** A font setting is one family name; these characters could leave the CSS value. */
export const validFont = (name: string) =>
  name.length <= 100 && !/[\p{Cc}"'\\;:{}()<>,]/u.test(name);
const family = (name: string) =>
  GENERIC.has(name.toLowerCase()) ? name : `"${name}"`;

/**
 * The font each module uses, or null where it keeps its own default. With "all" the
 * General font replaces every module's own choice.
 */
export function moduleFonts(
  fonts: FontPreferences,
): Record<FontModule, string | null> {
  const chosen = (name: string | null) =>
    name && validFont(name) ? name : null;
  const ui = chosen(fonts.ui);
  return Object.fromEntries(
    FONT_MODULES.map((module) => [
      module,
      fonts.all && ui ? ui : chosen(fonts[module]),
    ]),
  ) as Record<FontModule, string | null>;
}

/** The CSS variables for the chosen fonts; null removes a variable (the default applies). */
export function fontVariables(fonts: FontPreferences) {
  const ui = fonts.ui && validFont(fonts.ui) ? fonts.ui : null;
  const modules = moduleFonts(fonts);
  const variables: Record<string, string | null> = {
    "--font-ui": ui ? `${family(ui)}, ${UI_FONT}` : UI_FONT,
  };
  for (const module of FONT_MODULES) {
    const name = modules[module];
    // A family that is not installed falls back to the module's kind of font.
    variables[VARIABLE[module]] = name
      ? `${family(name)}, ${CODE.has(module) ? CODE_FONT : UI_FONT}`
      : null;
  }
  return variables;
}
/** The xterm.js font of every terminal. */
export function terminalFont(fonts: FontPreferences) {
  const name = moduleFonts(fonts).terminal;
  return name ? `${family(name)}, ${TERMINAL_FONT}` : TERMINAL_FONT;
}

const SAMPLE = "mmmmmmmmmmlliWW@#10";
let canvas: CanvasRenderingContext2D | null | undefined;
/** Whether a family is installed: its text measures differently from the fallbacks. */
export function installed(name: string) {
  if (!validFont(name)) return false;
  if (GENERIC.has(name.toLowerCase())) return true;
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return true;
  const context = canvas;
  return ["monospace", "serif", "sans-serif"].some((fallback) => {
    context.font = `40px ${fallback}`;
    const base = context.measureText(SAMPLE).width;
    context.font = `40px "${name}", ${fallback}`;
    return context.measureText(SAMPLE).width !== base;
  });
}
/** Common families offered in the font fields; only the installed ones are listed. */
const CANDIDATES = [
  "Cascadia Code",
  "Cascadia Mono",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaCove Nerd Font Mono",
  "Consolas",
  "Courier New",
  "DejaVu Sans Mono",
  "Fira Code",
  "Fira Mono",
  "FiraCode Nerd Font",
  "Hack",
  "Hack Nerd Font",
  "IBM Plex Mono",
  "Iosevka",
  "JetBrains Mono",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "Liberation Mono",
  "Lucida Console",
  "MesloLGS NF",
  "Monaspace Neon",
  "Noto Sans Mono",
  "Roboto Mono",
  "Source Code Pro",
  "Ubuntu Mono",
  "Victor Mono",
  "Arial",
  "Calibri",
  "Cantarell",
  "DejaVu Sans",
  "Inter",
  "Liberation Sans",
  "Noto Sans",
  "Open Sans",
  "Roboto",
  "Segoe UI",
  "Segoe UI Variable",
  "Tahoma",
  "Ubuntu",
  "Verdana",
];
let available: string[] | undefined;
export const installedFonts = () =>
  (available ??= CANDIDATES.filter(installed));

// The lazy terminal runtime follows the font without being loaded by the settings.
let currentTerminal = TERMINAL_FONT;
const listeners = new Set<(font: string) => void>();
export const currentTerminalFont = () => currentTerminal;
export function onTerminalFont(fn: (font: string) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Puts the fonts into the page; editors measure again and terminals refit. */
export function applyFonts(fonts: FontPreferences) {
  const root = document.documentElement;
  const variables = fontVariables(fonts);
  const before = root.style.cssText;
  for (const [name, value] of Object.entries(variables))
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  // CodeMirror measures its lines again on a window resize.
  if (root.style.cssText !== before) window.dispatchEvent(new Event("resize"));
  const terminal = terminalFont(fonts);
  if (terminal !== currentTerminal) {
    currentTerminal = terminal;
    listeners.forEach((fn) => fn(terminal));
  }
}
