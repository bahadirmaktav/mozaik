import type { KeyBinding } from "@codemirror/view";
import { EditorView } from "@codemirror/view";
import type { Transaction } from "@codemirror/state";

/** Whether a position of the view's document is on screen (a partly shown line counts). */
export const inView = (view: EditorView, pos: number) =>
  view.visibleRanges.some((range) => pos >= range.from && pos <= range.to);

/**
 * VS Code's "center if outside the viewport": a place already on screen only scrolls as far
 * as needed (nothing, usually); one off screen comes to the middle of the view, so what
 * surrounds it shows.
 */
export const revealEffect = (view: EditorView, pos: number) =>
  EditorView.scrollIntoView(pos, {
    y: inView(view, pos) ? "nearest" : "center",
  });

/**
 * The history keys (Undo, Redo and their selection steps) as in VS Code: a change undone or
 * redone off screen comes to the middle of the view instead of its top or bottom edge.
 */
export function centeredHistory(bindings: readonly KeyBinding[]): KeyBinding[] {
  return bindings.map((binding) => {
    const run = binding.run;
    if (!run) return binding;
    return {
      ...binding,
      // The history commands only need the state and a dispatch: the transaction they make
      // is dispatched as it is, then centered when its place was off screen.
      run: (view) =>
        run({
          state: view.state,
          dispatch: (tr: Transaction) => {
            const head = tr.state.selection.main.head;
            // Where the cursor lands, in the document as it is still shown.
            const before = tr.changes.invertedDesc.mapPos(head);
            const outside = !inView(
              view,
              Math.min(before, view.state.doc.length),
            );
            view.dispatch(tr);
            if (outside && tr.scrollIntoView)
              view.dispatch({
                effects: EditorView.scrollIntoView(head, { y: "center" }),
              });
          },
        } as unknown as EditorView),
    };
  });
}
