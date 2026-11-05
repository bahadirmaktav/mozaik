import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  showDialog,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  lineComment,
  lineUncomment,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from "@codemirror/language";
import { language } from "./syntax";
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
  selectNextOccurrence,
} from "@codemirror/search";
import { lintGutter, lintKeymap } from "@codemirror/lint";
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
  isEmptyArea,
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
  switchSourceHeader,
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
import { pathKey, serverFor, toUri } from "./paths";
import { textChange } from "./model";
import { debugExtension } from "./debugEditor";
import { todoHighlight } from "./todoEditor";
import {
  breakpointsAt,
  removeBreakpoint,
  toggleBreakpoint,
  updateBreakpoint,
} from "./debug";
import { BreakpointDialog } from "./RunAndDebug";
import {
  keysOf,
  label,
  matches,
  useKeybindings,
} from "../../workspace/keybindings";
import { cursorClicks, editingKeys, typable } from "../text-editor/editing";
import { useCommands } from "../../workspace/commands";
import { enabled } from "./features";

/** The shared editing shortcuts, and Go to line as CodeMirror's dialog. */
function codeKeys(view: EditorView, event: KeyboardEvent) {
  if (editingKeys(view, event)) return true;
  if (!matches(event, "editor.line")) return false;
  event.preventDefault();
  return gotoLine(view);
}
/** Ctrl+click goes to the definition while a language server serves the file. */
const definitionClick = (instanceId: string) =>
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (
        event.button !== 0 ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.metaKey
      )
        return false;
      const path = hasDocument(instanceId)
        ? getDocument(instanceId).path
        : null;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (serverForFile(path)?.server.status !== "ready" || pos === null)
        return false;
      event.preventDefault();
      view.dispatch({ selection: { anchor: pos } });
      void goTo(view, "definition").catch((e) => host().report(message(e)));
      return true;
    },
  });

/** The word under the pointer while Ctrl is held: a link to its definition. */
const setLink = StateEffect.define<{ from: number; to: number } | null>();
const linkMark = Decoration.mark({ class: "cm-definition-link" });
const linkField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    for (const effect of transaction.effects)
      if (effect.is(setLink))
        return effect.value
          ? Decoration.set(linkMark.range(effect.value.from, effect.value.to))
          : Decoration.none;
    return transaction.docChanged ? Decoration.none : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
/** As in VS Code: with Ctrl held, the word under the pointer is underlined like a link. */
const definitionHover = (instanceId: string) => [
  linkField,
  ViewPlugin.fromClass(
    class {
      pointer: { x: number; y: number } | null = null;
      ctrl = false;
      constructor(readonly view: EditorView) {
        window.addEventListener("keydown", this.key, true);
        window.addEventListener("keyup", this.key, true);
        window.addEventListener("blur", this.clear);
      }
      key = (event: KeyboardEvent) => {
        if (event.key !== "Control") return;
        this.ctrl = event.type === "keydown";
        this.show();
      };
      clear = () => {
        this.ctrl = false;
        this.show();
      };
      show() {
        const view = this.view;
        let range: { from: number; to: number } | null = null;
        const path = hasDocument(instanceId)
          ? getDocument(instanceId).path
          : null;
        if (
          this.ctrl &&
          this.pointer &&
          serverForFile(path)?.server.status === "ready"
        ) {
          const pos = view.posAtCoords(this.pointer, false);
          const word = pos === null ? null : view.state.wordAt(pos);
          if (word) range = { from: word.from, to: word.to };
        }
        const shown = view.state.field(linkField).iter();
        const now = shown.value ? { from: shown.from, to: shown.to } : null;
        if (
          (!range && !now) ||
          (range && now && now.from === range.from && now.to === range.to)
        )
          return;
        view.dispatch({ effects: setLink.of(range) });
      }
      destroy() {
        window.removeEventListener("keydown", this.key, true);
        window.removeEventListener("keyup", this.key, true);
        window.removeEventListener("blur", this.clear);
      }
    },
    {
      eventHandlers: {
        mousemove(event) {
          this.pointer = { x: event.clientX, y: event.clientY };
          this.ctrl = event.ctrlKey && !event.altKey && !event.shiftKey;
          this.show();
        },
        mouseleave() {
          this.pointer = null;
          this.show();
        },
      },
    },
  ),
];

/** Fold chevrons: shown while the pointer is over the gutter, always on a folded line. */
function foldMarker(open: boolean) {
  const marker = document.createElement("span");
  marker.className = `cm-fold-marker ${open ? "open" : "folded"}`;
  marker.title = open ? "Fold line" : "Unfold line";
  marker.innerHTML =
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  return marker;
}

/**
 * Where each file was left in this window, as in VS Code: a hidden tab has no view and a closed
 * file no state, so its scroll position and cursor wait here. Never written to disk.
 */
