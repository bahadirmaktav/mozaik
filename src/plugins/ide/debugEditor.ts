import { createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  RangeSet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  hoverTooltip,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { getDocument, hasDocument } from "../text-editor/documents";
import {
  breakpointsAt,
  hoverValue,
  isDebugging,
  moveBreakpoints,
  pausedAt,
  projectDebug,
  refusal,
  subscribe,
  toggleBreakpoint,
  verification,
} from "./debug";
import { KIND_LABELS, expressionAt, kindOf, samePath } from "./debugModel";
import { ValueTree } from "./DebugValues";
import { host } from "./editors";
import { projectFor } from "./projects";

/**
 * The Code Editor's debugging: breakpoints in a gutter left of the line numbers (click to
 * toggle), the paused line, and Debug Hover while the program is paused.
 */
class Marker extends GutterMarker {
  constructor(
    readonly uid: string,
    readonly kind: string,
    readonly title: string,
  ) {
    super();
  }
  eq(other: GutterMarker) {
    return (
      other instanceof Marker &&
      other.uid === this.uid &&
      other.kind === this.kind &&
      other.title === this.title
    );
  }
  toDOM() {
    const dot = document.createElement("span");
    dot.className = `cm-breakpoint ${this.kind}`;
    dot.title = this.title;
    return dot;
  }
}
class PausedMarker extends GutterMarker {
  constructor(readonly top: boolean) {
    super();
  }
  eq(other: GutterMarker) {
    return other instanceof PausedMarker && other.top === this.top;
  }
  toDOM() {
    const arrow = document.createElement("span");
    arrow.className = `cm-debug-arrow${this.top ? "" : " frame"}`;
    return arrow;
  }
}

const setMarks = StateEffect.define<RangeSet<Marker>>();
const editing = (tr: Transaction) =>
  ["input", "delete", "move", "undo", "redo"].some((e) => tr.isUserEvent(e));
/** Breakpoints follow typing; a replaced document gets them again from the store. */
const marks = StateField.define<RangeSet<Marker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects)
      if (effect.is(setMarks)) value = effect.value;
    return value;
  },
});
const setPaused = StateEffect.define<{ line: number; top: boolean } | null>();
const paused = StateField.define<{ line: number; top: boolean } | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects)
      if (effect.is(setPaused)) value = effect.value;
    return value;
  },
});
const pausedLine = (state: EditorState) => {
  const at = state.field(paused);
  if (!at || at.line > state.doc.lines) return null;
  return { from: state.doc.line(at.line).from, top: at.top };
};
const pausedDecorations = EditorView.decorations.compute([paused], (state) => {
  const at = pausedLine(state);
  return at
    ? Decoration.set(
        Decoration.line({
          class: at.top ? "cm-debug-paused" : "cm-debug-frame",
        }).range(at.from),
      )
    : (Decoration.none as DecorationSet);
});

function title(uid: string, kind: string, enabled: boolean) {
  if (!enabled) return `${kind} (disabled)`;
  const refused = refusal(uid);
  if (refused) return `${kind}: ${refused}`;
  const answer = verification(uid);
  if (answer && !answer.verified)
    return `${kind}: not bound${answer.message ? ` (${answer.message})` : ""}`;
  return kind;
}
function wanted(path: string | null, state: EditorState) {
  const root = path ? (projectFor(path)?.root ?? null) : null;
  const active = projectDebug(root)?.active ?? true;
  const debugging = isDebugging();
  const ranges = breakpointsAt(path)
    .filter((b) => b.line <= state.doc.lines)
    .map((b) => {
      const kind = kindOf(b);
      const answer = verification(b.uid);
      const classes = [
        kind,
        !b.enabled && "disabled",
        !active && "inactive",
        refusal(b.uid) && "refused",
        debugging && answer && !answer.verified && "unverified",
      ].filter(Boolean);
      return new Marker(
        b.uid,
        classes.join(" "),
        title(b.uid, KIND_LABELS[kind], b.enabled),
      ).range(state.doc.line(b.line).from);
    });
  return RangeSet.of(ranges, true);
}
function same(a: RangeSet<Marker>, b: RangeSet<Marker>) {
  const list = (set: RangeSet<Marker>) => {
    const out: string[] = [];
    for (let i = set.iter(); i.value; i.next())
      out.push(`${i.from}:${i.value.uid}:${i.value.kind}:${i.value.title}`);
    return out.join("|");
  };
  return list(a) === list(b);
}

/** Keeps a view's breakpoints and paused line in step with the debugging store. */
const sync = (id: string) =>
  ViewPlugin.fromClass(
    class {
      unsubscribe: () => void;
      queued = false;
      constructor(readonly view: EditorView) {
        this.unsubscribe = subscribe(() => this.schedule());
        this.schedule();
      }
      schedule() {
        if (this.queued) return;
        this.queued = true;
        queueMicrotask(() => {
          this.queued = false;
          this.refresh();
        });
      }
      refresh() {
        if (!hasDocument(id)) return;
        const path = getDocument(id).path;
        const { state } = this.view;
        const effects: StateEffect<unknown>[] = [];
        const next = wanted(path, state);
        if (!same(state.field(marks), next)) effects.push(setMarks.of(next));
        const at = pausedAt();
        const want =
          at && path && samePath(at.path, path)
            ? { line: at.line, top: at.top }
            : null;
        const have = state.field(paused);
        if (want?.line !== have?.line || want?.top !== have?.top)
          effects.push(setPaused.of(want));
        if (effects.length) this.view.dispatch({ effects });
      }
      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        const path = hasDocument(id) ? getDocument(id).path : null;
        if (path && update.transactions.some(editing)) {
          // Typing moved the markers: their lines become the breakpoints' lines.
          const lines = new Map<string, number>();
          const set = update.state.field(marks);
          for (let i = set.iter(); i.value; i.next())
            lines.set(i.value.uid, update.state.doc.lineAt(i.from).number);
          queueMicrotask(() => moveBreakpoints(path, lines));
        } else this.schedule();
      }
      destroy() {
        this.unsubscribe();
      }
    },
  );

export function debugExtension(id: string): Extension {
  return [
    marks,
    paused,
    pausedDecorations,
    sync(id),
    gutter({
      class: "cm-breakpoint-gutter",
      markers: (view) => {
        const at = pausedLine(view.state);
        return [
          view.state.field(marks),
          at
            ? RangeSet.of([new PausedMarker(at.top).range(at.from)])
            : RangeSet.empty,
        ];
      },
      domEventHandlers: {
        mousedown(view, line, event) {
          if ((event as MouseEvent).button !== 0) return false;
          const path = hasDocument(id) ? getDocument(id).path : null;
          if (!path) {
            host().report("Save the file before setting breakpoints");
            return true;
          }
          toggleBreakpoint(path, view.state.doc.lineAt(line.from).number);
          return true;
        },
      },
    }),
    hoverTooltip(
      async (view, pos) => {
        if (!pausedAt()) return null;
        const line = view.state.doc.lineAt(pos);
        const expression = expressionAt(line.text, pos - line.from);
        if (!expression) return null;
        const value = await hoverValue(expression.text);
        if (!value) return null;
        return {
          pos: line.from + expression.from,
          end: line.from + expression.to,
          above: true,
          create() {
            const dom = document.createElement("div");
            dom.className = "debug-hover";
            const root = createRoot(dom);
            root.render(
              createElement(ValueTree, {
                name: expression.text,
                value,
                path: `hover:${expression.text}`,
              }),
            );
            return { dom, destroy: () => queueMicrotask(() => root.unmount()) };
          },
        };
      },
      { hoverTime: 400 },
    ),
  ];
}
