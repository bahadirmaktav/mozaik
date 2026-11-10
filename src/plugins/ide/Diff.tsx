import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Annotation, EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import type { ViewProps } from "../contract";
import { theme } from "../text-editor/theme";
import {
  dirty,
  disposeDocument,
  getDocument,
  hasDocument,
  subscribe as subscribeDocuments,
  updateDocument,
} from "../text-editor/documents";
import { ideBackend } from "../../services/ide";
import { documentFor, host, message } from "./editors";
import { DiffOverview } from "./diffOverview";
import { lineDiff } from "./lineDiff";
import { baseName } from "./paths";
import {
  diffChangesOnly,
  diffSource,
  setDiffDocument,
  subscribe,
  usedByDiff,
  version,
} from "./diffs";
import { displayPath } from "./lsp";
import { language } from "./syntax";

/** Changes only: three lines around each change, the rest folded once six lines or more. */
const COLLAPSE = { margin: 3, minSize: 6 };

/** Marks the editor following its document, so that it is not an edit of its own. */
const fromDocument = Annotation.define<boolean>();

/** The smallest change turning `old` into `next`, so the cursor and scroll stay. */
function difference(old: string, next: string) {
  let from = 0;
  while (from < old.length && from < next.length && old[from] === next[from])
    from++;
  let to = old.length,
    end = next.length;
  while (to > from && end > from && old[to - 1] === next[end - 1]) {
    to--;
    end--;
  }
  return { from, to, insert: next.slice(from, end) };
}

