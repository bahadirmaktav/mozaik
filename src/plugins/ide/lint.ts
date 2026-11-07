import type { EditorView } from "@codemirror/view";
import { setDiagnostics as setLint } from "@codemirror/lint";
import { allDocuments, getDocument } from "../text-editor/documents";
import {
  diagnosticsOf,
  marksOf,
  onMarks,
  onViewRegistered,
  viewsOf,
} from "./editors";
import { offsetIn } from "./model";
import { pathKey } from "./paths";

/**
 * The problems drawn in a code editor: the language server's diagnostics and the marks of
 * other providers (SonarQube issues) together, since each drawing replaces the last one.
 * Files without a language server get the marks alone.
 */
export function lintSeverity(severity: number) {
  return severity === 1
    ? "error"
    : severity === 2
      ? "warning"
      : severity === 3
        ? "info"
        : "hint";
}
/** Shows a file's problems in a view, mapped onto its current text. */
export function paint(view: EditorView, path: string) {
  const { doc } = view.state;
  const items = [...diagnosticsOf(path), ...marksOf(path)];
  view.dispatch(
    setLint(
      view.state,
      items.map((d) => {
        const from = offsetIn(doc, d.range.start);
        return {
          from,
          to: Math.max(from, offsetIn(doc, d.range.end)),
          severity: lintSeverity(d.severity),
          message: d.message,
          source:
            d.source === "sonarqube"
              ? `SonarQube${d.code ? ` ${d.code}` : ""}`
              : d.source,
        };
      }),
    ),
  );
}
/** Paints every view of the file's open document. */
export function repaint(path: string) {
  const doc = allDocuments().find(
    (d) => d.path && pathKey(d.path) === pathKey(path),
  );
  if (doc) for (const view of viewsOf(doc.id)) paint(view, path);
}

onMarks((paths) => paths.forEach(repaint));
// A view shown later (another tab, an editor group) gets the marks of its file.
onViewRegistered((id, view) => {
  const path = getDocument(id).path;
  // Not inside the view update that is constructing it.
  if (path && marksOf(path).length) queueMicrotask(() => paint(view, path));
});
