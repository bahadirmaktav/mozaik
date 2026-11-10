import { startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";

/** Text before the cursor that ends in a folder of an `#include` (or `#import`) path. */
const FOLDER = /^\s*#\s*(?:include|include_next|import)\s*[<"][^<>"]*\/$/;

/** Whether the text before the cursor ends in an `#include` path's folder (`<boost/`). */
export const endsInIncludeFolder = (before: string) => FOLDER.test(before);

/**
 * As in VS Code with clangd: a folder chosen from an `#include`'s completions (clangd offers
 * `boost/` beside the headers) opens the completions again, now for the headers and folders
 * inside it, so a path is completed one folder at a time.
 */
export const includeFolders = EditorView.updateListener.of((update) => {
  if (!update.transactions.some((tr) => tr.isUserEvent("input.complete")))
    return;
  const { state, view } = update;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (!endsInIncludeFolder(line.text.slice(0, head - line.from))) return;
  // An update listener may not dispatch: open the list once this update is done.
  setTimeout(() => {
    if (view.state.selection.main.head === head) startCompletion(view);
  });
});
