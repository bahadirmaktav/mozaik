import {
  parser as base,
  Strikethrough,
  Table,
  TaskList,
} from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

/** A rendered element from a fixed set of tags. Text is always plain text and scripts never
 * become live elements; links and images only carry their address for the renderer. Raw
 * HTML stays source text unless `html` is asked for: then a fixed set of tags and attributes
 * (a README's layout: `<p align>`, `<img>`, `<table>`, `<sub>`, …) becomes elements. */
export type MarkdownNode = {
  tag:
    | (typeof tags)[keyof typeof tags]
    | (typeof htmlTags)[keyof typeof htmlTags]
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
  /** A link's address, as written. */
  href?: string;
  /** An image's address, as written, and its text. */
  src?: string;
  alt?: string;
  /** From HTML only: alignment, an image's or cell's size, a cell's span, an open details. */
  align?: "left" | "right" | "center" | "justify";
  width?: string;
  height?: string;
  colSpan?: number;
  rowSpan?: number;
  open?: boolean;
};
export interface MarkdownOptions {
  /** Keeps the allowed HTML tags as elements instead of source text. */
  html?: boolean;
}
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
/** The HTML tags kept, and what they become. Others keep only their content. */
const htmlTags = {
  p: "p",
  div: "div",
  center: "div",
  span: "span",
  a: "link",
  img: "image",
  br: "br",
  hr: "hr",
  sub: "sub",
  sup: "sup",
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  u: "u",
  s: "del",
  del: "del",
  strike: "del",
  ins: "ins",
  mark: "mark",
  small: "small",
  code: "code",
  kbd: "kbd",
  pre: "pre",
  blockquote: "blockquote",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  ul: "ul",
  ol: "ol",
  li: "li",
  dl: "dl",
  dt: "dt",
  dd: "dd",
  table: "table",
  thead: "thead",
  tbody: "tbody",
  tfoot: "tfoot",
  tr: "tr",
  th: "th",
  td: "td",
  details: "details",
  summary: "summary",
} as const;
const VOID = new Set([
  "br",
  "hr",
  "img",
  "wbr",
  "source",
  "input",
  "meta",
  "link",
  "area",
  "col",
  "embed",
  "param",
  "track",
]);
/** Tags dropped with their content. */
const DROPPED = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "template",
  "noscript",
  "textarea",
  "title",
  "select",
  "button",
  "svg",
  "math",
  "head",
]);
/** Elements whose text between tags is only layout whitespace. */
const STRUCTURE = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "ul",
  "ol",
  "dl",
]);
type Open = { open: string; attrs: Record<string, string>; closed: boolean };
type Close = { close: string };
type Item = MarkdownNode | string | Open | Close;
const isOpen = (item: Item): item is Open =>
  typeof item === "object" && "open" in item && "attrs" in item;
const isClose = (item: Item): item is Close =>
  typeof item === "object" && "close" in item;
const TAG =
  /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m) => entity(m));
/** HTML source as text and tags, in order; comments are left out. */
function htmlItems(source: string): Item[] {
  const items: Item[] = [];
  let at = 0;
  const text = (end: number) => {
    if (end > at) items.push(decode(source.slice(at, end)));
  };
  for (const match of source.matchAll(TAG)) {
    text(match.index);
    at = match.index + match[0].length;
    const [, slash, name, attributes, self] = match;
    if (!name) continue;
    const tag = name.toLowerCase();
    if (slash) {
      items.push({ close: tag });
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [, key, a, b, c] of (attributes ?? "").matchAll(ATTR))
      attrs[key.toLowerCase()] = decode(a ?? b ?? c ?? "");
    items.push({ open: tag, attrs, closed: !!self || VOID.has(tag) });
  }
  text(source.length);
  return items;
}
const SIZE = /^\d+(\.\d+)?(px|%)?$/;
const span = (value: string | undefined) => {
  const n = value ? parseInt(value, 10) : NaN;
  return n > 1 && n <= 1000 ? n : undefined;
};
/** The element an allowed tag becomes, with only the attributes it may keep. */
function element(open: Open): MarkdownNode | null {
  const tag = htmlTags[open.open as keyof typeof htmlTags];
  if (!tag) return null;
  const { attrs } = open;
  const node: MarkdownNode = { tag, children: [] };
  const align = (
    open.open === "center" ? "center" : (attrs.align ?? "")
  ).toLowerCase();
  if (
    align === "left" ||
    align === "right" ||
    align === "center" ||
    align === "justify"
  )
    node.align = align;
  if (attrs.title) node.title = attrs.title;
  if (tag === "link" && attrs.href) node.href = attrs.href;
  if (tag === "image") {
    if (attrs.src) node.src = attrs.src;
    if (attrs.alt) node.alt = attrs.alt;
  }
  if (tag === "image" || tag === "td" || tag === "th" || tag === "table") {
    if (attrs.width && SIZE.test(attrs.width)) node.width = attrs.width;
    if (attrs.height && SIZE.test(attrs.height)) node.height = attrs.height;
  }
  if (tag === "td" || tag === "th") {
    const cols = span(attrs.colspan),
      rows = span(attrs.rowspan);
    if (cols) node.colSpan = cols;
    if (rows) node.rowSpan = rows;
  }
  if (tag === "details" && "open" in attrs) node.open = true;
  if (tag === "ol") {
    const start = parseInt(attrs.start ?? "", 10);
    if (Number.isFinite(start) && start !== 1) node.start = start;
  }
  return node;
}
/**
 * Nests the open and close tags among `items` into elements. A close without its open is
 * ignored; an open without its close ends with the list. Whitespace between tags is dropped
 * inside tables and lists, and between blocks with `block`.
 */
