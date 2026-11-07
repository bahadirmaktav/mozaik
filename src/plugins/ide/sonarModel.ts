import { Text } from "@codemirror/state";
import { matchLines } from "./gitGutter";
import type { LspPosition } from "./model";
import type { SonarIssue, SonarTarget } from "../../services/sonar";

/*
 * Pure parts of the SonarQube view (`docs/decisions/028-sonarqube.md`): where an issue of
 * an analyzed commit is in the text the user has now, and what changed between two
 * refreshes of the same analysis target.
 */

/**
 * `open`: the issue's lines are as the analysis read them (perhaps moved). `changed`: the
 * user edited them since; only the next analysis can tell whether the issue is gone.
 * `unmatched`: the analyzed commit or the file is not here.
 */
export type Track = "open" | "changed" | "unmatched";
export interface Placed {
  issue: SonarIssue;
  track: Track;
  /** Where it is now, in protocol positions (lines from 0, UTF-16 columns). */
  range: { start: LspPosition; end: LspPosition };
}
/** How a file compares with the analyzed commit. */
export type FileState =
  | { kind: "same" }
  | { kind: "unmatched" }
  | { kind: "texts"; base: string; current: string };

function at(issue: SonarIssue, lineShift = 0) {
  const range = issue.range;
  if (!range) {
    return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  }
  return {
    start: {
      line: range.startLine - 1 + lineShift,
      character: range.startOffset,
    },
    end: { line: range.endLine - 1 + lineShift, character: range.endOffset },
  };
}
const lines = (text: string) => Text.of(text.split("\n"));

/** The issues of one file, placed in its current text. */
export function placeFile(issues: SonarIssue[], state: FileState): Placed[] {
  if (state.kind === "same")
    return issues.map((issue) => ({ issue, track: "open", range: at(issue) }));
  if (state.kind === "unmatched")
    return issues.map((issue) => ({
      issue,
      track: "unmatched",
      range: at(issue),
    }));
  if (state.base === state.current)
    return issues.map((issue) => ({ issue, track: "open", range: at(issue) }));
  const map = matchLines(lines(state.base), lines(state.current));
  return issues.map((issue): Placed => {
    const range = issue.range;
    // An issue on the whole file follows the file.
    if (!range) return { issue, track: "open", range: at(issue) };
    const first = range.startLine - 1,
      last = range.endLine - 1;
    const from = first < map.length ? map[first] : -1;
    const to = last < map.length ? map[last] : -1;
    // Every line of the issue must still be there, in one piece.
    let kept = from >= 0 && to - from === last - first;
    for (let line = first + 1; kept && line < last; line++)
      kept = map[line] === from + (line - first);
    return kept
      ? { issue, track: "open", range: at(issue, from - first) }
      : { issue, track: "changed", range: at(issue) };
  });
}

/** Identifies an analysis target, so that refreshes of the same one can be compared. */
export function targetId(target: SonarTarget) {
  return target.kind === "pullRequest"
    ? `pr:${target.key}`
    : target.kind === "branch"
      ? `branch:${target.name}`
      : "main";
}
/** As the code host names it: GitLab's merge requests, others' pull requests. */
export function targetLabel(target: SonarTarget) {
  if (target.kind === "pullRequest") {
    const gitlab = target.url?.includes("/merge_requests/");
    return `${gitlab ? `Merge request !${target.key}` : `Pull request #${target.key}`} · ${target.branch}`;
  }
  if (target.kind === "branch") return `Branch ${target.name}`;
  return target.name ? `Main branch (${target.name})` : "Main branch";
}

/**
 * What the newer refresh says about the older one's issues: fixed (gone) and new keys.
 * Different targets are not compared.
 */
export function compareRefreshes(
  previous: { target: string; keys: ReadonlySet<string> } | null,
  target: string,
  keys: ReadonlySet<string>,
) {
  if (!previous || previous.target !== target) return null;
  let fixed = 0;
  for (const key of previous.keys) if (!keys.has(key)) fixed++;
  const added = new Set<string>();
  for (const key of keys) if (!previous.keys.has(key)) added.add(key);
  return { fixed, added };
}

/** Placed issues by track, then by file, files and issues in a stable order. */
export function groupPlaced(placed: Placed[], severity: 0 | 1 | 2 | 3) {
  const tracks: Record<Track, Map<string, Placed[]>> = {
    open: new Map(),
    changed: new Map(),
    unmatched: new Map(),
  };
  for (const item of placed) {
    if (severity && item.issue.severity > severity) continue;
    const file = item.issue.path ?? item.issue.relative;
    const group = tracks[item.track];
    group.set(file, [...(group.get(file) ?? []), item]);
  }
  for (const group of Object.values(tracks))
    for (const items of group.values())
      items.sort(
        (a, b) =>
          a.range.start.line - b.range.start.line ||
          a.issue.severity - b.issue.severity,
      );
  const sorted = (group: Map<string, Placed[]>) =>
    [...group].sort(([a], [b]) => a.localeCompare(b));
  return {
    open: sorted(tracks.open),
    changed: sorted(tracks.changed),
    unmatched: sorted(tracks.unmatched),
  };
}