const places = new Map<
  string,
  { anchor: number; head: number; scroll: StateEffect<unknown> }
>();
const placeKey = (id: string, path: string | null) =>
  path ? pathKey(path) : id;

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
/** The gutter menu of a line, as in VS Code: add, edit, enable or remove its breakpoint. */
function breakpointItems(
  path: string,
  line: number,
  edit: (focus: "condition" | "hitCondition" | "logMessage") => void,
): MenuItem[] {
  const found = breakpointsAt(path).find((b) => b.line === line);
  if (!found)
    return [
      { label: "Add Breakpoint", action: () => toggleBreakpoint(path, line) },
      { label: "Add Conditional Breakpoint…", action: () => edit("condition") },
      {
        label: "Add Hit Count Breakpoint…",
        action: () => edit("hitCondition"),
      },
      { label: "Add Logpoint…", action: () => edit("logMessage") },
    ];
  return [
    {
      label: "Edit Breakpoint…",
      action: () => edit(found.logMessage ? "logMessage" : "condition"),
    },
    {
      label: found.enabled ? "Disable Breakpoint" : "Enable Breakpoint",
      action: () => updateBreakpoint(found.uid, { enabled: !found.enabled }),
    },
    { label: "Remove Breakpoint", action: () => removeBreakpoint(found.uid) },
  ];
}
type Popup =
  | { kind: "menu"; x: number; y: number }
  | { kind: "gutter"; x: number; y: number; line: number }
  | {
      kind: "breakpoint";
      line: number;
      focus: "condition" | "hitCondition" | "logMessage";
    }
  | { kind: "actions"; x: number; y: number; actions: CodeAction[] };

