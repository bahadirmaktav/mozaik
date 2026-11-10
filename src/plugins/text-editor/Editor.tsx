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
import { findKeys, findPanel } from "./find";
// The Code Editor's highlighting by file name: grammars only, no language server.
import { language } from "../ide/syntax";
import { textChange } from "../ide/model";
import { placeOf, placeSelection, trackPlace, useSavePlace } from "./places";
import { useCommands } from "../../workspace/commands";
import { keysOf } from "../../workspace/keybindings";
import {
  isMarkdown,
  MarkdownPane,
  nextPreviewMode,
  PreviewButtons,
  usePreviewMode,
} from "./MarkdownPreview";

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
  useSavePlace(
    viewRef,
    instanceId,
    hasDocument(instanceId) ? getDocument(instanceId).path : null,
  );
  useEffect(() => {
    const doc = getDocument(instanceId);
    const place = placeOf(instanceId, doc.path);
    const syntax = syntaxCompartments.get(instanceId) ?? new Compartment();
    syntaxCompartments.set(instanceId, syntax);
    let reduced = lightweight(doc.text);
    let name = doc.name;
    const state =
      editorStates.get(instanceId) ??
      EditorState.create({
        doc: doc.text,
        selection: placeSelection(place, doc.text.length),
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
          findPanel,
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
              ...findKeys,
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
      scrollTo: place?.scroll,
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
      const shown = view.state.doc.toString();
      if (current.text !== shown)
        view.dispatch({ changes: textChange(shown, current.text) });
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
    trackPlace(view);
    // Changed while the tab was hidden: only the changed part, so the place survives.
    const shown = view.state.doc.toString();
    if (shown !== doc.text)
      view.dispatch({ changes: textChange(shown, doc.text) });
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
  const commands = useCommands("Text Editor", instanceId, focused);
  const markdown =
    hasDocument(instanceId) && isMarkdown(getDocument(instanceId).name);
  const preview = usePreviewMode(instanceId);
  commands.current = markdown
    ? [
        {
          label: "Markdown: Toggle Preview",
          shortcut: keysOf("markdown.preview"),
          action: () => nextPreviewMode(instanceId),
        },
      ]
    : [];
  return (
    <div
      className="editor-wrapper"
      onKeyDownCapture={(event) => {
        if (markdown && matches(event.nativeEvent, "markdown.preview")) {
          event.preventDefault();
          event.stopPropagation();
          nextPreviewMode(instanceId);
        }
      }}
    >
      {light && (
        <div className="large-file-note">
          Large document · syntax highlighting paused
        </div>
      )}
      <div className={`md-split ${markdown ? preview : "off"}`}>
        <div className="editor-host" ref={host} />
        {markdown && preview !== "off" && (
          <MarkdownPane id={instanceId} view={viewRef} />
        )}
      </div>
      {hasDocument(instanceId) && (
        <EditorStatus
          doc={getDocument(instanceId)}
          line={cursor.line}
          column={cursor.column}
          preview={markdown ? <PreviewButtons id={instanceId} /> : null}
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

/**
 * The editor's own status bar: the file's path at the left, then cursor, line ending, encoding
 * and unsaved state.
 */
function EditorStatus({
  doc,
  line,
  column,
  preview,
}: {
  doc: Document;
  line: number;
  column: number;
  preview: React.ReactNode;
}) {
  return (
    <div className="editor-status" role="group" aria-label="Text editor status">
      {doc.path && (
        // A long path loses its start, so the file name stays readable.
        <span className="editor-path" title={doc.path}>
          <bdi>{doc.path}</bdi>
        </span>
      )}
      {preview}
      <span>
        Ln {line}, Col {column}
      </span>
      <span>{doc.ending.toUpperCase()}</span>
      <span>UTF-8{doc.bom ? " BOM" : ""}</span>
      {dirty(doc) && <span>Modified</span>}
    </div>
  );
}
