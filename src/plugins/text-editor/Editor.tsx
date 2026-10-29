import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
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
  editorStates,
  getDocument,
  hasDocument,
  subscribe,
  syntaxCompartments,
  updateDocument,
} from "./documents";
import type { ViewProps } from "../contract";
import { lightweight } from "./policy";
import { theme } from "./theme";

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
              key: "Mod-g",
              run: () => {
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
    viewRef.current = view;
    if (view.state.doc.toString() !== doc.text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc.text },
      });
    }
    view.dispatch({
      effects: syntax.reconfigure(
        reduced
          ? []
          : [syntaxHighlighting(defaultHighlightStyle), language(name)],
      ),
    });
    if (focused) view.focus();
    return () => {
      unsubscribe();
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
