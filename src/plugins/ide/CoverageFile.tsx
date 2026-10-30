import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  EditorSelection,
  EditorState,
  RangeSetBuilder,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  gutter,
  GutterMarker,
  lineNumbers,
} from "@codemirror/view";
import type { ViewProps } from "../contract";
import { theme } from "../text-editor/theme";
import { ideBackend } from "../../services/ide";
import {
  coverageTab,
  fileCoverage,
  isStale,
  subscribe,
  version,
} from "./coverage";
import {
  lineState,
  percent,
  totals,
  type FileCoverage,
  type LineCoverage,
} from "./coverageModel";
import { message, reveal } from "./editors";
import { displayPath } from "./lsp";
import { baseName } from "./paths";
import { language } from "./syntax";

const compact = (hits: number) =>
  hits >= 1e6
    ? `${Math.round(hits / 1e5) / 10}M`
    : hits >= 1e3
      ? `${Math.round(hits / 100) / 10}k`
      : String(hits);
/** A line's hit count in the gutter, as VS Code's coverage gutter shows it. */
class Hits extends GutterMarker {
  constructor(readonly line: LineCoverage) {
    super();
  }
  eq(other: GutterMarker) {
    return (
      other instanceof Hits &&
      other.line.hits === this.line.hits &&
      other.line.branches?.covered === this.line.branches?.covered
    );
  }
  toDOM() {
    const hits = document.createElement("span");
    hits.className = `cm-coverage-hits ${lineState(this.line)}`;
    hits.textContent = `${compact(this.line.hits)}×`;
    const { branches } = this.line;
    hits.title = `${this.line.hits} hit${this.line.hits === 1 ? "" : "s"}${
      branches ? ` · ${branches.covered} of ${branches.total} branches` : ""
    }`;
    return hits;
  }
}
/** Line colours and hit counts for the report's lines of this file. */
function coverageLines(file: FileCoverage, state: EditorState) {
  const lines = new RangeSetBuilder<Decoration>();
  const markers = new RangeSetBuilder<GutterMarker>();
  for (const [number, line] of [...file.lines].sort((a, b) => a[0] - b[0])) {
    if (number > state.doc.lines) break;
    const from = state.doc.line(number).from;
    lines.add(
      from,
      from,
      Decoration.line({ class: `cm-coverage-${lineState(line)}` }),
    );
    markers.add(from, from, new Hits(line));
  }
  const markerSet = markers.finish();
  return [
    EditorView.decorations.of(lines.finish()),
    gutter({ class: "cm-coverage-gutter", markers: () => markerSet }),
  ];
}
/** The next (or previous) line the tests never reached, after the cursor, wrapping. */
function uncovered(view: EditorView, file: FileCoverage, forward: boolean) {
  const here = view.state.doc.lineAt(view.state.selection.main.head).number;
  const lines = [...file.lines]
    .filter(([n, l]) => lineState(l) !== "covered" && n <= view.state.doc.lines)
    .map(([n]) => n)
    .sort((a, b) => a - b);
  if (!lines.length) return false;
  const next = forward
    ? (lines.find((n) => n > here) ?? lines[0])
    : ([...lines].reverse().find((n) => n < here) ?? lines[lines.length - 1]);
  const line = view.state.doc.line(next);
  view.dispatch({
    selection: EditorSelection.cursor(line.from),
    effects: EditorView.scrollIntoView(line.from, { y: "center" }),
  });
  view.focus();
  return true;
}

/**
 * One file of the coverage report, read only: its current text from disk with covered
 * lines green, partly covered (branches left) yellow and uncovered red, and hit counts in
 * the gutter. Editing happens in the file's code tab ("Open in Editor").
 */
export default function CoverageFile({ instanceId }: ViewProps) {
  useSyncExternalStore(subscribe, version);
  const tab = coverageTab(instanceId);
  const path = tab?.path ?? "";
  const file = tab ? fileCoverage(tab.project, path) : null;
  const stale = !!tab && isStale(tab.project, path);
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!path || !file) return;
    let live = true;
    void (async () => {
      const [read, syntax] = await Promise.all([
        ideBackend.read(path),
        language(baseName(path)),
      ]);
      if (!live) return;
      // The coverage marks need the text's lines; a refresh keeps the cursor.
      const base = EditorState.create({ doc: read.text });
      const head = Math.min(
        editor.current?.state.selection.main.head ?? 0,
        base.doc.length,
      );
      editor.current?.destroy();
      editor.current = new EditorView({
        parent: container.current!,
        state: EditorState.create({
          doc: base.doc,
          selection: EditorSelection.cursor(head),
          extensions: [
            lineNumbers(),
            theme,
            syntax,
            EditorState.readOnly.of(true),
            EditorView.contentAttributes.of({
              "aria-label": `Coverage of ${baseName(path)}`,
            }),
            coverageLines(file, base),
          ],
        }),
      });
      setError(
        [...file.lines.keys()].some((n) => n > base.doc.lines)
          ? "The report names lines past the end of this file: it changed since."
          : "",
      );
    })().catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [path, file, round]);
  useEffect(
    () => () => {
      editor.current?.destroy();
      editor.current = null;
    },
    [],
  );
  const count = file ? totals([file]) : null;
  const move = (forward: boolean) => {
    const view = editor.current;
    if (view && file && !uncovered(view, file, forward))
      setError("Every line of this file ran.");
  };
  return (
    <div className="diff coverage-file-view">
      <div className="code-bar">
        <span className="code-path">{path ? displayPath(path) : ""}</span>
        {count && (
          <span className="code-status">
            {[
              `Lines ${percent(count.lines)} (${count.lines.covered}/${count.lines.total})`,
              count.functions.total &&
                `Functions ${count.functions.covered}/${count.functions.total}`,
              count.branches.total &&
                `Branches ${count.branches.covered}/${count.branches.total}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        <button
          type="button"
          title="Previous uncovered line"
          aria-label="Previous Uncovered Line"
          disabled={!file}
          onClick={() => move(false)}
        >
          ↑
        </button>
        <button
          type="button"
          title="Next uncovered line"
          aria-label="Next Uncovered Line"
          disabled={!file}
          onClick={() => move(true)}
        >
          ↓
        </button>
        <button type="button" onClick={() => setRound(round + 1)}>
          Refresh
        </button>
        <button
          type="button"
          disabled={!path}
          onClick={() => {
            const view = editor.current;
            const line = view
              ? view.state.doc.lineAt(view.state.selection.main.head).number
              : 1;
            void reveal(path, { line, column: 1 }).catch((e) =>
              setError(message(e)),
            );
          }}
        >
          Open in Editor
        </button>
      </div>
      {!file && (
        <p className="muted diff-note">
          The coverage report has no data for this file (it was closed or read
          again without it).
        </p>
      )}
      {stale && (
        <p className="muted diff-note" role="status">
          This file changed after the report was written; lines may not match.
        </p>
      )}
      {error && <p className="muted diff-note">{error}</p>}
      <div className="diff-host" ref={container} />
    </div>
  );
}
