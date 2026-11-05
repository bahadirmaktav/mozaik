import { useEffect, useRef, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { Markdown } from "../../components/Markdown";
import { keysOf, label as keyLabel } from "../../workspace/keybindings";
import { getDocument, hasDocument, useDocuments } from "./documents";

/**
 * The Markdown preview of the Text and Code Editors: beside the source or instead of it, kept
 * per tab while the window lives. It renders the unsaved text through the safe `Markdown`
 * component: links and images stay text, nothing loads or navigates.
 */
export type PreviewMode = "off" | "side" | "only";
const modes = new Map<string, PreviewMode>();
const listeners = new Set<() => void>();
export const isMarkdown = (name: string) =>
  /\.(md|markdown|mdown|mkd|mdx)$/i.test(name);
export const previewMode = (id: string) => modes.get(id) ?? "off";
export function setPreviewMode(id: string, mode: PreviewMode) {
  modes.set(id, mode);
  listeners.forEach((fn) => fn());
}
const ORDER: PreviewMode[] = ["off", "side", "only"];
/** The shortcut's step: source, then beside it, then alone, then source again. */
export const nextPreviewMode = (id: string) =>
  setPreviewMode(
    id,
    ORDER[(ORDER.indexOf(previewMode(id)) + 1) % ORDER.length],
  );
export function usePreviewMode(id: string) {
  const [, redraw] = useState(0);
  useEffect(() => {
    const listener = () => redraw((n) => n + 1);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
  return previewMode(id);
}

/** Source, Split and Preview, for the editor's own bar. */
export function PreviewButtons({ id }: { id: string }) {
  const mode = usePreviewMode(id);
  const shortcut = keyLabel(keysOf("markdown.preview"), "");
  const buttons: [PreviewMode, string][] = [
    ["off", "Source"],
    ["side", "Split"],
    ["only", "Preview"],
  ];
  return (
    <span
      className="md-modes"
      role="group"
      aria-label="Markdown preview"
      title={`Markdown preview (${shortcut})`}
    >
      {buttons.map(([value, text]) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => setPreviewMode(id, value)}
        >
          {text}
        </button>
      ))}
    </span>
  );
}

/** The rendered text; while beside the source, it scrolls along with it. */
export function MarkdownPane({
  id,
  view,
}: {
  id: string;
  view: RefObject<EditorView | null>;
}) {
  useDocuments();
  const text = hasDocument(id) ? getDocument(id).text : "";
  // Not on every key: a long document parses in the background of typing.
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => setShown(text), 150);
    return () => clearTimeout(timer);
  }, [text]);
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = view.current?.scrollDOM;
    if (!scroller) return;
    const follow = () => {
      const target = pane.current?.firstElementChild;
      if (!target) return;
      const range = scroller.scrollHeight - scroller.clientHeight;
      target.scrollTop =
        range > 0
          ? (scroller.scrollTop / range) *
            (target.scrollHeight - target.clientHeight)
          : 0;
    };
    scroller.addEventListener("scroll", follow);
    return () => scroller.removeEventListener("scroll", follow);
  }, [view, view.current]);
  return (
    <div className="md-pane" ref={pane}>
      <Markdown
        source={shown}
        className="md-preview"
        label="Markdown preview"
        empty="Nothing to preview yet."
      />
    </div>
  );
}
