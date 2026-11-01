import { EditorView } from "@codemirror/view";

/** The dark code editor look shared by the Text Editor and the Mermaid source editor. */
export const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#16191e",
      color: "#dce0e6",
      fontSize: "13px",
    },
    ".cm-scroller": {
      overflow: "auto",
      // The panel's font from Workspace Settings (see `workspace/fonts.ts`).
      fontFamily: 'var(--code-font, Consolas, "Liberation Mono", monospace)',
      lineHeight: "1.6",
    },
    ".cm-content": { caretColor: "#dce0e6", padding: "12px 0" },
    ".cm-gutters": {
      backgroundColor: "#16191e",
      color: "#626e7e",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "#ffffff04" },
    ".cm-cursor": { borderLeftColor: "#dce0e6" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
      { backgroundColor: "#37564f !important" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);
