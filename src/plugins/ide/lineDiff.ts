import { Change, diff } from "@codemirror/merge";
import { alignment } from "./gitGutter";

/** The offset where each line starts, from 0, and where a line after the last would. */
function lineStarts(lines: string[]) {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  starts.push(at);
  return starts;
}

/**
 * A comparison's changes as Git finds them: whole lines first, so only the lines that differ
 * are changes, then characters inside each changed block for the inline highlights.
 *
 * `@codemirror/merge` diffs characters with a scan limit; past it, on a file of some size, it
 * gave up and marked everything between two changes as changed, and a file with a few edits
 * looked rewritten. Lines are compared by identity (`alignment`, the Git gutter's), which is
 * cheap at any size, and a character diff never sees more than one changed block.
 */
export function lineDiff(a: string, b: string): readonly Change[] {
  const linesA = a.split("\n"),
    linesB = b.split("\n");
  const startsA = lineStarts(linesA),
    startsB = lineStarts(linesB);
  const changes: Change[] = [];
  let i = 0,
    j = 0;
  const block = (toA: number, toB: number) => {
    if (i === toA && j === toB) return;
    let fromA = startsA[i],
      fromB = startsB[j];
    const endA = Math.min(startsA[toA], a.length),
      endB = Math.min(startsB[toB], b.length);
    // At the end of the files the last line has no line break of its own: the block takes
    // the one before it, so both sides start at the end of the same shared line.
    if (toA === linesA.length && toB === linesB.length && i > 0 && j > 0) {
      fromA = startsA[i] - 1;
      fromB = startsB[j] - 1;
    }
    for (const change of diff(a.slice(fromA, endA), b.slice(fromB, endB), {
      scanLimit: 500,
    }))
      changes.push(
        new Change(
          change.fromA + fromA,
          change.toA + fromA,
          change.fromB + fromB,
          change.toB + fromB,
        ),
      );
  };
  for (const [toA, toB] of alignment(linesA, linesB)) {
    block(toA, toB);
    i = toA + 1;
    j = toB + 1;
  }
  block(linesA.length, linesB.length);
  return changes;
}