function nest(items: Item[], block: boolean): (MarkdownNode | string)[] {
  type Frame = {
    name: string | null;
    node: MarkdownNode | null;
    drop: boolean;
    children: (MarkdownNode | string)[];
  };
  const root: Frame = { name: null, node: null, drop: false, children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  // Between blocks, whitespace with a line break is the source's indentation.
  const layout = (frame: Frame, text: string) =>
    (block && (frame === root || text.includes("\n"))) ||
    STRUCTURE.has(frame.node?.tag ?? "");
  const end = () => {
    const frame = stack.pop()!;
    if (frame.drop) return;
    const into = top().children;
    if (frame.node) {
      const rows = (n: MarkdownNode | string) =>
        typeof n !== "string" && n.tag === "tr";
      // Rows belong in a body, as the browser's own parser puts them.
      frame.node.children =
        frame.node.tag === "table" && frame.children.some(rows)
          ? [
              ...frame.children.filter((n) => !rows(n)),
              { tag: "tbody", children: frame.children.filter(rows) },
            ]
          : frame.children;
      into.push(frame.node);
    } else into.push(...frame.children);
  };
  for (const item of items) {
    const frame = top();
    if (isOpen(item)) {
      const drop = frame.drop || DROPPED.has(item.open);
      if (item.closed) {
        const node = drop ? null : element(item);
        if (node) frame.children.push(node);
      } else
        stack.push({
          name: item.open,
          node: drop ? null : element(item),
          drop,
          children: [],
        });
    } else if (isClose(item)) {
      let at = stack.length - 1;
      while (at > 0 && stack[at].name !== item.close) at--;
      if (at > 0) while (stack.length > at) end();
    } else if (!frame.drop) {
      if (typeof item === "string" && !item.trim() && layout(frame, item))
        continue;
      frame.children.push(item);
    }
  }
  while (stack.length > 1) end();
  return root.children;
}
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

const HTML_NODES = new Set(["HTMLTag", "HTMLBlock"]);
const COMMENTS = new Set([
  "Comment",
  "CommentBlock",
  "ProcessingInstruction",
  "ProcessingInstructionBlock",
]);
const plain = (nodes: (MarkdownNode | string)[]): string =>
  nodes.map((n) => (typeof n === "string" ? n : plain(n.children))).join("");

export function parseMarkdown(
  source: string,
  options: MarkdownOptions = {},
): MarkdownNode[] {
  const html = !!options.html;
  const slice = (from: number, to: number) => source.slice(from, to);
  /** HTML as tags to nest (true), a comment to skip (null), or other syntax (false). */
  function raw(node: SyntaxNode, into: Item[]) {
    if (!html) return false;
    if (HTML_NODES.has(node.name)) {
      into.push(...htmlItems(slice(node.from, node.to)));
      return true;
    }
    return COMMENTS.has(node.name) ? null : false;
  }
  function inline(node: SyntaxNode, from: number, to: number) {
    const out: Item[] = [];
    let tags = false;
    let at = from;
    const text = (end: number) => {
      if (end > at) out.push(slice(at, end));
    };
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.from >= to) break;
      text(child.from);
      at = child.to;
      const taken = raw(child, out);
      if (taken) tags = true;
      if (taken !== false) continue;
      const converted = convert(child);
      if (converted !== null) out.push(converted);
    }
    text(to);
    return tags ? nest(out, false) : (out as (MarkdownNode | string)[]);
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
      const address = url ? slice(url.from, url.to) : undefined;
      const children = label(node);
      // The tooltip is the address, so a link shows where it leads.
      const result: MarkdownNode = {
        tag: name === "Link" ? "link" : "image",
        children,
        title: address,
      };
      if (address !== undefined) {
        if (name === "Link") result.href = address;
        else result.src = address;
      }
      if (name === "Image") result.alt = plain(children);
      return result;
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
      const children: Item[] = [];
      let tags = false;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        const taken = raw(child, children);
        if (taken) tags = true;
        if (taken !== false) continue;
        const converted = convert(child);
        if (converted !== null)
          children.push(
            typeof converted === "string"
              ? { tag: "p", children: [converted] }
              : converted,
          );
      }
      const result: MarkdownNode = {
        tag: tag ?? "div",
        children: tags ? nest(children, true) : (children as MarkdownNode[]),
      };
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
