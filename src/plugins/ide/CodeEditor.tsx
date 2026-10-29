import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  showDialog,
  type KeyBinding,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle,
  LanguageDescription,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
} from "@codemirror/search";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import {
  editorStates,
  getDocument,
  hasDocument,
  subscribe,
  updateDocument,
} from "../text-editor/documents";
import { lightweight } from "../text-editor/policy";
import { theme } from "../text-editor/theme";
import type { ViewProps } from "../contract";
import { Menu, type MenuItem } from "../../components/Menu";
import {
  canNavigate,
  host,
  message,
  navigate,
  registerView,
  setCurrent,
  useEditors,
} from "./editors";
import {
  bindView,
  codeActions,
  displayPath,
  findReferences,
  format,
  goTo,
  prepareRename,
  rename,
  runCodeAction,
  serverForFile,
  serverOf,
  subscribe as subscribeServers,
  useServers,
  type CodeAction,
} from "./lsp";
import {
  projectFor,
  settingsFor,
  subscribe as subscribeProjects,
} from "./projects";
import { serverFor, toUri } from "./paths";

// Readable on the dark editor background (the default style targets light themes).
const highlight = HighlightStyle.define([
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.operatorKeyword,
    ],
    color: "#c6a0f6",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "#7fd1c7" },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.macroName,
    ],
    color: "#8ab4f8",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    color: "#a5d6a7",
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "#f2b880" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "#7a8494",
    fontStyle: "italic",
  },
  { tag: [tags.processingInstruction, tags.meta], color: "#e2b77e" },
  { tag: [tags.propertyName, tags.attributeName], color: "#b8c7e0" },
  { tag: tags.heading, color: "#8ab4f8", fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.link, textDecoration: "underline" },
  { tag: tags.invalid, color: "#f28b82" },
]);

/** Ctrl+Alt is AltGr on many layouts: bindings with both would swallow typed characters. */
const typable = (bindings: readonly KeyBinding[]) =>
  bindings.filter(
    (b) => !/(Mod|Ctrl)-(Shift-)?Alt|Alt-(Shift-)?(Mod|Ctrl)/.test(b.key ?? ""),
  );

const syntax = new Map<string, Compartment>();
const lspCompartment = new Map<string, Compartment>();
const indentCompartment = new Map<string, Compartment>();
const compartment = (map: Map<string, Compartment>, id: string) => {
  const existing = map.get(id);
  if (existing) return existing;
  const created = new Compartment();
  map.set(id, created);
  return created;
};
function disposeCodeState(id: string) {
  syntax.delete(id);
  lspCompartment.delete(id);
  indentCompartment.delete(id);
}
function indentation(path: string | null): Extension {
  const settings = settingsFor(path);
  return [
    EditorState.tabSize.of(settings.tabSize),
    indentUnit.of(settings.insertSpaces ? " ".repeat(settings.tabSize) : "\t"),
  ];
}
async function language(name: string): Promise<Extension> {
  const description = LanguageDescription.matchFilename(languages, name);
  if (!description) return [];
  return [syntaxHighlighting(highlight), await description.load()];
}

type Popup =
  | { kind: "menu"; x: number; y: number }
  | { kind: "actions"; x: number; y: number; actions: CodeAction[] };

