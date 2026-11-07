import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { EditorView } from "@codemirror/view";
import { Markdown } from "../../components/Markdown";
import { keysOf, label as keyLabel } from "../../workspace/keybindings";
import { drawingsBackend } from "../../services/drawings";
import { imageType } from "../excalidraw/drawings";
import { getDocument, hasDocument, useDocuments } from "./documents";
import { samePath } from "../ide/paths";
import { headingSlug, linkTarget } from "./markdownLinks";

/**
 * The Markdown preview of the Text and Code Editors: beside the source or instead of it, kept
 * per tab while the window lives. It renders the unsaved text through the safe `Markdown`
 * component with a README's HTML layout. A link to a heading scrolls there and a link to a
 * local file opens it (through the App's opener); local pictures are read as bytes and
 * shown from blobs, so an SVG's scripts never run. Web links and pictures stay text: the
 * preview is offline and the WebView never navigates.
 */
type LinkOpener = (from: string, path: string) => void;
let linkOpener: LinkOpener | null = null;
/** The App opens a linked file: as code beside code, else as a Text Editor tab. */
export function setMarkdownLinkOpener(next: LinkOpener | null) {
  linkOpener = next;
}
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
  tab = id,
  view,
}: {
  id: string;
  /** The tab showing the document, when it is another view of it. */
  tab?: string;
  view: RefObject<EditorView | null>;
}) {
  useDocuments();
  const text = hasDocument(id) ? getDocument(id).text : "";
  const base = hasDocument(id) ? getDocument(id).path : null;
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
  // Each picture is read once while the preview is shown.
  const pictures = useRef(new Map<string, Promise<string | null>>());
  useEffect(() => {
    const cache = pictures.current;
    return () => {
      for (const pending of cache.values())
        void pending.then((url) => url && URL.revokeObjectURL(url));
      cache.clear();
    };
  }, []);
  const image = useCallback(
    (src: string) => {
      const target = linkTarget(base, src);
      if (target?.kind !== "file") return null;
      const type = imageType(target.path);
      if (!type) return null;
      let pending = pictures.current.get(target.path);
      if (!pending) {
        pending = drawingsBackend
          .readImage(target.path)
          .then((data) => URL.createObjectURL(new Blob([data], { type })))
          .catch(() => null);
        pictures.current.set(target.path, pending);
      }
      return pending;
    },
    [base],
  );
  const scrollTo = (slug: string) => {
    const wanted = slug.toLowerCase();
    const heading = [
      ...(pane.current?.querySelectorAll("h1, h2, h3, h4, h5, h6") ?? []),
    ].find((h) => headingSlug(h.textContent ?? "") === wanted);
    heading?.scrollIntoView({ block: "start" });
  };
  const onLink = (href: string) => {
    const target = linkTarget(base, href);
    if (!target || target.kind === "web") return;
    if (target.kind === "anchor") return scrollTo(target.slug);
    if (base && samePath(target.path, base)) {
      if (target.slug) scrollTo(target.slug);
      return;
    }
    linkOpener?.(tab, target.path);
  };
  return (
    <div className="md-pane" ref={pane}>
      <Markdown
        source={shown}
        className="md-preview"
        label="Markdown preview"
        empty="Nothing to preview yet."
        html
        onLink={onLink}
        image={image}
      />
    </div>
  );
}
