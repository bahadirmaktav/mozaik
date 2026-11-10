import { foldNodeProp, foldService, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * The language's fold range for a line, as CodeMirror's own syntax folding finds it (a
 * fold service replaces that lookup, so it is repeated here).
 */
function syntaxRange(state: EditorState, start: number, end: number) {
  const tree = syntaxTree(state);
  if (tree.length < end) return null;
  let found: { from: number; to: number } | null = null;
  for (let iter = tree.resolveStack(end, 1); iter; iter = iter.next!) {
    const node = iter.node;
    if (node.to <= end || node.from > end) continue;
    if (found && node.from < start) break;
    const prop = node.type.prop(foldNodeProp);
    const last = node.lastChild;
    const unfinished = !!last && last.to === node.to && last.type.isError;
    if (
      prop &&
      (node.to < tree.length - 50 ||
        tree.length === state.doc.length ||
        !unfinished)
    ) {
      const value = prop(node, state);
      if (value && value.from <= end && value.from >= start && value.to > end)
        found = value;
    }
  }
  return found;
}

/**
 * Where a fold ends. A closing bracket alone on its line (`}`, `};`, `});`, with a comment
 * after it) joins the folded line, so a function folds to `void f() {…}`, as Zed does
 * (VS Code leaves the `}` on a line of its own). A closing bracket followed by code keeps
 * its line, so folding the `if` of `} else {` leaves the `else` on its own line instead of
 * pulling it up to the `if`. Other ranges (comments, a bracket after code) stay as they are.
 */
export function foldEnd(
  state: EditorState,
  range: { from: number; to: number },
) {
  const close = state.doc.lineAt(range.to);
  const open = state.doc.lineAt(range.from);
  const before = state.doc.sliceString(close.from, range.to);
  const bracket = state.doc.sliceString(range.to, range.to + 1);
  if (!/^\s*$/.test(before) || !/[}\])]/.test(bracket)) return range;
  const after = state.doc.sliceString(range.to, close.to);
  if (/^[}\])]+[\s;,]*(\/\/.*|\/\*.*\*\/\s*)?$/.test(after)) return range;
  // Nothing between the opening line and the closing one: folding it as before is harmless
  // (no range would let the language fold it anyway).
  if (close.number <= open.number + 1) return range;
  return { from: range.from, to: state.doc.line(close.number - 1).to };
}

/** The code editors' folding: the language's ranges, ending as VS Code ends them. */
export const codeFolding = foldService.of((state, start, end) => {
  const range = syntaxRange(state, start, end);
  return range && foldEnd(state, range);
});
