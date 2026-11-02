import { EditorView } from "@codemirror/view";

/**
 * The code editor look shared by the Text Editor, the Code Editor and the Mermaid source
 * editor, in the colors of the chosen theme (`workspace/themes.ts`).
 */
export const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--editor)",
      color: "var(--text)",
      fontSize: "13px",
    },
    ".cm-scroller": {
      overflow: "auto",
      // The panel's font from Workspace Settings (see `workspace/fonts.ts`).
      fontFamily: 'var(--code-font, Consolas, "Liberation Mono", monospace)',
      lineHeight: "1.6",
    },
    ".cm-content": { caretColor: "var(--text)", padding: "12px 0" },
    ".cm-gutters": {
      backgroundColor: "var(--editor)",
      color: "color-mix(in srgb, var(--muted) 70%, var(--editor))",
      border: "none",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in srgb, var(--text) 3%, transparent)",
    },
    ".cm-cursor": { borderLeftColor: "var(--text)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "var(--selection) !important" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);