export default function Diff({ instanceId }: ViewProps) {
  useSyncExternalStore(subscribe, version);
  const source = diffSource(instanceId);
  const path = source?.path ?? "";
  const staged = !!source?.staged;
  const commit = source?.commit ?? null;
  const container = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  // The setting's choice until this comparison's bar switches it.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const changesOnly = chosen ?? diffChangesOnly();
  const collapse = useRef(changesOnly);
  collapse.current = changesOnly;
  const shown = useRef<MergeView | null>(null);
  useEffect(() => {
    shown.current?.reconfigure({
      collapseUnchanged: changesOnly ? COLLAPSE : undefined,
    });
  }, [changesOnly]);
  useEffect(() => {
    if (!path) return;
    let merge: MergeView | null = null,
      overview: DiffOverview | null = null,
      unsubscribe = () => {},
      live = true;
    // Both sides' updates (edits, folds, sizes) draw the overview again.
    const follow = EditorView.updateListener.of(() => overview?.schedule());
    const common = () => ({
      parent: container.current!,
      collapseUnchanged: collapse.current ? COLLAPSE : undefined,
      gutter: true,
      // Whole lines first, as Git compares them (see lineDiff).
      diffConfig: { override: lineDiff },
    });
    const show = (view: MergeView) => {
      merge = shown.current = view;
      overview = new DiffOverview(view, container.current!);
      body.current!.append(overview.dom);
      overview.schedule();
    };
    void (async () => {
      if (commit) {
        const { root, hash, parent, oldPath } = commit;
        const [before, after, syntax] = await Promise.all([
          parent
            ? ideBackend.commitText(root, parent, oldPath ?? path)
            : Promise.resolve(null),
          ideBackend.commitText(root, hash, path),
          language(baseName(path)),
        ]);
        if (!live) return;
        const readOnly = [
          lineNumbers(),
          theme,
          syntax,
          follow,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
        ];
        show(
          new MergeView({
            a: {
              doc: before ?? "",
              extensions: [
                ...readOnly,
                EditorView.contentAttributes.of({
                  "aria-label": "Parent version",
                }),
              ],
            },
            b: {
              doc: after ?? "",
              extensions: [
                ...readOnly,
                EditorView.contentAttributes.of({
                  "aria-label": "Commit version",
                }),
              ],
            },
            ...common(),
          }),
        );
        setError(
          after === null
            ? "The commit deleted this file."
            : before === null
              ? "The commit added this file."
              : "",
        );
        return;
      }
      const [head, index, syntax] = await Promise.all([
        ideBackend.headText(path),
        ideBackend.indexText(path),
        language(baseName(path)),
      ]);
      // The working tree side is the file's document: its unsaved edits, and edits here go
      // to it (no document when the file is gone).
      const doc = staged ? null : await documentFor(path).catch(() => null);
      if (doc) {
        setDiffDocument(instanceId, doc);
        // The comparison was closed meanwhile: nothing keeps a document read for it.
        if (
          !diffSource(instanceId) &&
          !usedByDiff(doc) &&
          !host().shows(doc) &&
          !dirty(getDocument(doc))
        )
          disposeDocument(doc);
      }
      if (!live) return;
      const config = [lineNumbers(), theme, syntax, follow];
      const readOnly = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
      ];
      const [before, after] = staged
        ? [head ?? "", index ?? ""]
        : [index ?? head ?? "", doc ? getDocument(doc).text : ""];
      // An edit or revert here first keeps the file open in a code tab behind this one,
      // which saves it and asks before closing; without room the edit is refused.
      const editing = doc
        ? [
            EditorState.transactionFilter.of((tr) => {
              if (!tr.docChanged || tr.annotation(fromDocument)) return tr;
              if (!hasDocument(doc)) return [];
              if (host().keepOpen(doc, instanceId)) return tr;
              host().report("There is no room to open this file for editing");
              return [];
            }),
            EditorView.updateListener.of((update) => {
              if (!update.docChanged || !hasDocument(doc)) return;
              const text = update.state.doc.toString();
              if (getDocument(doc).text !== text) updateDocument(doc, { text });
            }),
          ]
        : readOnly;
      const view = new MergeView({
        a: {
          doc: before,
          extensions: [
            ...config,
            ...readOnly,
            EditorView.contentAttributes.of({
              "aria-label": staged ? "Committed version" : "Staged version",
            }),
          ],
        },
        b: {
          doc: after,
          extensions: [
            ...config,
            ...editing,
            EditorView.contentAttributes.of({
              "aria-label": staged ? "Staged version" : "Current version",
            }),
          ],
        },
        ...common(),
        // As in VS Code: an arrow beside each change puts the staged lines back.
        ...(doc && { revertControls: "a-to-b" as const }),
      });
      show(view);
      if (doc) {
        const editor = view.b;
        unsubscribe = subscribeDocuments(() => {
          // Its code tab was closed (and the edits saved or discarded): read the file again.
          if (!hasDocument(doc)) {
            setDiffDocument(instanceId, null);
            setRound((r) => r + 1);
            return;
          }
          const text = getDocument(doc).text,
            current = editor.state.doc.toString();
          if (text !== current)
            editor.dispatch({
              changes: difference(current, text),
              annotations: fromDocument.of(true),
            });
        });
      }
      setError(
        head === null && index === null
          ? "This file is not in the last commit."
          : "",
      );
    })().catch((e) => live && setError(message(e)));
    return () => {
      live = false;
      unsubscribe();
      overview?.destroy();
      merge?.destroy();
      if (shown.current === merge) shown.current = null;
    };
  }, [path, staged, commit, round]);
  return (
    <div className="diff diff-compare">
      <div className="code-bar">
        <span className="code-path">{path ? displayPath(path) : ""}</span>
        <span className="code-status">
          {commit
            ? `${commit.parent ? commit.parent.slice(0, 7) : "Empty"} ↔ ${commit.hash.slice(0, 7)}`
            : staged
              ? "Last commit ↔ staged"
              : "Staged ↔ current"}
        </span>
        <button
          type="button"
          className="diff-changes-only"
          aria-pressed={changesOnly}
          title={
            changesOnly
              ? "Show the whole file with its changes"
              : "Show only the changes, the unchanged lines folded"
          }
          onClick={() => setChosen(!changesOnly)}
        >
          Changes Only
        </button>
        <button type="button" onClick={() => setRound(round + 1)}>
          Refresh
        </button>
      </div>
      {error && <p className="muted diff-note">{error}</p>}
      <div className="diff-body" ref={body}>
        <div className="diff-host" ref={container} />
      </div>
    </div>
  );
}
