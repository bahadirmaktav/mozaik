import {
  parser as base,
  Strikethrough,
  Table,
  TaskList,
} from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

/** A rendered element from a fixed set of tags. Text is always plain text: raw HTML,
 * scripts, links and images never become live elements or load anything. */
export type MarkdownNode = {
  tag:
    | (typeof tags)[keyof typeof tags]
    | "div"
    | "task"
    | "link"
    | "image"
    | "table"
    | "tbody"
    | "tr"
    | "th"
    | "td";
  children: (MarkdownNode | string)[];
  title?: string;
  checked?: boolean;
  start?: number;
};
const parser = base.configure([Strikethrough, TaskList, Table]);
const tags = {
  ATXHeading1: "h1",
  ATXHeading2: "h2",
  ATXHeading3: "h3",
  ATXHeading4: "h4",
  ATXHeading5: "h5",
  ATXHeading6: "h6",
  SetextHeading1: "h1",
  SetextHeading2: "h2",
  Paragraph: "p",
  Emphasis: "em",
  StrongEmphasis: "strong",
  Strikethrough: "del",
  InlineCode: "code",
  FencedCode: "pre",
  CodeBlock: "pre",
  BulletList: "ul",
  OrderedList: "ol",
  ListItem: "li",
  Blockquote: "blockquote",
  HorizontalRule: "hr",
  HardBreak: "br",
} as const;
const blocks = new Set([
  "Document",
  "BulletList",
  "OrderedList",
  "ListItem",
  "Blockquote",
]);
const marks = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "CodeInfo",
  "QuoteMark",
  "ListMark",
  "LinkMark",
  "URL",
  "LinkTitle",
  "LinkLabel",
  "StrikethroughMark",
  "TaskMarker",
  "LinkReference",
]);
const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
function entity(text: string) {
  const name = text.slice(1, -1);
  const code = /^#x([0-9a-f]+)$/i.exec(name)?.[1];
  const value = code
    ? parseInt(code, 16)
    : /^#(\d+)$/.test(name)
      ? parseInt(name.slice(1), 10)
      : null;
  if (value !== null)
    return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : text;
  return entities[name] ?? text;
}

export function parseMarkdown(source: string): MarkdownNode[] {
  const slice = (from: number, to: number) => source.slice(from, to);
  function inline(node: SyntaxNode, from: number, to: number) {
    const out: (MarkdownNode | string)[] = [];
    let at = from;
    const text = (end: number) => {
      if (end > at) out.push(slice(at, end));
    };
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from >= to) break;
      text(child.from);
      at = child.to;
      const converted = convert(child);
      if (converted !== null) out.push(converted);
    }
    text(to);
    return out;
  }
  // Link and image text lies between the first "[" mark and the matching "]".
  function label(node: SyntaxNode) {
    const marks = node.getChildren("LinkMark");
    return inline(node, marks[0]?.to ?? node.from, marks[1]?.from ?? node.to);
  }
  function convert(node: SyntaxNode): MarkdownNode | string | null {
    const name = node.name;
    if (marks.has(name)) return null;
    if (name === "Escape") return slice(node.from + 1, node.to);
    if (name === "Entity") return entity(slice(node.from, node.to));
    if (name === "Link" || name === "Image") {
      const url = node.getChild("URL");
      return {
        tag: name === "Link" ? "link" : "image",
        children: label(node),
        title: url ? slice(url.from, url.to) : undefined,
      };
    }
    if (name === "Autolink") {
      const url = node.getChild("URL");
      return url ? slice(url.from, url.to) : slice(node.from, node.to);
    }
    if (name === "Task") {
      const marker = node.getChild("TaskMarker");
      return {
        tag: "task",
        checked: !!marker && /x/i.test(slice(marker.from, marker.to)),
        children: inline(node, marker?.to ?? node.from, node.to),
      };
    }
    if (name === "Table") {
      const row = (line: SyntaxNode, cell: "th" | "td"): MarkdownNode => ({
        tag: "tr",
        children: line
          .getChildren("TableCell")
          .map((c) => ({ tag: cell, children: inline(c, c.from, c.to) })),
      });
      const rows: MarkdownNode[] = [];
      for (let line = node.firstChild; line; line = line.nextSibling)
        if (line.name === "TableHeader") rows.push(row(line, "th"));
        else if (line.name === "TableRow") rows.push(row(line, "td"));
      return { tag: "table", children: [{ tag: "tbody", children: rows }] };
    }
    if (name === "FencedCode" || name === "CodeBlock")
      return {
        tag: "pre",
        children: [
          node
            .getChildren("CodeText")
            .map((c) => slice(c.from, c.to))
            .join("\n"),
        ],
      };
    const tag = tags[name as keyof typeof tags];
    if (blocks.has(name)) {
      const children: MarkdownNode[] = [];
      for (let child = node.firstChild; child; child = child.nextSibling) {
        const converted = convert(child);
        if (converted !== null)
          children.push(
            typeof converted === "string"
              ? { tag: "p", children: [converted] }
              : converted,
          );
      }
      const result: MarkdownNode = { tag: tag ?? "div", children };
      if (name === "OrderedList") {
        const mark = node.firstChild?.getChild("ListMark");
        const start = mark ? parseInt(slice(mark.from, mark.to), 10) : 1;
        if (start !== 1 && Number.isFinite(start)) result.start = start;
      }
      return result;
    }
    if (tag) return { tag, children: inline(node, node.from, node.to) };
    // Raw HTML, comments and anything unknown stay visible as source text.
    return slice(node.from, node.to);
  }
  const root = convert(parser.parse(source).topNode);
  return root && typeof root !== "string"
    ? (root.children as MarkdownNode[])
    : [];
}
