import { currentTheme, onTheme } from "../../workspace/themes";

/**
 * C/C++ highlighting colors, chosen apart from the color theme (Settings → IDE → Editor), as a
 * C++ extension's colors sit on top of VS Code's theme. Each has a dark and a light palette and
 * follows the color theme's lightness. "Follow the color theme" sets nothing: the highlighting
 * falls back to the theme's `--syntax-*` colors.
 */
const TOKENS = [
  "keyword",
  "control",
  "type",
  "namespace",
  "function",
  "variable",
  "parameter",
  "property",
  "enum-member",
  "macro",
  "meta",
  "string",
  "number",
  "comment",
] as const;
type Palette = Record<(typeof TOKENS)[number], string>;
export interface CppTheme {
  id: string;
  name: string;
  dark?: Palette;
  light?: Palette;
}
export const DEFAULT_CPP_THEME = "follow";
export const CPP_THEMES: CppTheme[] = [
  { id: DEFAULT_CPP_THEME, name: "Follow the color theme" },
  {
    // The colors VS Code's default themes give C++ with Microsoft's extension.
    id: "vscode",
    name: "VS Code (Dark+ and Light+)",
    dark: {
      keyword: "#569cd6",
      control: "#c586c0",
      type: "#4ec9b0",
      namespace: "#4ec9b0",
      function: "#dcdcaa",
      variable: "#9cdcfe",
      parameter: "#9cdcfe",
      property: "#9cdcfe",
      "enum-member": "#4fc1ff",
      macro: "#569cd6",
      meta: "#c586c0",
      string: "#ce9178",
      number: "#b5cea8",
      comment: "#6a9955",
    },
    light: {
      keyword: "#0000ff",
      control: "#af00db",
      type: "#267f99",
      namespace: "#267f99",
      function: "#795e26",
      variable: "#001080",
      parameter: "#001080",
      property: "#001080",
      "enum-member": "#0070c1",
      macro: "#0000ff",
      meta: "#af00db",
      string: "#a31515",
      number: "#098658",
      comment: "#008000",
    },
  },
  {
    // After Visual Studio's C++ colors: parameters and macros stand apart.
    id: "visual-studio",
    name: "Visual Studio",
    dark: {
      keyword: "#569cd6",
      control: "#d8a0df",
      type: "#4ec9b0",
      namespace: "#c8c8c8",
      function: "#dcdcaa",
      variable: "#9cdcfe",
      parameter: "#9a9a9a",
      property: "#dadada",
      "enum-member": "#b8d7a3",
      macro: "#beb7ff",
      meta: "#9b9b9b",
      string: "#d69d85",
      number: "#b5cea8",
      comment: "#6a9955",
    },
    light: {
      keyword: "#0000ff",
      control: "#8f08c4",
      type: "#2b91af",
      namespace: "#000000",
      function: "#74531f",
      variable: "#1f377f",
      parameter: "#808080",
      property: "#000000",
      "enum-member": "#2f4f4f",
      macro: "#8a1bff",
      meta: "#808080",
      string: "#a31515",
      number: "#000000",
      comment: "#008000",
    },
  },
  {
    id: "one",
    name: "One (Dark and Light)",
    dark: {
      keyword: "#c678dd",
      control: "#c678dd",
      type: "#e5c07b",
      namespace: "#e5c07b",
      function: "#61afef",
      variable: "#e06c75",
      parameter: "#d19a66",
      property: "#e06c75",
      "enum-member": "#56b6c2",
      macro: "#61afef",
      meta: "#c678dd",
      string: "#98c379",
      number: "#d19a66",
      comment: "#7f848e",
    },
    light: {
      keyword: "#a626a4",
      control: "#a626a4",
      type: "#c18401",
      namespace: "#c18401",
      function: "#4078f2",
      variable: "#e45649",
      parameter: "#986801",
      property: "#e45649",
      "enum-member": "#0184bc",
      macro: "#4078f2",
      meta: "#a626a4",
      string: "#50a14f",
      number: "#986801",
      comment: "#a0a1a7",
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    dark: {
      keyword: "#f92672",
      control: "#f92672",
      type: "#66d9ef",
      namespace: "#66d9ef",
      function: "#a6e22e",
      variable: "#f8f8f2",
      parameter: "#fd971f",
      property: "#f8f8f2",
      "enum-member": "#ae81ff",
      macro: "#a6e22e",
      meta: "#f92672",
      string: "#e6db74",
      number: "#ae81ff",
      comment: "#88846f",
    },
    light: {
      keyword: "#d3105f",
      control: "#d3105f",
      type: "#0d8fa6",
      namespace: "#0d8fa6",
      function: "#5a8a00",
      variable: "#3b3a32",
      parameter: "#c76a00",
      property: "#3b3a32",
      "enum-member": "#7a4fd6",
      macro: "#5a8a00",
      meta: "#d3105f",
      string: "#9a8b00",
      number: "#7a4fd6",
      comment: "#8a8670",
    },
  },
];

let chosen = DEFAULT_CPP_THEME;
function apply() {
  const root = document.documentElement.style;
  const theme = CPP_THEMES.find((t) => t.id === chosen);
  const palette = currentTheme().dark ? theme?.dark : theme?.light;
  for (const token of TOKENS)
    if (palette) root.setProperty(`--cpp-${token}`, palette[token]);
    else root.removeProperty(`--cpp-${token}`);
}
onTheme(apply);
/** Puts a theme's colors into the page (also to preview it in the palette). */
export function setCppTheme(id: string | null | undefined) {
  chosen = id ?? DEFAULT_CPP_THEME;
  apply();
}
