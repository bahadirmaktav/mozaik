/*
 * TODO tags in comments, after VS Code's Todo Tree: a tag counts after a comment marker
 * (`//`, `#`, `/*`, `;`, `<!--`, `--`), at the start of a block comment line (`*`) or at the
 * start of a line, followed by a space, `:`, `(`, `[` or the line's end.
 */

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PREFIX = String.raw`(?://|#|<!--|--|;|/\*|^\s*\*|^)\s*`;
const AFTER = String.raw`(?:[\s:(\[]|$)`;
/** Longest first, so `TODO` never takes the start of `TODOS`. */
const alternatives = (tags: string[]) =>
  [...new Set(tags)]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|");

/** The project search pattern (Rust regex syntax, one line at a time); null without tags. */
export function todoSearchPattern(tags: string[]) {
  return tags.length ? `${PREFIX}(?:${alternatives(tags)})${AFTER}` : null;
}
/** The editor's pattern: the tag is group 1 and ends the match. */
export function todoEditorPattern(tags: string[]) {
  return tags.length
    ? new RegExp(`${PREFIX}(${alternatives(tags)})(?=[\\s:(\\[]|$)`, "g")
    : null;
}

export interface TodoItem {
  tag: string;
  /** The comment after the tag. */
  text: string;
  line: number;
  /** The tag's column (UTF-16 code units). */
  column: number;
}
/**
 * The tag and its comment in a search match: `preview` is the line (maybe shortened at its
 * start) and the match is `offset`..`offset + length` within it, at `column` of `line`.
 */
export function parseTodo(
  match: {
    line: number;
    column: number;
    length: number;
    preview: string;
    offset: number;
  },
  tags: string[],
): TodoItem | null {
  const found = match.preview.slice(match.offset, match.offset + match.length);
  let best: { tag: string; at: number } | null = null;
  for (const tag of [...tags].sort((a, b) => b.length - a.length)) {
    const at = found.indexOf(tag);
    if (at >= 0 && (!best || at < best.at)) best = { tag, at };
  }
  if (!best) return null;
  const text = match.preview
    .slice(match.offset + best.at + best.tag.length)
    .replace(/^[\s:]+/, "")
    .replace(/\s*(\*\/|-->)\s*$/, "")
    .trim();
  return {
    tag: best.tag,
    text,
    line: match.line,
    column: match.column + best.at,
  };
}

const COLORS: Record<string, string> = {
  TODO: "#e5c07b",
  FIXME: "#e06c75",
  BUG: "#e06c75",
  HACK: "#d19a66",
  XXX: "#c678dd",
  NOTE: "#61afef",
  INFO: "#56b6c2",
};
const PALETTE = ["#98c379", "#61afef", "#c678dd", "#56b6c2", "#d19a66"];
/** A tag's color: fixed for the default tags, a stable pick for the user's own. */
export function tagColor(tag: string) {
  const known = COLORS[tag.toUpperCase()];
  if (known) return known;
  let hash = 0;
  for (const char of tag) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
