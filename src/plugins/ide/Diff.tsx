import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import type { ViewProps } from "../contract";
import { theme } from "../text-editor/theme";
import { allDocuments } from "../text-editor/documents";
import { ideBackend } from "../../services/ide";
import { message } from "./editors";
import { baseName, pathKey } from "./paths";
import { diffSource, subscribe, version } from "./diffs";
import { displayPath } from "./lsp";
import { language } from "./syntax";

export default function Diff({ instanceId }: ViewProps) {
  useSyncExternalStore(subscribe, version);
  const source = diffSource(instanceId);
  const path = source?.path ?? "";
  const staged = !!source?.staged;
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!path) return;
    let merge: MergeView | null = null,
      live = true;
    void (async () => {
      const [head, index, syntax] = await Promise.all([
        ideBackend.headText(path),
        ideBackend.indexText(path),
        language(baseName(path)),
      ]);
      const open = allDocuments().find(
        (d) => d.path && pathKey(d.path) === pathKey(path),
      );
      // The editor's text, unsaved edits included; otherwise the file on disk.
      const working = staged
        ? null
        : open
          ? open.text
          : await ideBackend.read(path).then(
              (f) => f.text,
              () => "",
            );
      if (!live) return;
      const config = [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        theme,
        syntax,
      ];
      const [before, after] = staged
        ? [head ?? "", index ?? ""]
        : [index ?? head ?? "", working ?? ""];
      merge = new MergeView({
        a: {
          doc: before,
          extensions: [
            ...config,
            EditorView.contentAttributes.of({
              "aria-label": staged ? "Committed version" : "Staged version",
            }),
          ],
        },
        b: {
          doc: after,
          extensions: [
            ...config,
            EditorView.contentAttributes.of({
              "aria-label": staged ? "Staged version" : "Current version",
            }),
          ],
        },
        parent: host.current!,
        collapseUnchanged: { margin: 3, minSize: 6 },
        gutter: true,
      });
      setError(
        head === null && index === null
          ? "This file is not in the last commit."
          : "",
      );
    })().catch((e) => live && setError(message(e)));
    return () => {
      live = false;
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
      <div className="diff-host" ref={host} />
    </div>
  );
}
