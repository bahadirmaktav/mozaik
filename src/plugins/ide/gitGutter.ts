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
/** Past this many edits between the lines two files share, the rest counts as one change. */
const MAX_EDITS = 2048;
/** Myers's greedy diff: the pairs of equal items it keeps, last first. */
function commonItems(a: number[], b: number[]) {
  const n = a.length,
    m = b.length,
    max = Math.min(n + m, MAX_EDITS);
  const furthest = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(furthest.slice(max - d, max + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && furthest[max + k - 1] < furthest[max + k + 1])
          ? furthest[max + k + 1]
          : furthest[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      furthest[max + k] = x;
      if (x >= n && y >= m) return followBack(trace, d, n, m);
    }
  }
  return [];
}
function followBack(trace: Int32Array[], edits: number, n: number, m: number) {
  const pairs: [number, number][] = [];
  let x = n,
    y = m;
  for (let d = edits; d > 0; d--) {
    const before = trace[d];
    const k = x - y;
    const down = k === -d || (k !== d && before[d + k - 1] < before[d + k + 1]);
    const previous = down ? k + 1 : k - 1;
    const startX = before[d + previous];
    for (const snake = down ? startX : startX + 1; x > snake;) {
      x--;
      y--;
      pairs.push([x, y]);
    }
    x = startX;
    y = startX - previous;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    pairs.push([x, y]);
  }
  return pairs;
}
/**
 * The lines two texts share, as pairs of line indexes (from 0) in ascending order. Whole lines
 * are compared, which is all the gutter shows and far cheaper than characters: this runs on the
 * UI thread when a file opens and whenever typing pauses. A line found in only one of the files
 * can never match, so even a reformatted file leaves little to compare.
 */
function alignment(a: string[], b: string[]): [number, number][] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ids = new Map<string, number>();
  const idOf = (line: string) => {
    let id = ids.get(line);
    if (id === undefined) ids.set(line, (id = ids.size));
    return id;
  };
  const shared = (
    lines: string[],
    from: number,
    to: number,
    other: Set<string>,
  ) => {
    const kept: number[] = [];
    for (let i = from; i < to; i++) if (other.has(lines[i])) kept.push(i);
    return kept;
  };
  const keptA = shared(a, start, endA, new Set(b.slice(start, endB)));
  const keptB = shared(b, start, endB, new Set(a.slice(start, endA)));
  const pairs = commonItems(
    keptA.map((i) => idOf(a[i])),
    keptB.map((i) => idOf(b[i])),
  );
  const all: [number, number][] = [];
  for (let k = 0; k < start; k++) all.push([k, k]);
  for (let p = pairs.length - 1; p >= 0; p--)
    all.push([keptA[pairs[p][0]], keptB[pairs[p][1]]]);
  for (let k = 0; endA + k < a.length; k++) all.push([endA + k, endB + k]);
  return all;
}
/** For each line of `base` (from 0), the line of `doc` it is now, or -1 when it changed or went. */
export function matchLines(base: Text, doc: Text): Int32Array {
  const a = base.toJSON(),
    b = doc.toJSON();
  const map = new Int32Array(a.length).fill(-1);
  for (const [i, j] of alignment(a, b)) map[i] = j;
  return map;
}
export function lineChanges(base: Text, doc: Text): LineChange[] {
  const a = base.toJSON(),
    b = doc.toJSON();
  const changes: LineChange[] = [];
  let i = 0,
    j = 0;
  const gap = (toA: number, toB: number) => {
    if (j < toB)
      changes.push({
        kind: i < toA ? "modified" : "added",
        from: j + 1,
        to: toB,
      });
    else if (i < toA) {
      // At the end of the file the line before the removed text is marked.
      const line = Math.min(j + 1, b.length);
      changes.push({ kind: "deleted", from: line, to: line });
    }
  };
  for (const [toA, toB] of alignment(a, b)) {
    gap(toA, toB);
    i = toA + 1;
    j = toB + 1;
  }
  gap(a.length, b.length);
  return changes;
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
