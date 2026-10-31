import { useEffect, useRef, useState } from "react";
import { Compartment, countColumn, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { indentOnInput } from "@codemirror/language";
import { search, searchKeymap, selectNextOccurrence } from "@codemirror/search";
import {
  dirty,
  editorStates,
  getDocument,
  hasDocument,
  subscribe,
  syntaxCompartments,
  updateDocument,
  useDocuments,
  type Document,
} from "./documents";
import { onWordWrap, wrapCompartment, wrapping } from "./wrap";
import type { ViewProps } from "../contract";
import { lightweight } from "./policy";
import { theme } from "./theme";
import { matches } from "../../workspace/keybindings";
import { cursorClicks, editingKeys, typable } from "./editing";
// The Code Editor's highlighting by file name: grammars only, no language server.
import { language } from "../ide/syntax";

export default function Editor({ instanceId, focused }: ViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [goTo, setGoTo] = useState(false),
    [line, setLine] = useState("1");
  const [light, setLight] = useState(() =>
    lightweight(getDocument(instanceId).text),
  );
  // The bar under the editor shows the cursor and the file's format.
  useDocuments();
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  useEffect(() => {
    const doc = getDocument(instanceId);
    const syntax = syntaxCompartments.get(instanceId) ?? new Compartment();
    syntaxCompartments.set(instanceId, syntax);
    let reduced = lightweight(doc.text);
    let name = doc.name;
    const state =
      editorStates.get(instanceId) ??
      EditorState.create({
        doc: doc.text,
        extensions: [
          lineNumbers(),
          drawSelection(),
          history(),
          indentOnInput(),
          highlightActiveLine(),
          // The Code Editor's editing shortcuts and Find / Replace, without its
          // language features.
          EditorState.allowMultipleSelections.of(true),
          cursorClicks,
          search({ top: true }),
          keymap.of(
            typable([
              { any: editingKeys },
              {
                any: (_view, event) => {
                  if (!matches(event, "editor.line")) return false;
                  event.preventDefault();
                  setGoTo(true);
                  return true;
                },
              },
              ...defaultKeymap,
              // Its Ctrl+D is Workspace Settings' "Add selection to next match".
              ...searchKeymap.filter((b) => b.run !== selectNextOccurrence),
              ...historyKeymap,
              indentWithTab,
            ]),
          ),
          syntax.of([]),
          wrapCompartment.of(wrapping()),
          theme,
          EditorView.contentAttributes.of({
            "aria-label": `Editor ${doc.name}`,
            spellcheck: "false",
          }),
        ],
      });
    const view = new EditorView({
      state,
      parent: host.current!,
      dispatch: (transaction) => {
        view.update([transaction]);
        editorStates.set(instanceId, view.state);
        if (transaction.docChanged)
          updateDocument(instanceId, { text: view.state.doc.toString() });
        if (transaction.docChanged || transaction.selection) showCursor();
      },
    });
    const unsubscribe = subscribe(() => {
      if (!hasDocument(instanceId)) return;
      const current = getDocument(instanceId);
      if (!reduced && lightweight(current.text)) {
        reduced = true;
        setLight(true);
        // Queue outside the current CodeMirror transaction notification.
        queueMicrotask(() => {
          if (viewRef.current === view)
            view.dispatch({ effects: syntax.reconfigure([]) });
        });
      }
      if (current.name !== name && !reduced) {
        name = current.name;
        configureSyntax();
      }
      if (current.text !== view.state.doc.toString()) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: current.text },
        });
      }
    });
    /** Loads the grammar of the file's type; a later name or a closed view drops it. */
    function configureSyntax() {
      const target = name;
      void language(target).then((extension) => {
        if (viewRef.current === view && name === target && !reduced)
          view.dispatch({ effects: syntax.reconfigure(extension) });
      });
    }
    function showCursor() {
      const head = view.state.selection.main.head,
        line = view.state.doc.lineAt(head);
      setCursor({
        line: line.number,
        column:
          countColumn(
            line.text.slice(0, head - line.from),
            view.state.tabSize,
          ) + 1,
      });
    }
    const unwatch = onWordWrap(() =>
      view.dispatch({ effects: wrapCompartment.reconfigure(wrapping()) }),
    );
    viewRef.current = view;
    if (view.state.doc.toString() !== doc.text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc.text },
      });
    }
    view.dispatch({
      effects: [
        ...(reduced ? [syntax.reconfigure([])] : []),
        // The setting may have changed while the editor was hidden.
        wrapCompartment.reconfigure(wrapping()),
      ],
    });
    if (!reduced) configureSyntax();
    showCursor();
    if (focused) view.focus();
    return () => {
      unsubscribe();
      unwatch();
      if (hasDocument(instanceId)) editorStates.set(instanceId, view.state);
      view.destroy();
      viewRef.current = null;
    };
  }, [instanceId]);
  useEffect(() => {
    if (focused) viewRef.current?.focus();
  }, [focused, instanceId]);
  return (
    <div className="editor-wrapper">
      {light && (
        <div className="large-file-note">
          Large document · syntax highlighting paused
        </div>
      )}
      <div className="editor-host" ref={host} />
      {hasDocument(instanceId) && (
        <EditorStatus
          doc={getDocument(instanceId)}
          line={cursor.line}
          column={cursor.column}
        />
      )}
      {goTo && (
        <form
          className="goto"
          onSubmit={(event) => {
            event.preventDefault();
            const view = viewRef.current;
            if (!view) return;
            const number = Math.max(
              1,
              Math.min(view.state.doc.lines, Number(line) || 1),
            );
            view.dispatch({
              selection: { anchor: view.state.doc.line(number).from },
              scrollIntoView: true,
            });
            setGoTo(false);
            view.focus();
          }}
        >
          <label>
            Go to line{" "}
            <input
              aria-label="Line number"
              type="number"
              min="1"
              autoFocus
              value={line}
              onChange={(e) => setLine(e.target.value)}
            />
          </label>
          <button>Go</button>
          <button type="button" onClick={() => setGoTo(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

/** The editor's own status bar: cursor, line ending, encoding and unsaved state. */
function EditorStatus({
  doc,
  line,
  column,
}: {
  doc: Document;
  line: number;
  column: number;
}) {
  return (
    <div className="editor-status" role="group" aria-label="Text editor status">
      <span>
        Ln {line}, Col {column}
      </span>
      <span>{doc.ending.toUpperCase()}</span>
      <span>UTF-8{doc.bom ? " BOM" : ""}</span>
      {dirty(doc) && <span>Modified</span>}
    </div>
  );
}
