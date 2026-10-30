import {
  Compartment,
  countColumn,
  RangeSetBuilder,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

// The Word wrap setting (Workspace Settings → Text Editor), shared by every text editor.
let enabled = true;
const listeners = new Set<() => void>();
export const wordWrap = () => enabled;
export function setWordWrap(value: boolean) {
  if (value === enabled) return;
  enabled = value;
  listeners.forEach((fn) => fn());
}
export function onWordWrap(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Lines indented by `columns` wrap under their text, as in Sublime Text. */
function build(view: EditorView) {
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const { from, to } of view.visibleRanges)
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (line.from <= last) continue;
      last = line.from;
      const indent = /^[ \t]*/.exec(line.text)![0];
      const columns = countColumn(indent, view.state.tabSize);
      if (columns && indent.length < line.length)
        builder.add(
          line.from,
          line.from,
          Decoration.line({
            attributes: {
              style: `padding-left: calc(${columns}ch + 6px); text-indent: -${columns}ch`,
            },
          }),
        );
    }
  return builder.finish();
}
const hangingIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = build(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** One compartment for every text editor state; `wrapping()` is its current content. */
export const wrapCompartment = new Compartment();
export const wrapping = (): Extension =>
  enabled ? [EditorView.lineWrapping, hangingIndent] : [];
