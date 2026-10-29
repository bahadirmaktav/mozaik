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
import { baseName } from "./paths";
import {
  diffSource,
  setDiffDocument,
  subscribe,
  usedByDiff,
  version,
} from "./diffs";
import { displayPath } from "./lsp";
import { language } from "./syntax";

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
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!path) return;
    let merge: MergeView | null = null,
      unsubscribe = () => {},
      live = true;
    void (async () => {
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
      const config = [lineNumbers(), theme, syntax];
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
      merge = new MergeView({
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
        parent: container.current!,
        collapseUnchanged: { margin: 3, minSize: 6 },
        gutter: true,
        // As in VS Code: an arrow beside each change puts the staged lines back.
        ...(doc && { revertControls: "a-to-b" as const }),
      });
      if (doc) {
        const view = merge.b;
        unsubscribe = subscribeDocuments(() => {
          // Its code tab was closed (and the edits saved or discarded): read the file again.
          if (!hasDocument(doc)) {
            setDiffDocument(instanceId, null);
            setRound((r) => r + 1);
            return;
          }
          const text = getDocument(doc).text,
            shown = view.state.doc.toString();
          if (text !== shown)
            view.dispatch({
              changes: difference(shown, text),
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
      merge?.destroy();
    };
  }, [path, staged, round]);
  return (
    <div className="diff">
      <div className="code-bar">
        <span className="code-path">{path ? displayPath(path) : ""}</span>
        <span className="code-status">
          {staged ? "Last commit ↔ staged" : "Staged ↔ current"}
        </span>
        <button type="button" onClick={() => setRound(round + 1)}>
          Refresh
        </button>
      </div>
      {error && <p className="muted diff-note">{error}</p>}
      <div className="diff-host" ref={container} />
    </div>
  );
}
