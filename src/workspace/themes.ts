/**
 * The color themes of Workspace Settings → General → Theme and the palette's Preferences:
 * Color Theme. A theme sets the visual tokens (`styles/tokens.css`), the code highlighting
 * colors (`--syntax-*`) and the terminals' colors on the page; its absence keeps the
 * default, Mozaik Dark.
 */
export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  /** CSS variable (without `--`) to color. */
  colors: Record<string, string>;
}

const DARK_SYNTAX = {
  "syntax-keyword": "#c6a0f6",
  "syntax-type": "#7fd1c7",
  "syntax-function": "#8ab4f8",
  "syntax-string": "#a5d6a7",
  "syntax-number": "#f2b880",
  "syntax-comment": "#7a8494",
  "syntax-meta": "#e2b77e",
  "syntax-property": "#b8c7e0",
  "syntax-invalid": "#f28b82",
};
const LIGHT_SYNTAX = {
  "syntax-keyword": "#8a3fb8",
  "syntax-type": "#17806f",
  "syntax-function": "#2c62b8",
  "syntax-string": "#3d7a2e",
  "syntax-number": "#b35a12",
  "syntax-comment": "#7b828c",
  "syntax-meta": "#946200",
  "syntax-property": "#3d5778",
  "syntax-invalid": "#c0392b",
};

export const DEFAULT_THEME = "mozaik-dark";
export const THEMES: Theme[] = [
  {
    id: "mozaik-dark",
    name: "Mozaik Dark",
    dark: true,
    colors: {
      canvas: "#111316",
      surface: "#1a1d22",
      editor: "#16191e",
      popup: "#252a32",
      hover: "#272c33",
      border: "#30363f",
      text: "#dce0e6",
      muted: "#929ba8",
      accent: "#94b5ab",
      warning: "#e2b77e",
      selected: "#263732",
      selection: "#37564f",
      danger: "#c4554a",
      error: "#f28b82",
      success: "#9ccc9c",
      ...DARK_SYNTAX,
    },
  },
  {
    // Lower contrast and lighter grays: less glare in long sessions.
    id: "mozaik-dim",
    name: "Mozaik Dim",
    dark: true,
    colors: {
      canvas: "#202329",
      surface: "#272b32",
      editor: "#24282e",
      popup: "#333842",
      hover: "#31363e",
      border: "#3b414b",
      text: "#c8cdd5",
      muted: "#8c94a0",
      accent: "#9cbab0",
      warning: "#d8b282",
      selected: "#2f3f3b",
      selection: "#3e5852",
      danger: "#bf5d53",
      error: "#e8948c",
      success: "#9fc49f",
      ...DARK_SYNTAX,
      "syntax-keyword": "#bc9ce6",
      "syntax-comment": "#808896",
    },
  },
  {
    id: "night-blue",
    name: "Night Blue",
    dark: true,
    colors: {
      canvas: "#0e1320",
      surface: "#141a28",
      editor: "#111725",
      popup: "#1f2840",
      hover: "#1d2537",
      border: "#283248",
      text: "#d3dae7",
      muted: "#8693aa",
      accent: "#82b1e0",
      warning: "#e3bd7f",
      selected: "#1c2c45",
      selection: "#294268",
      danger: "#c9564d",
      error: "#f28b82",
      success: "#93c99b",
      ...DARK_SYNTAX,
      "syntax-function": "#79b8ff",
      "syntax-type": "#73d0d6",
      "syntax-comment": "#6f7d95",
    },
  },
  {
    // Warm browns and no bright blue: easy on the eyes at night.
    id: "warm-dark",
    name: "Warm Dark",
    dark: true,
    colors: {
      canvas: "#1b1815",
      surface: "#23201c",
      editor: "#201d19",
      popup: "#332e28",
      hover: "#2e2924",
      border: "#3c352d",
      text: "#e0d5c3",
      muted: "#a1947e",
      accent: "#cfa86f",
      warning: "#e2b46e",
      selected: "#3a3025",
      selection: "#4e402d",
      danger: "#c55a45",
      error: "#ec8f7c",
      success: "#a8c48a",
      "syntax-keyword": "#e09a7a",
      "syntax-type": "#d6be7a",
      "syntax-function": "#b9c98a",
      "syntax-string": "#a8c48a",
      "syntax-number": "#e5a96b",
      "syntax-comment": "#857a69",
      "syntax-meta": "#d4a373",
      "syntax-property": "#d9c7a8",
      "syntax-invalid": "#ec8f7c",
    },
  },
  {
    id: "mozaik-light",
    name: "Mozaik Light",
    dark: false,
    colors: {
      canvas: "#e6e9ed",
      surface: "#f3f4f6",
      editor: "#fbfbfc",
      popup: "#ffffff",
      hover: "#e1e4e9",
      border: "#cfd4db",
      text: "#1f2329",
      muted: "#5d6571",
      accent: "#2d7a6a",
      warning: "#94640f",
      selected: "#d4e9e3",
      selection: "#b9dcd2",
      danger: "#b33c32",
      error: "#c0392b",
      success: "#2e7d32",
      ...LIGHT_SYNTAX,
    },
  },
  {
    // Warm paper tones with soft contrast, for daylight.
    id: "paper",
    name: "Paper",
    dark: false,
    colors: {
      canvas: "#e4ddcd",
      surface: "#eee8da",
      editor: "#f5efe2",
      popup: "#fbf7ee",
      hover: "#e3dac8",
      border: "#d2c7b1",
      text: "#3a3329",
      muted: "#74685a",
      accent: "#7b5e2e",
      warning: "#8f5d0b",
      selected: "#e3d4b8",
      selection: "#dcc9a5",
      danger: "#a84432",
      error: "#b23a2a",
      success: "#4c7a2c",
      ...LIGHT_SYNTAX,
      "syntax-comment": "#8a7f6f",
      "syntax-function": "#38608f",
    },
  },
];

export const themeOf = (id: string | null | undefined) =>
  THEMES.find((t) => t.id === id) ?? THEMES[0];

// Terminals follow the theme without the settings loading their lazy runtime.
let current = themeOf(DEFAULT_THEME);
const listeners = new Set<(theme: Theme) => void>();
export const currentTheme = () => current;
export function onTheme(fn: (theme: Theme) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Puts a theme's colors into the page (also to preview it in the palette). */
export function applyTheme(id: string | null | undefined) {
  const theme = themeOf(id);
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.colors))
    root.style.setProperty(`--${name}`, value);
  root.style.setProperty("color-scheme", theme.dark ? "dark" : "light");
  root.dataset.theme = theme.dark ? "dark" : "light";
  if (theme === current) return;
  current = theme;
  listeners.forEach((fn) => fn(theme));
}
