import { useEffect, useRef, useState } from "react";
import { Compartment, countColumn, EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches } from "@codemirror/search";
import { codeFolding, foldMarker } from "../ide/folding";
import {
  dirty,
  editorStates,
  endingLabel,
  endingTitle,
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
import {
  detectedLanguage,
  language,
  languageNamed,
  languageNames,
  PLAIN_TEXT,
} from "../ide/syntax";
import { host } from "../ide/editors";
import {
  chooseSyntax,
  chosenSyntax,
  onSyntaxChoice,
  useSyntaxChoice,
} from "./syntaxChoice";
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
          // The Code Editor's folding and brackets, from the file type's grammar (none
          // while a large document's highlighting is paused).
          codeFolding,
          foldGutter({ markerDOM: foldMarker }),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          drawSelection(),
          dropCursor(),
          history(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
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
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...findKeys,
              ...historyKeymap,
              ...foldKeymap,
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
      if (current.name !== name) {
        name = current.name;
        // Saved under a name of a known type: that type wins over the earlier choice.
        if (detectedLanguage(name) !== PLAIN_TEXT)
          chooseSyntax(instanceId, null);
        if (!reduced) configureSyntax();
      }
      const shown = view.state.doc.toString();
      if (current.text !== shown)
        view.dispatch({ changes: textChange(shown, current.text) });
    });
    /**
     * Loads the grammar of the file's type; a later name or a closed view drops it. Brackets
     * close themselves only in a file with a grammar, not in plain prose.
     */
    let asked = 0;
    function configureSyntax() {
      const target = name,
        turn = ++asked;
      const chosen = chosenSyntax(instanceId);
      void (chosen ? languageNamed(chosen, target) : language(target)).then(
        (extension) => {
          const known = !(Array.isArray(extension) && extension.length === 0);
          // Only the latest request counts: a slower grammar must not replace a newer choice.
          if (viewRef.current === view && turn === asked && !reduced)
            view.dispatch({
              effects: syntax.reconfigure(
                known ? [extension, closeBrackets()] : [],
              ),
            });
        },
      );
    }
    const unchoose = onSyntaxChoice(() => {
      if (!reduced) configureSyntax();
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
      unchoose();
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
  const syntaxPick = () =>
    void pickSyntax(instanceId).then(() => viewRef.current?.focus());
  commands.current = [
    { label: "Text Editor: Select Syntax…", action: syntaxPick },
    ...(markdown
      ? [
          {
            label: "Markdown: Toggle Preview",
            shortcut: keysOf("markdown.preview"),
            action: () => nextPreviewMode(instanceId),
          },
        ]
      : []),
  ];
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
          <MarkdownPane id={instanceId} view={viewRef} focused={focused} />
        )}
      </div>
      {hasDocument(instanceId) && (
        <EditorStatus
          doc={getDocument(instanceId)}
          line={cursor.line}
          column={cursor.column}
          preview={markdown ? <PreviewButtons id={instanceId} /> : null}
          onSyntax={syntaxPick}
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
 * Select Syntax, as Sublime Text's syntax menu: Auto Detect (the file name decides), then
 * every language. The document keeps the choice until it is renamed to a known type.
 */
async function pickSyntax(id: string) {
  if (!hasDocument(id)) return;
  const detected = detectedLanguage(getDocument(id).name);
  const current = chosenSyntax(id);
  const AUTO = "\0auto"; // never a language name
  const choice = await host().pick(
    "Select Syntax",
    [
      { id: AUTO, label: "Auto Detect", detail: detected },
      ...languageNames().map((name) => ({
        id: name,
        label: name,
        detail: name === (current ?? detected) ? "current" : undefined,
      })),
    ],
    { selected: current ?? AUTO },
  );
  if (choice === null || !hasDocument(id)) return;
  chooseSyntax(id, choice === AUTO ? null : choice);
}

/**
 * The editor's own status bar: the file's path at the left, then cursor, line ending, encoding,
 * the language (a button that changes it) and unsaved state.
 */
function EditorStatus({
  doc,
  line,
  column,
  preview,
  onSyntax,
}: {
  doc: Document;
  line: number;
  column: number;
  preview: React.ReactNode;
  onSyntax: () => void;
}) {
  const chosen = useSyntaxChoice(doc.id);
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
      <span title={endingTitle(doc)}>{endingLabel(doc)}</span>
      <span>UTF-8{doc.bom ? " BOM" : ""}</span>
      <button
        type="button"
        className="editor-syntax"
        title="Select Syntax"
        aria-label={`Syntax: ${chosen ?? detectedLanguage(doc.name)}. Select Syntax`}
        onClick={onSyntax}
      >
        {chosen ?? detectedLanguage(doc.name)}
      </button>
      {dirty(doc) && <span>Modified</span>}
    </div>
  );
}
