import {
  createElement,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  parseMarkdown,
  type DiagramKind,
  type MarkdownNode,
} from "./parseMarkdown";

/** A picture's address for an `<img>` (a blob URL), or null when it cannot be shown. */
export type ImageLoader = (src: string) => Promise<string | null> | null;
/** A diagram drawn as a picture (a blob URL); rejects with the reason it cannot be drawn. */
export type DiagramLoader = (
  kind: DiagramKind,
  code: string,
) => Promise<string>;

/** Safe Markdown preview: a fixed set of elements and plain text. Without `onLink` and
 * `image` (Tasks and Notes), links and images never navigate or load anything; with them,
 * the owner decides what a link opens and which local pictures are read (as blobs). */
export function Markdown({
  source,
  className,
  label,
  empty,
  html,
  onLink,
  image,
  diagram,
}: {
  source: string;
  className: string;
  label: string;
  empty: string;
  /** Keeps the allowed HTML tags of the source (a README's layout) as elements. */
  html?: boolean;
  onLink?: (href: string) => void;
  image?: ImageLoader;
  /** Draws Mermaid and SVG blocks; without it they stay code. */
  diagram?: DiagramLoader;
}) {
  const nodes = useMemo(() => parseMarkdown(source, { html }), [source, html]);
  const context: Context = { onLink, image, diagram };
  return (
    <div className={`markdown ${className}`} aria-label={label}>
      {nodes.length ? render(nodes, context) : <p className="muted">{empty}</p>}
    </div>
  );
}
interface Context {
  onLink?: (href: string) => void;
  image?: ImageLoader;
  diagram?: DiagramLoader;
}
const size = (value: string | undefined) =>
  value && /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
function style(node: MarkdownNode): CSSProperties | undefined {
  const css: CSSProperties = {};
  if (node.align && node.tag !== "image") css.textAlign = node.align;
  if (node.tag !== "image" && node.width) css.width = size(node.width);
  return Object.keys(css).length ? css : undefined;
}
function render(
  nodes: (MarkdownNode | string)[],
  context: Context,
): ReactNode[] {
  return nodes.map((node, key) => {
    if (typeof node === "string") return node;
    const children = render(node.children, context);
    switch (node.tag) {
      case "link": {
        const { onLink } = context;
        const href = node.href;
        if (!onLink || !href)
          return (
            <span key={key} className="md-link" title={node.title ?? href}>
              {children}
            </span>
          );
        // Not an `<a>`: the WebView never navigates; the owner opens what it points at.
        const follow = () => onLink(href);
        return (
          <span
            key={key}
            className="md-link live"
            role="link"
            tabIndex={0}
            title={node.title ?? href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              follow();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              follow();
            }}
          >
            {children}
          </span>
        );
      }
      case "image":
        return context.image && node.src ? (
          <Picture key={key} node={node} load={context.image} />
        ) : (
          <span key={key} className="md-image" title={node.title ?? node.src}>
            [{children.length ? children : node.alt || "image"}]
          </span>
        );
      case "diagram":
        return context.diagram ? (
          <Diagram key={key} node={node} load={context.diagram} />
        ) : (
          <pre key={key}>{node.code}</pre>
        );
      case "task":
        return (
          <span key={key} className={node.checked ? "md-task done" : "md-task"}>
            <input
              type="checkbox"
              checked={!!node.checked}
              readOnly
              disabled
              aria-label={node.checked ? "Completed" : "Not completed"}
            />{" "}
            {children}
          </span>
        );
      case "hr":
      case "br":
        return createElement(node.tag, { key });
      case "ol":
        return (
          <ol key={key} start={node.start} style={style(node)}>
            {children}
          </ol>
        );
      case "td":
      case "th":
        return createElement(
          node.tag,
          {
            key,
            colSpan: node.colSpan,
            rowSpan: node.rowSpan,
            style: style(node),
          },
          ...children,
        );
      case "details":
        return (
          <details key={key} open={node.open}>
            {children}
          </details>
        );
      default:
        return createElement(
          node.tag,
          { key, style: style(node), title: node.title },
          ...children,
        );
    }
  });
}

/** A local picture, read by the owner; its text until then, or when it cannot be shown. */
function Picture({ node, load }: { node: MarkdownNode; load: ImageLoader }) {
  const src = node.src!;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stale = false;
    setUrl(null);
    setFailed(false);
    const pending = load(src);
    if (!pending) return void setFailed(true);
    pending.then(
      (result) => {
        if (stale) return;
        if (result) setUrl(result);
        else setFailed(true);
      },
      () => !stale && setFailed(true),
    );
    return () => {
      stale = true;
    };
  }, [src, load]);
  const text = node.alt || node.title || "image";
  if (!url)
    return (
      <span
        className={failed ? "md-image missing" : "md-image"}
        title={node.title ?? src}
      >
        [{text}]
      </span>
    );
  const css: CSSProperties = {};
  if (node.width) css.width = size(node.width);
  if (node.height) css.height = size(node.height);
  if (node.align === "left" || node.align === "right") css.float = node.align;
  return (
    <img
      className="md-picture"
      src={url}
      alt={node.alt ?? ""}
      title={node.title}
      style={css}
      draggable={false}
      onError={() => {
        setUrl(null);
        setFailed(true);
      }}
    />
  );
}

/**
 * A Mermaid or SVG block drawn as a picture: never live SVG, so its scripts never run and it
 * loads nothing. Its code shows until it is drawn, and with the reason when it cannot be.
 */
function Diagram({ node, load }: { node: MarkdownNode; load: DiagramLoader }) {
  const code = node.code ?? "";
  const kind = node.diagram ?? "svg";
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    let stale = false;
    load(kind, code).then(
      (url) => !stale && setState({ url }),
      (error: unknown) =>
        !stale &&
        setState({
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      stale = true;
    };
  }, [kind, code, load]);
  if (state.url)
    return (
      <div className="md-diagram">
        <img
          src={state.url}
          alt={kind === "mermaid" ? "Mermaid diagram" : "SVG picture"}
          draggable={false}
          onError={() => setState({ error: "The picture cannot be shown." })}
        />
      </div>
    );
  return (
    <div className={state.error ? "md-diagram failed" : "md-diagram pending"}>
      {state.error && (
        <p className="md-diagram-error" role="note">
          {kind === "mermaid" ? "Mermaid" : "SVG"}: {state.error}
        </p>
      )}
      <pre>{code}</pre>
    </div>
  );
}
