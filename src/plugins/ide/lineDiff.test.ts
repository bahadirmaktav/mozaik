import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { Chunk, type DiffConfig } from "@codemirror/merge";
import { lineDiff } from "./lineDiff";

const doc = (text: string) => Text.of(text.split("\n"));
/** The first and last changed line of each chunk in `b` (from 1; null for a deletion). */
const chunks = (
  a: string,
  b: string,
  config: DiffConfig = { override: lineDiff },
) =>
  Chunk.build(doc(a), doc(b), config).map((chunk) => [
    doc(b).lineAt(chunk.fromB).number,
    chunk.toB > chunk.fromB ? doc(b).lineAt(chunk.endB).number : null,
  ]);
/** Applying the changes to `a` gives `b`. */
function apply(a: string, b: string) {
  let out = "",
    at = 0;
  for (const change of lineDiff(a, b)) {
    out += a.slice(at, change.fromA) + b.slice(change.fromB, change.toB);
    at = change.toA;
  }
  return out + a.slice(at);
}

describe("comparison by lines", () => {
  const lines = Array.from(
    { length: 3000 },
    (_, i) => `  const value${i} = compute(${i}, "${(i * 7919) % 104729}");`,
  );
  const base = lines.join("\n") + "\n";
  // Ten lines with a comment added, one line added and one removed: a few edits spread
  // through a large file.
  const commented = [10, 300, 600, 900, 1200, 1800, 2100, 2400, 2700, 2800];
  const edited = lines
    .flatMap((line, i) =>
      i === 2900
        ? []
        : commented.includes(i)
          ? [`${line} // checked against the measured value, see the notes`]
          : i === 1500
            ? [line, "  log(value1500);"]
            : [line],
    )
    .join("\n")
    .concat("\n");

  it("marks only the changed lines of a large file, as git diff does", () => {
    const at = (i: number) => (i > 1500 ? i + 2 : i + 1);
    expect(chunks(base, edited)).toEqual([
      ...commented.slice(0, 5).map((i) => [at(i), at(i)]),
      [1502, 1502],
      ...commented.slice(5).map((i) => [at(i), at(i)]),
      [2902, null],
    ]);
    // The merge view's own character diff, at its default scan limit, gives up on this
    // file and marks nearly all of it as one change.
    const crude = chunks(base, edited, { scanLimit: 500 });
    expect(crude).toHaveLength(1);
    expect(crude[0][1]! - crude[0][0]!).toBeGreaterThan(2000);
  });

  it("gives changes that turn one text into the other", () => {
    for (const [a, b] of [
      [base, edited],
      ["x", "x\ny"],
      ["x\ny", "x"],
      ["x\ny", "x\nz"],
      ["", "a\nb"],
      ["a\nb", ""],
      ["a\nb\nc", "z\nb\nc\nd"],
      ["one\ntwo\n", "one\nTWO\nthree\n"],
    ])
      expect(apply(a, b)).toBe(b);
  });

  it("highlights the changed characters inside a changed line", () => {
    expect(lineDiff("keep\nold value\nkeep", "keep\nnew value\nkeep")).toEqual([
      expect.objectContaining({ fromA: 5, toA: 8, fromB: 5, toB: 8 }),
    ]);
  });
});
