import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view";
import { pathKey } from "./paths";

/**
 * Code that the preprocessor leaves out (`#if 0`, an `#ifdef` of a macro the build does not
 * define) shows faintly, as in VS Code. clangd 17 and later name these regions in its
 * `textDocument/inactiveRegions` notification; older versions send them as `comment`
 * semantic tokens (`semanticTokens.ts`). Without a server nothing is dimmed: which macros a
 * build defines is known only from its compile commands.
 */
export const inactiveCapabilities = { inactiveRegions: true };

export interface LineRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export const inactiveLine = Decoration.line({ class: "cm-inactive-code" });

/** The lines of LSP ranges (zero based) as line decorations; lines past the text are left out. */
export function inactiveLines(doc: Text, regions: readonly LineRange[]) {
  const lines = new Set<number>();
  for (const { start, end } of regions) {
    // A range ending at a line's start does not reach into that line.
    const last =
      end.line > start.line && end.character === 0 ? end.line - 1 : end.line;
    for (let line = Math.max(0, start.line); line <= last; line++)
      if (line < doc.lines) lines.add(line);
  }
  const builder = new RangeSetBuilder<Decoration>();
  for (const line of [...lines].sort((a, b) => a - b))
    builder.add(doc.line(line + 1).from, doc.line(line + 1).from, inactiveLine);
  return builder.finish();
}

const setRegions = StateEffect.define<DecorationSet>();
const regionsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setRegions)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** The last regions a server sent, by file, so a view shown again starts with them. */
const known = new Map<string, { path: string; regions: LineRange[] }>();
const shown = new Set<{ view: EditorView; path: () => string | null }>();

function apply(view: EditorView, regions: readonly LineRange[]) {
  view.dispatch({
    effects: setRegions.of(inactiveLines(view.state.doc, regions)),
  });
}

/** A server's regions of one file; every editor showing it is updated. */
export function setInactiveRegions(path: string, regions: LineRange[]) {
  const key = pathKey(path);
  if (regions.length) known.set(key, { path, regions });
  else if (!known.delete(key)) return;
  for (const entry of shown) {
    const file = entry.path();
    if (file && pathKey(file) === key) apply(entry.view, regions);
  }
}

/** Drops the regions of files below a root, when its server stops. */
export function clearInactiveRegions(within: (path: string) => boolean) {
  for (const [key, entry] of known) if (within(entry.path)) known.delete(key);
  for (const entry of shown) {
    const file = entry.path();
    if (file && within(file)) apply(entry.view, []);
  }
}

const tracker = (path: () => string | null) =>
  ViewPlugin.fromClass(
    class {
      entry: { view: EditorView; path: () => string | null };
      constructor(view: EditorView) {
        this.entry = { view, path };
        shown.add(this.entry);
        const file = path();
        const regions = file && known.get(pathKey(file))?.regions;
        if (regions)
          queueMicrotask(() => shown.has(this.entry) && apply(view, regions));
      }
      destroy() {
        shown.delete(this.entry);
      }
    },
  );

/** `path` is the file the editor shows. */
export const inactiveRegions = (path: () => string | null) => [
  regionsField,
  tracker(path),
];
