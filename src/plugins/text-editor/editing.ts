import { EditorSelection, type EditorState } from "@codemirror/state";
import {
  EditorView,
  rectangularSelection,
  type KeyBinding,
} from "@codemirror/view";
import { lineComment, lineUncomment } from "@codemirror/commands";
import { search, selectNextOccurrence } from "@codemirror/search";
import { chordStart, matches, matchesChord } from "../../workspace/keybindings";

/**
 * The editing shortcuts the Text Editor and the Code Editor share (Workspace Settings →
 * Text Editor): expand line selection, add cursors, add the next match, line comments.
 */

/** Ctrl+Alt is AltGr on many layouts: bindings with both would swallow typed characters. */
export const typable = (bindings: readonly KeyBinding[]) =>
  bindings.filter(
    (b) => !/(Mod|Ctrl)-(Shift-)?Alt|Alt-(Shift-)?(Mod|Ctrl)/.test(b.key ?? ""),
  );

/** Find / Replace: a match lands in the middle of the view, not at its edge. */
export const findPanel = search({
  top: true,
  scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: "center" }),
});

/** Line selection that grows by the next line each time, as in most code editors. */
export function expandLineSelection(view: EditorView) {
  const { state } = view;
  view.dispatch({
    selection: EditorSelection.create(
      state.selection.ranges.map((range) =>
        EditorSelection.range(
          state.doc.lineAt(range.from).from,
          Math.min(state.doc.lineAt(range.to).to + 1, state.doc.length),
        ),
      ),
      state.selection.mainIndex,
    ),
    scrollIntoView: true,
  });
  return true;
}
/** One more cursor on the line above or below each cursor, keeping its column. */
function addCursor(view: EditorView, forward: boolean) {
  const ranges = [...view.state.selection.ranges];
  for (const range of view.state.selection.ranges) {
    const moved = view.moveVertically(
      EditorSelection.cursor(
        range.head,
        range.assoc,
        undefined,
        range.goalColumn,
      ),
      forward,
    );
    if (moved.head !== range.head)
      ranges.push(
        EditorSelection.cursor(
          moved.head,
          moved.assoc,
          undefined,
          moved.goalColumn,
        ),
      );
  }
  view.dispatch({
    selection: EditorSelection.create(ranges, ranges.length - 1),
    scrollIntoView: true,
  });
  return true;
}
const chords: Record<string, (view: EditorView) => boolean> = {
  "code.comment.add": lineComment,
  "code.comment.remove": lineUncomment,
};
/** The first keys of a chord pressed in that editor, until its next key. */
let pendingChord: { view: EditorView; first: string } | null = null;
/**
 * Chords such as Ctrl+K Ctrl+C: the first keys wait for the next ones, which finish the
 * chord or are dropped (as in VS Code) rather than typed.
 */
function chordKeys(view: EditorView, event: KeyboardEvent) {
  if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(event.key))
    return false;
  const pending = pendingChord?.view === view ? pendingChord.first : null;
  pendingChord = null;
  if (pending) {
    event.preventDefault();
    const id = Object.keys(chords).find((id) =>
      matchesChord(event, pending, id),
    );
    if (id) chords[id](view);
    return true;
  }
  const first = chordStart(event, Object.keys(chords));
  if (!first) return false;
  event.preventDefault();
  pendingChord = { view, first };
  return true;
}
/** Read at each key, so changes in Workspace Settings apply at once. */
export function editingKeys(view: EditorView, event: KeyboardEvent) {
  if (chordKeys(view, event)) return true;
  const command = matches(event, "code.line")
    ? expandLineSelection
    : matches(event, "code.cursor.up")
      ? (v: EditorView) => addCursor(v, false)
      : matches(event, "code.cursor.down")
        ? (v: EditorView) => addCursor(v, true)
        : matches(event, "code.next")
          ? selectNextOccurrence
          : matches(event, "code.comment.add")
            ? lineComment
            : matches(event, "code.comment.remove")
              ? lineUncomment
              : null;
  if (!command) return false;
  event.preventDefault();
  return command(view);
}
/**
 * The text a copy takes: the selections, or the whole lines of bare cursors, as the editors'
 * own Ctrl+C. `ranges` are what a cut removes.
 */
export function copiedText(state: EditorState) {
  const { selection, doc } = state;
  const selected = selection.ranges.filter((r) => !r.empty);
  if (selected.length)
    return {
      text: selected.map((r) => state.sliceDoc(r.from, r.to)).join("\n"),
      ranges: selected.map(({ from, to }) => ({ from, to })),
    };
  const lines = [
    ...new Set(selection.ranges.map((r) => doc.lineAt(r.head).number)),
  ]
    .sort((a, b) => a - b)
    .map((n) => doc.line(n));
  return {
    text: lines.map((line) => `${line.text}\n`).join(""),
    ranges: lines.map((line) => ({
      from: line.from,
      to: Math.min(line.to + 1, doc.length),
    })),
  };
}
/** The menu's Copy, Cut and Paste (the keys stay with the WebView's own clipboard events). */
export const clipboardCopy = (view: EditorView) =>
  navigator.clipboard.writeText(copiedText(view.state).text);
export async function clipboardCut(view: EditorView) {
  const { text, ranges } = copiedText(view.state);
  await navigator.clipboard.writeText(text);
  view.dispatch({
    changes: ranges,
    scrollIntoView: true,
    userEvent: "delete.cut",
  });
  view.focus();
}
export async function clipboardPaste(view: EditorView) {
  const text = await navigator.clipboard.readText();
  view.dispatch(view.state.replaceSelection(text), {
    scrollIntoView: true,
    userEvent: "input.paste",
  });
  view.focus();
}

/** Alt+click adds a cursor (Ctrl+click is the Code Editor's go to definition);
 * Shift+Alt+drag selects a column. */
export const cursorClicks = [
  EditorView.clickAddsSelectionRange.of((event) => event.altKey),
  rectangularSelection({
    eventFilter: (event) => event.altKey && event.shiftKey,
  }),
];
