import { Chunk } from "@codemirror/merge";
import {
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Text,
} from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";

/**
 * The lines of a file that differ from Git's staged text, as VS Code's gutter shows them: a
 * green bar for added lines, a blue one for changed lines, a red mark where lines were deleted.
 * It follows the text while typing; the minimap reads the same list.
 */
export type LineChangeKind = "added" | "modified" | "deleted";
export interface LineChange {
  kind: LineChangeKind;
  /** The first and last line, from 1; a deletion marks the line after the removed text. */
  from: number;
  to: number;
}
export function lineChanges(base: Text, doc: Text): LineChange[] {
  return Chunk.build(base, doc).map((chunk) => {
    const end = Math.min(chunk.toB, doc.length);
    const start = Math.min(chunk.fromB, doc.length);
    if (chunk.fromB >= chunk.toB) {
      const line = doc.lineAt(start).number;
      return { kind: "deleted" as const, from: line, to: line };
    }
    // A chunk's end lies after its last line's line break.
    const last =
      end > start && doc.sliceString(end - 1, end) === "\n" ? end - 1 : end;
    return {
      kind:
        chunk.fromA >= chunk.toA ? ("added" as const) : ("modified" as const),
      from: doc.lineAt(start).number,
      to: doc.lineAt(last).number,
    };
  });
}
/** The staged text to compare with, in the document's line form. */
export const baseText = (text: string) => Text.of(text.split("\n"));

class ChangeMarker extends GutterMarker {
  elementClass: string;
  constructor(readonly kind: LineChangeKind) {
    super();
    this.elementClass = `cm-git-${kind}`;
  }
  eq(other: GutterMarker) {
    return other instanceof ChangeMarker && other.kind === this.kind;
  }
}
const markers: Record<LineChangeKind, ChangeMarker> = {
  added: new ChangeMarker("added"),
  modified: new ChangeMarker("modified"),
  deleted: new ChangeMarker("deleted"),
};

export const setGitBase = StateEffect.define<Text | null>();
const setChanges = StateEffect.define<LineChange[]>();
function markerSet(doc: Text, changes: LineChange[]) {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const change of changes)
    for (let line = change.from; line <= change.to; line++) {
      if (line > doc.lines) break;
      const at = doc.line(line).from;
      builder.add(at, at, markers[change.kind]);
    }
  return builder.finish();
}
interface GitState {
  base: Text | null;
  changes: LineChange[];
  marks: RangeSet<GutterMarker>;
}
const gitField = StateField.define<GitState>({
  create: () => ({ base: null, changes: [], marks: RangeSet.empty }),
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged)
      next = { ...next, marks: next.marks.map(transaction.changes) };
    for (const effect of transaction.effects) {
      if (effect.is(setGitBase)) {
        const changes = effect.value
          ? lineChanges(effect.value, transaction.newDoc)
          : [];
        next = {
          base: effect.value,
          changes,
          marks: markerSet(transaction.newDoc, changes),
        };
      } else if (effect.is(setChanges))
        next = {
          ...next,
          changes: effect.value,
          marks: markerSet(transaction.newDoc, effect.value),
        };
    }
    return next;
  },
});
/** The changed lines the gutter shows, for the minimap. */
export const gitChanges = (state: EditorView["state"]) =>
  state.field(gitField, false)?.changes ?? [];

/** Compares again shortly after typing stops. */
const follow = ViewPlugin.fromClass(
  class {
    timer = 0;
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      if (!update.docChanged || !update.state.field(gitField).base) return;
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        const { base } = this.view.state.field(gitField);
        if (base)
          this.view.dispatch({
            effects: setChanges.of(lineChanges(base, this.view.state.doc)),
          });
      }, 250);
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
);
/** The gutter column; a click on a marked line opens the file's comparison. */
export const gitGutter = (open: () => void) => [
  gitField,
  follow,
  gutter({
    class: "cm-git-gutter",
    markers: (view) => view.state.field(gitField).marks,
    domEventHandlers: {
      mousedown(view, line) {
        const { marks } = view.state.field(gitField);
        let marked = false;
        marks.between(line.from, line.from, () => {
          marked = true;
          return false;
        });
        if (marked) open();
        return marked;
      },
    },
  }),
];
