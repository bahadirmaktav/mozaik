import { useEffect, useRef } from "react";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { search, searchKeymap, selectNextOccurrence } from "@codemirror/search";
import { theme } from "../text-editor/theme";
import { cursorClicks, editingKeys, typable } from "../text-editor/editing";
import { language } from "../ide/syntax";
import { commit, setDraft } from "./store";

/** Text set from the note (a reload), not typed: it is no draft. */
const external = Annotation.define<boolean>();

/**
 * A note's Markdown source, with the editing shortcuts and Find / Replace of the Text Editor
 * and the Code Editor (Workspace Settings → Text Editor). Text reaches the note's draft on
 * every edit; leaving the editor saves it.
 */
export function NoteEditor({ path, text }: { path: string; text: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  useEffect(() => {
    const syntax = new Compartment();
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [
          drawSelection(),
          history(),
          EditorState.allowMultipleSelections.of(true),
          cursorClicks,
          search({ top: true }),
          keymap.of(
            typable([
              { any: editingKeys },
              ...defaultKeymap,
              // Its Ctrl+D is Workspace Settings' "Add selection to next match".
              ...searchKeymap.filter((b) => b.run !== selectNextOccurrence),
              ...historyKeymap,
              indentWithTab,
            ]),
          ),
          syntax.of([]),
          theme,
          EditorView.lineWrapping,
          placeholder("Write in Markdown"),
          EditorView.contentAttributes.of({
            "aria-label": "Note content (Markdown)",
            spellcheck: "false",
          }),
          EditorView.domEventHandlers({
            blur: () => void commit(path),
          }),
        ],
      }),
      parent: host.current!,
      dispatch: (transaction) => {
        view.update([transaction]);
        if (transaction.docChanged && !transaction.annotation(external))
          setDraft(path, view.state.doc.toString());
      },
    });
    viewRef.current = view;
    void language(path).then((extension) => {
      if (viewRef.current === view)
        view.dispatch({ effects: syntax.reconfigure(extension) });
    });
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [path]);
  // Reload from Disk and Overwrite change the text outside the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== text)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: external.of(true),
      });
  }, [text]);
  return <div className="note-editor" ref={host} />;
}
