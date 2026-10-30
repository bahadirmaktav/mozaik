import {
  Decoration,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { subscribe, todoTags } from "./todos";
import { tagColor, todoEditorPattern } from "./todoModel";

function decorator(tags: string[]) {
  const pattern = todoEditorPattern(tags);
  return pattern
    ? new MatchDecorator({
        regexp: pattern,
        decorate(add, _from, to, match) {
          add(
            to - match[1].length,
            to,
            Decoration.mark({
              class: "cm-todo-tag",
              attributes: { style: `color: ${tagColor(match[1])}` },
            }),
          );
        },
      })
    : null;
}

/** The TODO tags of Workspace Settings in comments, in their colors (as Todo Tree does). */
export const todoHighlight = ViewPlugin.fromClass(
  class {
    tags = todoTags();
    matcher = decorator(this.tags);
    decorations: DecorationSet;
    unsubscribe: () => void;
    constructor(readonly view: EditorView) {
      this.decorations = this.matcher?.createDeco(view) ?? Decoration.none;
      // New tags redraw at once, without waiting for an edit.
      this.unsubscribe = subscribe(() => {
        if (todoTags() !== this.tags)
          queueMicrotask(() => view.dom.isConnected && view.dispatch({}));
      });
    }
    update(update: ViewUpdate) {
      if (todoTags() !== this.tags) {
        this.tags = todoTags();
        this.matcher = decorator(this.tags);
        this.decorations =
          this.matcher?.createDeco(update.view) ?? Decoration.none;
      } else if (this.matcher)
        this.decorations = this.matcher.updateDeco(update, this.decorations);
    }
    destroy() {
      this.unsubscribe();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
