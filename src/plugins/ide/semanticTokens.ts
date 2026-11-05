import { LSPPlugin } from "@codemirror/lsp-client";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { toUri } from "./paths";

/**
 * Colors from what clangd knows the names to be (a class, a parameter, an enumerator, a macro),
 * as VS Code colors C++ on top of its grammar: the language server's semantic tokens. Grammars
 * cannot tell these apart. A file without a server keeps its grammar's colors.
 */
export const semanticCapabilities = {
  dynamicRegistration: false,
  requests: { full: true },
  tokenTypes: [
    "namespace",
    "type",
    "class",
    "enum",
    "interface",
    "struct",
    "typeParameter",
    "concept",
    "parameter",
    "variable",
    "property",
    "enumMember",
    "function",
    "method",
    "macro",
    "modifier",
    "operator",
  ],
  tokenModifiers: ["declaration", "definition", "readonly", "static"],
  formats: ["relative"],
  overlappingTokenSupport: false,
  multilineTokenSupport: false,
};
/** The token types that get a color of their own; others keep the grammar's. */
const KINDS: Record<string, string> = {
  namespace: "namespace",
  type: "type",
  class: "type",
  enum: "type",
  interface: "type",
  struct: "type",
  typeParameter: "type",
  concept: "type",
  parameter: "parameter",
  variable: "variable",
  property: "property",
  enumMember: "enum-member",
  function: "function",
  method: "function",
  macro: "macro",
};
const marks = new Map(
  [...new Set(Object.values(KINDS))].map((kind) => [
    kind,
    Decoration.mark({ class: `cm-sem-${kind}` }),
  ]),
);
const setTokens = StateEffect.define<DecorationSet>();
const tokensField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects)
      if (effect.is(setTokens)) next = effect.value;
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Reads LSP's relative token data (five numbers each) into decorations. */
export function decorate(
  doc: EditorView["state"]["doc"],
  data: readonly number[],
  legend: readonly string[],
) {
  const builder = new RangeSetBuilder<Decoration>();
  let line = 0,
    start = 0;
  for (let i = 0; i + 4 < data.length; i += 5) {
    const deltaLine = data[i];
    line += deltaLine;
    start = deltaLine ? data[i + 1] : start + data[i + 1];
    if (line >= doc.lines) break;
    const mark = marks.get(KINDS[legend[data[i + 3]]]);
    if (!mark) continue;
    const row = doc.line(line + 1);
    const from = row.from + start;
    const to = from + data[i + 2];
    if (to > row.to) continue;
    builder.add(from, to, mark);
  }
  return builder.finish();
}

const requests = (path: () => string | null) =>
  ViewPlugin.fromClass(
    class {
      timer = 0;
      plugin: LSPPlugin | null = null;
      live = true;
      constructor(readonly view: EditorView) {
        this.schedule(0);
      }
      update(update: ViewUpdate) {
        const plugin = LSPPlugin.get(update.view);
        if (plugin !== this.plugin) {
          this.plugin = plugin;
          this.schedule(0);
          // No server any more: the grammar's colors alone.
          if (!plugin)
            queueMicrotask(
              () =>
                this.live &&
                this.view.dispatch({ effects: setTokens.of(Decoration.none) }),
            );
        } else if (update.docChanged) this.schedule(400);
      }
      schedule(delay: number) {
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.request(), delay);
      }
      async request() {
        const plugin = LSPPlugin.get(this.view);
        const file = path();
        const legend = (plugin?.client.serverCapabilities as any)
          ?.semanticTokensProvider?.legend?.tokenTypes as string[] | undefined;
        if (!plugin || !file || !legend) return;
        const doc = this.view.state.doc;
        plugin.client.sync();
        try {
          const answer = await plugin.client.request<
            unknown,
            { data: number[] } | null
          >("textDocument/semanticTokens/full", {
            textDocument: { uri: toUri(file) },
          });
          // The text changed meanwhile: a newer request is on its way.
          if (!this.live || !answer || this.view.state.doc !== doc) return;
          this.view.dispatch({
            effects: setTokens.of(decorate(doc, answer.data, legend)),
          });
        } catch {
          // The grammar's colors stay; a server busy or restarting is no error to report.
        }
      }
      destroy() {
        this.live = false;
        clearTimeout(this.timer);
      }
    },
  );

/** `path` is the file the editor shows. */
export const semanticTokens = (path: () => string | null) => [
  tokensField,
  requests(path),
];
