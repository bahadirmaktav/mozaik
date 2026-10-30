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
import {
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { rust } from "@codemirror/lang-rust";
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

function language(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["js", "jsx", "ts", "tsx"].includes(ext ?? ""))
    return javascript({
      typescript: ext === "ts" || ext === "tsx",
      jsx: ext === "jsx" || ext === "tsx",
    });
  return ext === "json"
    ? json()
    : ext === "md"
      ? markdown()
      : ext === "css"
        ? css()
        : ext === "html"
          ? html()
          : ext === "rs"
            ? rust()
            : [];
}

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
          EditorState.allowMultipleSelections.of(false),
          keymap.of([
            {
              any: (_view, event) => {
                if (!matches(event, "editor.line")) return false;
                event.preventDefault();
                setGoTo(true);
                return true;
              },
            },
            ...defaultKeymap.filter((k) => !k.key?.includes("Mod-Alt")),
            ...historyKeymap,
            indentWithTab,
          ]),
          syntax.of(
            reduced
              ? []
              : [syntaxHighlighting(defaultHighlightStyle), language(doc.name)],
          ),
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
        queueMicrotask(() => {
          if (viewRef.current === view)
            view.dispatch({
              effects: syntax.reconfigure([
                syntaxHighlighting(defaultHighlightStyle),
                language(name),
              ]),
            });
        });
      }
      if (current.text !== view.state.doc.toString()) {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: current.text },
        });
      }
    });
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
        syntax.reconfigure(
          reduced
            ? []
            : [syntaxHighlighting(defaultHighlightStyle), language(name)],
        ),
        // The setting may have changed while the editor was hidden.
        wrapCompartment.reconfigure(wrapping()),
      ],
    });
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
