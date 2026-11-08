import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { inactiveLines } from "./inactiveRegions";
import { decorate } from "./semanticTokens";

const doc = Text.of([
  "#ifdef WINDOWS",
  "int a = 1;",
  "int b = 2;",
  "#else",
  "int c = 3;",
  "#endif",
]);
const dimmed = (set: ReturnType<typeof inactiveLines>) => {
  const lines: number[] = [];
  set.between(0, doc.length, (from, _to, value) => {
    if (value.spec.class === "cm-inactive-code")
      lines.push(doc.lineAt(from).number);
  });
  return lines;
};
const range = (a: number, b: number, c: number, d: number) => ({
  start: { line: a, character: b },
  end: { line: c, character: d },
});

describe("inactive regions", () => {
  it("dims each line of the regions clangd names, not the directives around them", () => {
    expect(dimmed(inactiveLines(doc, [range(1, 0, 2, 10)]))).toEqual([2, 3]);
  });
  it("leaves out a line a region only reaches the start of, and lines past the text", () => {
    expect(dimmed(inactiveLines(doc, [range(4, 0, 5, 0)]))).toEqual([5]);
    expect(dimmed(inactiveLines(doc, [range(5, 0, 9, 3)]))).toEqual([6]);
  });
  it("dims the comment tokens of clangd before 17 as their lines", () => {
    const legend = ["comment", "variable"];
    // Lines 1 and 2 are inactive (comment), `c` on line 4 is a variable.
    const set = decorate(
      doc,
      [1, 0, 10, 0, 0, 1, 0, 10, 0, 0, 2, 4, 1, 1, 0],
      legend,
    );
    expect(dimmed(set)).toEqual([2, 3]);
    const marks: string[] = [];
    set.between(0, doc.length, (from, to, value) => {
      if (value.spec.class !== "cm-inactive-code")
        marks.push(doc.sliceString(from, to));
    });
    expect(marks).toEqual(["c"]);
  });
});
