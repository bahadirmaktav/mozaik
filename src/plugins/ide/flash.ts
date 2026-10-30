import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

/** How long a jump target stays highlighted, matching the CSS fade. */
const DURATION = 1200;
const setFlash = StateEffect.define<{ from: number; to: number } | null>();
const mark = Decoration.mark({ class: "cm-jump-flash" });
const line = Decoration.line({ class: "cm-jump-line" });
const field = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setFlash)) {
        if (!effect.value) return Decoration.none;
        const { from, to } = effect.value;
        const start = transaction.state.doc.lineAt(from).from;
        return Decoration.set(
          from < to
            ? [line.range(start), mark.range(from, to)]
            : [line.range(start)],
        );
      }
    return transaction.docChanged ? Decoration.none : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});
const timers = new Map<string, number>();

function show(view: EditorView, range: { from: number; to: number } | null) {
  if (!view.state.field(field, false))
    view.dispatch({ effects: StateEffect.appendConfig.of(field) });
  view.dispatch({ effects: setFlash.of(range) });
}
/**
 * Briefly highlights where a jump landed, as VS Code does after Go to Definition or a
 * reference: the word at `pos` (the line when there is none). `view` finds the document's
 * editor each time, since a tab that just opened may remount it.
 */
export function flash(id: string, view: () => EditorView | null, pos: number) {
  requestAnimationFrame(() => {
    const target = view();
    if (!target) return;
    const at = Math.min(pos, target.state.doc.length);
    const word = target.state.wordAt(at);
    show(
      target,
      word ? { from: word.from, to: word.to } : { from: at, to: at },
    );
    clearTimeout(timers.get(id));
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id);
        const current = view();
        if (current?.state.field(field, false)) show(current, null);
      }, DURATION),
    );
  });
}
