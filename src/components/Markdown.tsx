import { createElement, useMemo, type ReactNode } from "react";
import { parseMarkdown, type MarkdownNode } from "./parseMarkdown";

/** Safe Markdown preview: a fixed set of elements, plain text, and links and images that
 * never navigate or load anything. Shared by Tasks and Notes. */
export function Markdown({
  source,
  className,
  label,
  empty,
}: {
  source: string;
  className: string;
  label: string;
  empty: string;
}) {
  const nodes = useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className={`markdown ${className}`} aria-label={label}>
      {nodes.length ? render(nodes) : <p className="muted">{empty}</p>}
    </div>
  );
}
function render(nodes: (MarkdownNode | string)[]): ReactNode[] {
  return nodes.map((node, key) => {
    if (typeof node === "string") return node;
    const children = render(node.children);
    switch (node.tag) {
      // Links and images stay text: the panel never navigates or loads resources.
      case "link":
        return (
          <span key={key} className="md-link" title={node.title}>
            {children}
          </span>
        );
      case "image":
        return (
          <span key={key} className="md-image" title={node.title}>
            [{children.length ? children : "image"}]
          </span>
        );
      case "task":
        return (
          <span key={key} className="md-task">
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
          <ol key={key} start={node.start}>
            {children}
          </ol>
        );
      default:
        return createElement(node.tag, { key }, ...children);
    }
  });
}
