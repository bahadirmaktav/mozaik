import { LSPPlugin } from "@codemirror/lsp-client";
import { StateEffect, StateField, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { serverFor, toUri } from "./paths";
import { onRefresh } from "./refresh";

/**
 * Inlay hints, as VS Code shows rust-analyzer's: a variable's inferred type and a call's
 * parameter names, drawn faintly in the text but never part of it. Only Rust files ask for
 * them (Settings → IDE → Rust turns them off on the server).
 */
export interface InlayHint {
  position: { line: number; character: number };
  label: string | { value: string }[];
  /** 1 type, 2 parameter. */
  kind?: number;
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

class HintWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: number,
    readonly left: boolean,
    readonly right: boolean,
  ) {
    super();
  }
  eq(other: HintWidget) {
    return (
      other.text === this.text &&
      other.kind === this.kind &&
      other.left === this.left &&
      other.right === this.right
    );
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-inlay-hint${this.kind === 2 ? " cm-inlay-parameter" : ""}`;
    span.textContent = this.text;
    if (this.left) span.style.marginLeft = "0.3em";
    if (this.right) span.style.marginRight = "0.3em";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

export const labelOf = (hint: InlayHint) =>
  typeof hint.label === "string"
    ? hint.label
    : hint.label.map((part) => part.value).join("");

/** The hints as widgets; ones past the end of a line or the document are left out. */
export function hintDecorations(doc: Text, hints: readonly InlayHint[]) {
  const ranges = [];
  for (const hint of hints) {
    const { line, character } = hint.position;
    if (line >= doc.lines) continue;
    const row = doc.line(line + 1);
    if (character > row.length) continue;
    const text = labelOf(hint).trim();
    if (!text) continue;
    ranges.push(
      Decoration.widget({
        widget: new HintWidget(
          text,
          hint.kind ?? 0,
          !!hint.paddingLeft,
          !!hint.paddingRight,
        ),
        side: 1,
      }).range(row.from + character),
    );
  }
  return Decoration.set(ranges, true);
}

const setHints = StateEffect.define<DecorationSet>();
const hintsField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setHints)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const requests = (path: () => string | null) =>
  ViewPlugin.fromClass(
    class {
      timer = 0;
      plugin: LSPPlugin | null = null;
      live = true;
      stopRefresh = onRefresh("inlayHints", () => this.schedule(0));
      constructor(readonly view: EditorView) {
        this.schedule(0);
      }
      update(update: ViewUpdate) {
        const plugin = LSPPlugin.get(update.view);
        if (plugin !== this.plugin) {
          this.plugin = plugin;
          this.schedule(0);
          if (!plugin)
            queueMicrotask(
              () =>
                this.live &&
                this.view.dispatch({ effects: setHints.of(Decoration.none) }),
            );
        } else if (update.docChanged) this.schedule(500);
      }
      schedule(delay: number) {
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.request(), delay);
      }
      async request() {
        const plugin = LSPPlugin.get(this.view);
        const file = path();
        if (
          !plugin ||
          !file ||
          serverFor(file)?.server !== "rust-analyzer" ||
          !(plugin.client.serverCapabilities as any)?.inlayHintProvider
        )
          return;
        const doc = this.view.state.doc;
        plugin.client.sync();
        try {
          const hints = await plugin.client.request<
            unknown,
            InlayHint[] | null
          >("textDocument/inlayHint", {
            textDocument: { uri: toUri(file) },
            range: {
              start: { line: 0, character: 0 },
              // The end of the last line: a position past it is an error to the server.
              end: {
                line: doc.lines - 1,
                character: doc.line(doc.lines).length,
              },
            },
          });
          if (!this.live || this.view.state.doc !== doc) return;
          this.view.dispatch({
            effects: setHints.of(hintDecorations(doc, hints ?? [])),
          });
        } catch {
          // A server still loading the workspace answers later edits.
        }
      }
      destroy() {
        this.live = false;
        this.stopRefresh();
        clearTimeout(this.timer);
      }
    },
  );

/** `path` is the file the editor shows. */
export const inlayHints = (path: () => string | null) => [
  hintsField,
  requests(path),
];