/** The IDE's code area while no file is open: no tab, no editor (see `isEmptyArea`). */
function EmptyArea() {
  useKeybindings();
  return (
    <div className="code-editor code-empty">
      <p className="muted">
        Open a file from the Explorer or with{" "}
        <kbd>{label(keysOf("palette.files"), "")}</kbd>, or double-click the tab
        bar for a new file.
      </p>
    </div>
  );
}
export default function CodeEditor(props: ViewProps) {
  return isEmptyArea(props.instanceId) ? (
    <EmptyArea />
  ) : (
    <CodeEditorView {...props} />
  );
}
function CodeEditorView({ instanceId, focused }: ViewProps) {
  const hostElement = useRef<HTMLDivElement>(null);
  const commands = useCommands("Code Editor", instanceId, focused);
  const viewRef = useRef<EditorView | null>(null);
  const measured = useRef(false);
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

  // A layout effect: by the time a passive cleanup runs the editor has left the page and
  // reads a scroll position of zero. A view gone before its first measure never applied the
  // place it was given, which therefore stays.
  useLayoutEffect(
    () => () => {
      const view = viewRef.current;
      if (!view || !measured.current) return;
      const { anchor, head } = view.state.selection.main;
      places.set(placeKey(instanceId, path), {
        anchor,
        head,
        scroll: view.scrollSnapshot(),
      });
    },
    [instanceId, path],
  );
  useEffect(() => {
    const doc = getDocument(instanceId);
    const place = places.get(placeKey(instanceId, doc.path));
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
        // A closed file reopened; it may have become shorter since.
        selection: place && {
          anchor: Math.min(place.anchor, doc.text.length),
          head: Math.min(place.head, doc.text.length),
        },
        extensions: [
          // Problem markers, then breakpoints right beside the numbers as in VS Code;
          // folding right of them.
          lintGutter(),
          debugExtension(instanceId),
          lineNumbers(),
          foldGutter({ markerDOM: foldMarker }),
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
          cursorClicks,
          definitionClick(instanceId),
          definitionHover(instanceId),
          highlightActiveLine(),
          highlightSelectionMatches(),
          todoHighlight,
          search({ top: true }),
          keymap.of(
            typable([
              { any: codeKeys },
              ...closeBracketsKeymap,
              ...defaultKeymap,
              // Its Ctrl+D is Workspace Settings' "Add selection to next match".
              ...searchKeymap.filter((b) => b.run !== selectNextOccurrence),
              ...historyKeymap,
              ...foldKeymap,
              ...completionKeymap,
              // Its Ctrl+Shift+M (lint panel) is Minimize Window; Problems lists them.
              ...lintKeymap.filter((b) => b.key !== "Mod-Shift-m"),
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
      scrollTo: place?.scroll,
      dispatch: (transaction) => {
        view.update([transaction]);
        editorStates.set(instanceId, view.state);
        if (transaction.docChanged)
          updateDocument(instanceId, { text: view.state.doc.toString() });
      },
    });
    bindView(view, instanceId);
    viewRef.current = view;
    measured.current = false;
    view.requestMeasure({
      read: () => {
        measured.current = true;
      },
    });
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
      const shown = view.state.doc.toString();
      if (current.text !== shown)
        view.dispatch({ changes: textChange(shown, current.text) });
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
    // Changed while the tab was hidden: only the changed part, so the place survives.
    const shown = view.state.doc.toString();
    if (shown !== doc.text)
      view.dispatch({ changes: textChange(shown, doc.text) });
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
      shortcut: keysOf("code.definition"),
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
      label: "Switch Header/Source",
      shortcut: keysOf("code.header"),
      disabled: !lsp,
      action: () => run(switchSourceHeader),
    },
    {
      label: "Find References",
      shortcut: keysOf("code.references"),
      disabled: !lsp,
      action: () => run(findReferences),
    },
    "separator",
    {
      label: "Rename Symbol…",
      shortcut: keysOf("code.rename"),
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
      label: "Add Selection to Next Find Match",
      shortcut: keysOf("code.next"),
      action: () => {
        const v = view();
        if (v) {
          selectNextOccurrence(v);
          v.focus();
        }
      },
    },
    {
      label: "Add Line Comment",
      shortcut: keysOf("code.comment.add"),
      action: () => {
        const v = view();
        if (v) {
          lineComment(v);
          v.focus();
        }
      },
    },
    {
      label: "Remove Line Comment",
      shortcut: keysOf("code.comment.remove"),
      action: () => {
        const v = view();
        if (v) {
          lineUncomment(v);
          v.focus();
        }
      },
    },
    {
      label: "Go to Line…",
      shortcut: keysOf("editor.line"),
      action: () => {
        const v = view();
        if (v) gotoLine(v);
      },
    },
    {
      label: "Go Back",
      shortcut: keysOf("code.back"),
      disabled: !back.back,
      action: () => void navigate("back"),
    },
    {
      label: "Go Forward",
      shortcut: keysOf("code.forward"),
      disabled: !back.forward,
      action: () => void navigate("forward"),
    },
    "separator",
    ...(enabled("debugging")
      ? [
          {
            label: "Toggle Breakpoint",
            disabled: !path || !projectFor(path),
            action: () => {
              const v = view();
              if (v && path)
                toggleBreakpoint(
                  path,
                  v.state.doc.lineAt(v.state.selection.main.head).number,
                );
            },
          },
        ]
      : []),
    {
      label: "Open Changes",
      disabled: !path || !projectFor(path)?.git,
      action: () => path && host().showDiff(path),
    },
    { label: "Problems", action: () => host().showProblems(path) },
  ];
  commands.current = items;
  const lspKeys = (event: React.KeyboardEvent) => {
    const target = event.target as Element;
    const key = event.nativeEvent;
    // Back and forward through the places the cursor jumped from, as in VS Code.
    const direction = matches(key, "code.back")
      ? "back"
      : matches(key, "code.forward")
        ? "forward"
        : null;
    if (direction && target.closest?.(".cm-editor")) {
      event.preventDefault();
      event.stopPropagation();
      void navigate(direction);
      return;
    }
    if (!view() || !lsp || !target.closest?.(".cm-content")) return;
    const action = matches(key, "code.definition")
      ? (t: EditorView) => goTo(t, "definition")
      : matches(key, "code.references")
        ? findReferences
        : matches(key, "code.rename")
          ? startRename
          : matches(key, "code.header")
            ? switchSourceHeader
            : null;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    run(action);
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
        <span className="code-path" title={path ?? undefined}>
          {path ? displayPath(path) : getDocument(instanceId).name}
        </span>
        {status && (
          <span className="code-status" title={server?.detail || undefined}>
            {status}
          </span>
        )}
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
          // The gutters: the breakpoint menu of that line.
          if (v && (event.target as Element).closest?.(".cm-gutters")) {
            const block = v.lineBlockAtHeight(event.clientY - v.documentTop);
            const line = v.state.doc.lineAt(block.from).number;
            setPopup({
              kind: "gutter",
              x: event.clientX,
              y: event.clientY,
              line,
            });
            return;
          }
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
      {popup?.kind === "gutter" && path && (
        <Menu
          label="Breakpoint"
          items={breakpointItems(path, popup.line, (focus) =>
            setPopup({ kind: "breakpoint", line: popup.line, focus }),
          )}
          x={popup.x}
          y={popup.y}
          onClose={() => setPopup(null)}
        />
      )}
      {popup?.kind === "breakpoint" && path && (
        <BreakpointDialog
          path={path}
          line={popup.line}
          focus={popup.focus}
          breakpoint={
            breakpointsAt(path).find((b) => b.line === popup.line) ?? null
          }
          onClose={() => {
            setPopup(null);
            view()?.focus();
          }}
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
