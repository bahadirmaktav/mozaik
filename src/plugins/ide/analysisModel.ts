import { applyEdits, type TextEdit } from "./model";
import type { FixEdit } from "../../services/analysis";

/*
 * Pure parts of the Problems list and of clang-tidy fixes: where a problem comes from,
 * conservative grouping, filters, combining fixes and their preview.
 */

/** Where a problem comes from. clangd reports its own and the live clang-tidy checks. */
export type Provider = "clangd" | "clang-tidy" | "clang-tidy-cli" | "build";
export const PROVIDERS: Provider[] = [
  "clangd",
  "clang-tidy",
  "clang-tidy-cli",
  "build",
];
export const PROVIDER_LABEL: Record<Provider, string> = {
  clangd: "clangd",
  "clang-tidy": "clang-tidy (live)",
  "clang-tidy-cli": "clang-tidy (run)",
  build: "build",
};
export interface ProblemItem {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
  code?: string | number;
  /** clang-tidy's replacements for this finding (runs only). */
  fix?: FixEdit[];
  /** The text or build context changed since the run that found it. */
  stale?: boolean;
}
export function providerOf(item: { source?: string }): Provider {
  return item.source === "build" ||
    item.source === "clang-tidy" ||
    item.source === "clang-tidy-cli"
    ? item.source
    : "clangd";
}
export interface Problem extends ProblemItem {
  providers: Provider[];
}
/**
 * One entry per problem: only items at the same place with the same rule and message are
 * one problem, which then lists every provider that reported it. A grouped problem is
 * stale only when every report of it is.
 */
export function groupProblems(items: ProblemItem[]): Problem[] {
  const groups = new Map<string, Problem>();
  for (const item of items) {
    const key = [
      item.range.start.line,
      item.range.start.character,
      item.code ?? "",
      item.message,
    ].join("\u0000");
    const known = groups.get(key);
    const provider = providerOf(item);
    if (!known) {
      groups.set(key, { ...item, providers: [provider] });
      continue;
    }
    if (!known.providers.includes(provider)) known.providers.push(provider);
    known.severity = Math.min(
      known.severity,
      item.severity,
    ) as Problem["severity"];
    known.stale = !!known.stale && !!item.stale;
    if (!known.fix?.length && item.fix?.length) known.fix = item.fix;
  }
  return [...groups.values()];
}

export interface ProblemFilter {
  /** Words that must all occur in the message, rule or file. */
  text: string;
  provider: Provider | "all";
  /** The least severe level shown: 1 errors only, 2 also warnings, 4 everything. */
  severity: 1 | 2 | 4;
}
export const noFilter: ProblemFilter = {
  text: "",
  provider: "all",
  severity: 4,
};
export function matchesFilter(
  problem: Problem,
  file: string,
  filter: ProblemFilter,
) {
  if (problem.severity > filter.severity) return false;
  if (filter.provider !== "all" && !problem.providers.includes(filter.provider))
    return false;
  const haystack =
    `${problem.message} ${problem.code ?? ""} ${file}`.toLowerCase();
  return filter.text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

const before = (a: FixEdit["start"], b: FixEdit["start"]) =>
  a.line < b.line || (a.line === b.line && a.character < b.character);
const same = (a: FixEdit["start"], b: FixEdit["start"]) =>
  a.line === b.line && a.character === b.character;
/** Two edits of a file touch: overlapping ranges, or two insertions at one place. */
function touching(a: FixEdit, b: FixEdit) {
  if (same(a.start, b.start)) return true;
  return before(a.start, b.end) && before(b.start, a.end);
}
/**
 * The edits of several fixes, by file. A fix that would touch an edit of an earlier one
 * is left out whole: clang-tidy's fixes do not know about each other.
 */
export function combineFixes(fixes: FixEdit[][]) {
  const files = new Map<string, FixEdit[]>();
  let skipped = 0;
  for (const fix of fixes) {
    const clash = fix.some((edit) =>
      (files.get(edit.path) ?? []).some((other) => touching(edit, other)),
    );
    // A fix that clashes with itself is no safer.
    const own = fix.some((edit, i) =>
      fix.some(
        (other, j) =>
          i < j && edit.path === other.path && touching(edit, other),
      ),
    );
    if (clash || own) {
      skipped++;
      continue;
    }
    for (const edit of fix)
      files.set(edit.path, [...(files.get(edit.path) ?? []), edit]);
  }
  return { files, skipped };
}
export const textEdits = (edits: FixEdit[]): TextEdit[] =>
  edits.map((e) => ({
    range: { start: e.start, end: e.end },
    newText: e.newText,
  }));

export interface Hunk {
  /** The first changed line, zero-based. */
  line: number;
  removed: string[];
  added: string[];
}
/** The changed lines of `text` under `edits`, as a diff preview shows them. */
export function previewHunks(text: string, edits: FixEdit[]): Hunk[] {
  const lines = text.split("\n");
  const sorted = [...edits].sort((a, b) =>
    before(a.start, b.start) ? -1 : before(b.start, a.start) ? 1 : 0,
  );
  const groups: { first: number; last: number; edits: FixEdit[] }[] = [];
  for (const edit of sorted) {
    const group = groups[groups.length - 1];
    if (group && edit.start.line <= group.last) {
      group.last = Math.max(group.last, edit.end.line);
      group.edits.push(edit);
    } else
      groups.push({
        first: edit.start.line,
        last: edit.end.line,
        edits: [edit],
      });
  }
  return groups.map(({ first, last, edits }) => {
    const removed = lines.slice(first, last + 1);
    const shifted = edits.map((e) => ({
      ...e,
      start: { ...e.start, line: e.start.line - first },
      end: { ...e.end, line: e.end.line - first },
    }));
    const added = applyEdits(removed.join("\n"), textEdits(shifted)).split(
      "\n",
    );
    return { line: first, removed, added };
  });
}
