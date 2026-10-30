import { EditorState } from "@codemirror/state";
import { javascript } from "@codemirror/lang-javascript";
import { ensureSyntaxTree } from "@codemirror/language";
import { history } from "@codemirror/commands";
import { performance } from "node:perf_hooks";
const line =
  'export const example = (value) => ({ value, title: "Mozaik" });\n';
const results = [];
for (const bytes of [64 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
  const doc = line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
  for (const syntax of [true, false]) {
    const start = performance.now();
    const state = EditorState.create({
      doc,
      extensions: [history(), ...(syntax ? [javascript()] : [])],
    });
    const created = performance.now();
    const tree = syntax ? ensureSyntaxTree(state, state.doc.length, 500) : null;
    results.push({
      bytes,
      syntax,
      createMs: +(created - start).toFixed(2),
      parseMs: +(performance.now() - created).toFixed(2),
      parsedAll: syntax ? Boolean(tree) : null,
    });
  }
}
console.log(
  JSON.stringify(
    { node: process.version, platform: process.platform, results },
    null,
    2,
  ),
);