export default function CodeEditor({ instanceId, focused }: ViewProps) {
  const hostElement = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [popup, setPopup] = useState<Popup | null>(null);
  const [light, setLight] = useState(() =>
    lightweight(getDocument(instanceId).text),
  );
  const [path, setPath] = useState(() => getDocument(instanceId).path);
  useEditors();
  useServers();
  const report = (e: unknown) => host().report(message(e));
  const server = serverOf(path);
  const ready = server?.status === "ready";

  useEffect(() => {
    const doc = getDocument(instanceId);
    const syntaxSlot = compartment(syntax, instanceId);
    const lspSlot = compartment(lspCompartment, instanceId);
    const indentSlot = compartment(indentCompartment, instanceId);
    let reduced = lightweight(doc.text);
    let name = doc.name,
      currentPath = doc.path,
      attached: string | null = null,
      disposed = false;
    const state =
      editorStates.get(instanceId) ??
      EditorState.create({
        doc: doc.text,
        extensions: [
          lineNumbers(),
          foldGutter(),
          lintGutter(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          keymap.of(
            typable([
              { key: "Mod-g", run: gotoLine },
              ...closeBracketsKeymap,
              ...defaultKeymap,
              ...searchKeymap,
              ...historyKeymap,
              ...foldKeymap,
              ...completionKeymap,
              ...lintKeymap,
              indentWithTab,
            ]),
          ),
          syntaxSlot.of([]),
          lspSlot.of([]),
          indentSlot.of(indentation(doc.path)),
          theme,
          EditorView.contentAttributes.of({
            "aria-label": `Code ${doc.name}`,
            spellcheck: "false",
          }),
        ],
      });
    const view = new EditorView({
      state,
      parent: hostElement.current!,
      dispatch: (transaction) => {
        view.update([transaction]);
        editorStates.set(instanceId, view.state);
        if (transaction.docChanged)
          updateDocument(instanceId, { text: view.state.doc.toString() });
      },
    });
    bindView(view, instanceId);
    viewRef.current = view;
    const configureSyntax = () => {
      const target = name;
      if (reduced) {
        view.dispatch({ effects: syntaxSlot.reconfigure([]) });
        return;
      }
      void language(target).then((extension) => {
        if (!disposed && name === target && !reduced)
          view.dispatch({ effects: syntaxSlot.reconfigure(extension) });
      });
    };
    /** Connects the editor to the project's language server once it is ready. */
    const configureServer = () => {
      const running = serverForFile(currentPath);
      const target =
        running?.server.status === "ready" && currentPath
          ? `${running.server.id}\0${currentPath}`
          : null;
      if (target === attached) return;
      attached = target;
      queueMicrotask(() => {
        if (disposed) return;
        view.dispatch({
          effects: lspSlot.reconfigure(
            target && running && currentPath
              ? running.server.client.plugin(
                  toUri(currentPath),
                  running.language,
                )
              : [],
          ),
        });
      });
    };
    const unsubscribe = subscribe(() => {
      if (!hasDocument(instanceId)) return;
      const current = getDocument(instanceId);
      if (!reduced && lightweight(current.text)) {
        reduced = true;
        setLight(true);
        queueMicrotask(configureSyntax);
      }
      if (current.name !== name) {
        name = current.name;
        queueMicrotask(configureSyntax);
      }
      if (current.path !== currentPath) {
        currentPath = current.path;
        setPath(current.path);
        queueMicrotask(() => {
          view.dispatch({
            effects: indentSlot.reconfigure(indentation(currentPath)),
          });
          configureServer();
        });
      }
      if (current.text !== view.state.doc.toString())
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: current.text },
        });
    });
    const unsubscribeServers = subscribeServers(() =>
      queueMicrotask(configureServer),
    );
    const unsubscribeProjects = subscribeProjects(() => {
      queueMicrotask(() => {
        if (disposed) return;
        view.dispatch({
          effects: indentSlot.reconfigure(indentation(currentPath)),
        });
        configureServer();
      });
    });
    if (view.state.doc.toString() !== doc.text)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc.text },
      });
    configureSyntax();
    configureServer();
    registerView(instanceId, view);
    if (focused) view.focus();
    return () => {
      disposed = true;
      unsubscribe();
      unsubscribeServers();
      unsubscribeProjects();
      registerView(instanceId, null);
      // The cached state must not hold this view's server connection: the next view
      // attaches to whatever server is running then.
      if (hasDocument(instanceId))
        editorStates.set(
          instanceId,
          view.state.update({ effects: lspSlot.reconfigure([]) }).state,
        );
      view.destroy();
      viewRef.current = null;
      if (!hasDocument(instanceId)) disposeCodeState(instanceId);
    };
  }, [instanceId]);
  useEffect(() => {
    if (focused) {
      viewRef.current?.focus();
      setCurrent(instanceId);
    }
  }, [focused, instanceId]);

  const view = () => viewRef.current;
  const run = (action: (view: EditorView) => Promise<unknown>) => {
    const current = view();
    if (current) void action(current).catch(report);
  };
  async function showActions(target: EditorView, x: number, y: number) {
    const actions = await codeActions(target);
    if (!actions.length) throw new Error("No quick fixes are available here.");
    setPopup({ kind: "actions", x, y, actions });
  }
  function startRename(target: EditorView) {
    return prepareRename(target).then(({ name, position }) => {
      const { close, result } = showDialog(target, {
        label: "New name",
        input: { name: "name", value: name, "aria-label": "New name" },
        focus: true,
        submitLabel: "Rename",
        class: "code-rename",
      });
      void result.then((form) => {
        target.dispatch({ effects: close });
        const value = (
          form?.elements.namedItem("name") as HTMLInputElement | null
        )?.value.trim();
        // Back to the editor afterwards, also when a confirmation was cancelled.
        if (form && value && value !== name)
          void rename(target, position, value)
            .catch(report)
            .finally(() => target.focus());
        else target.focus();
      });
    });
  }
  const cursor = (target: EditorView) => {
    const coords = target.coordsAtPos(target.state.selection.main.head);
    return { x: coords?.left ?? 100, y: (coords?.bottom ?? 100) + 4 };
  };
  const lsp = !!server && ready;
  const back = canNavigate();
  const items: MenuItem[] = [
    {
      label: "Go to Definition",
      shortcut: "F12",
      disabled: !lsp,
      action: () => run((v) => goTo(v, "definition")),
    },
    {
      label: "Go to Declaration",
      disabled: !lsp,
      action: () => run((v) => goTo(v, "declaration")),
    },
    {
      label: "Go to Implementation",
      disabled: !lsp,
      action: () => run((v) => goTo(v, "implementation")),
    },
    {
      label: "Find References",
      shortcut: "Shift+F12",
      disabled: !lsp,
      action: () => run(findReferences),
    },
    "separator",
    {
      label: "Rename Symbol…",
      shortcut: "F2",
      disabled: !lsp,
      action: () => run(startRename),
    },
    {
      label: "Quick Fix…",
      disabled: !lsp,
      action: () =>
        run((v) => {
          const { x, y } = cursor(v);
          return showActions(v, x, y);
        }),
    },
    {
      label: "Format Document",
      disabled: !lsp,
      action: () => run((v) => format(v, false, path)),
    },
    {
      label: "Format Selection",
      disabled: !lsp,
      action: () => run((v) => format(v, true, path)),
    },
    "separator",
    {
      label: "Find / Replace",
      shortcut: "Ctrl+F",
      action: () => {
        const v = view();
        if (v) openSearchPanel(v);
      },
    },
    {
      label: "Go to Line…",
      shortcut: "Ctrl+G",
      action: () => {
        const v = view();
        if (v) gotoLine(v);
      },
    },
    {
      label: "Back",
      disabled: !back.back,
      action: () => void navigate("back"),
    },
    {
      label: "Forward",
      disabled: !back.forward,
      action: () => void navigate("forward"),
    },
    "separator",
    {
      label: "Open Changes",
      disabled: !path || !projectFor(path)?.git,
      action: () => path && host().showDiff(path),
    },
    { label: "Problems", action: () => host().showProblems() },
  ];
  const lspKeys = (event: React.KeyboardEvent) => {
    const v = view();
    if (!v || !lsp || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === "F12") {
      event.preventDefault();
      run(event.shiftKey ? findReferences : (t) => goTo(t, "definition"));
    } else if (event.key === "F2" && !event.shiftKey) {
      event.preventDefault();
      run(startRename);
    }
  };
  const status = !path
    ? "Not saved yet"
    : !serverFor(path)
      ? ""
      : !projectFor(path)
        ? "No project · language features off"
        : server?.status === "ready"
          ? server.progress || "clangd"
          : server?.status === "starting"
            ? "Starting clangd…"
            : "clangd unavailable";
  return (
    <div className="code-editor" onKeyDownCapture={lspKeys}>
      <div className="code-bar">
        <button
          type="button"
          className="code-nav"
          aria-label="Back"
          title="Back"
          disabled={!back.back}
          onClick={() => void navigate("back")}
        >
          ‹
        </button>
        <button
          type="button"
          className="code-nav"
          aria-label="Forward"
          title="Forward"
          disabled={!back.forward}
          onClick={() => void navigate("forward")}
        >
          ›
        </button>
        <span className="code-path" title={path ?? undefined}>
          {path ? displayPath(path) : getDocument(instanceId).name}
        </span>
        {status && <span className="code-status">{status}</span>}
        <button
          type="button"
          className="code-more"
          aria-label="Code actions"
          aria-haspopup="menu"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setPopup(
              popup
                ? null
                : { kind: "menu", x: rect.right - 230, y: rect.bottom + 4 },
            );
          }}
        >
          ⋯
        </button>
      </div>
      {light && (
        <div className="large-file-note">
          Large document · syntax highlighting paused
        </div>
      )}
      <div
        className="editor-host"
        ref={hostElement}
        onContextMenu={(event) => {
          event.preventDefault();
          const v = view();
          // Right-click moves the cursor there unless it is inside the selection.
          const pos = v?.posAtCoords({ x: event.clientX, y: event.clientY });
          if (v && pos != null) {
            const { from, to } = v.state.selection.main;
            if (pos < from || pos > to)
              v.dispatch({ selection: { anchor: pos } });
          }
          setPopup({ kind: "menu", x: event.clientX, y: event.clientY });
        }}
      />
      {popup?.kind === "menu" && (
        <Menu
          label="Code actions"
          items={items}
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.kind === "actions" && (
        <Menu
          label="Quick fixes"
          items={popup.actions.map((action) => ({
            label: action.title,
            action: () => run((v) => runCodeAction(v, action)),
          }))}
          x={popup.x}
          y={popup.y}
          onClose={() => {
            setPopup(null);
            view()?.focus();
          }}
        />
      )}
    </div>
  );
}
