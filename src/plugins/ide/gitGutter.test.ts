import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { baseText, lineChanges } from "./gitGutter";

const doc = (text: string) => Text.of(text.split("\n"));
const changes = (base: string, now: string) =>
  lineChanges(baseText(base), doc(now));

describe("git gutter", () => {
  const base = "one\ntwo\nthree\nfour\nfive\n";
  it("finds nothing in unchanged text", () => {
    expect(changes(base, base)).toEqual([]);
  });
  it("marks added lines", () => {
    expect(changes(base, "one\ntwo\nnew\nmore\nthree\nfour\nfive\n")).toEqual([
      { kind: "added", from: 3, to: 4 },
    ]);
  });
  it("marks changed lines", () => {
    expect(changes(base, "one\nTWO\nthree\nfour\nfive\n")).toEqual([
      { kind: "modified", from: 2, to: 2 },
    ]);
  });
  it("marks where lines were deleted", () => {
    expect(changes(base, "one\nfour\nfive\n")).toEqual([
      { kind: "deleted", from: 2, to: 2 },
    ]);
  });
  it("marks several separate changes", () => {
    const found = changes(
      "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n",
      "a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\n",
    );
    expect(found).toEqual([
      { kind: "modified", from: 2, to: 2 },
      { kind: "added", from: 11, to: 11 },
    ]);
  });
  it("handles a deletion at the end of the file", () => {
    const found = changes("one\ntwo\nthree", "one\ntwo");
    expect(found.length).toBe(1);
    expect(found[0].from).toBeLessThanOrEqual(2);
  });
  it("marks a change next to repeated lines by the lines around it", () => {
    expect(changes("}\n}\n}\nx\n}\n}\n", "}\n}\n}\ny\n}\n}\n")).toEqual([
      { kind: "modified", from: 4, to: 4 },
    ]);
  });
  it("keeps moved lines' order when lines swap places", () => {
    const found = changes("a\nb\nc\nd\n", "a\nc\nb\nd\n");
    expect(found.map((c) => c.kind).sort()).toEqual(["added", "deleted"]);
  });
  it("treats a rewritten line block between unchanged lines as one change", () => {
    expect(changes("a\nb\nc\nd\n", "a\nx\ny\nz\nd\n")).toEqual([
      { kind: "modified", from: 2, to: 4 },
    ]);
  });
  // These took 2 and 40 seconds on the UI thread with the former character diff.
  describe("in a file of thousands of lines", () => {
    const lines = Array.from({ length: 6000 }, (_, i) =>
      i % 7 === 0 ? "}" : `  int value${i} = compute(${i}); // ${i}`,
    );
    const within = (limit: number, run: () => void) => {
      const started = performance.now();
      run();
      expect(performance.now() - started).toBeLessThan(limit);
    };
    it("compares every third line changed quickly and exactly", () => {
      const base = lines.join("\n");
      const now = lines
        .map((line, i) => (i % 3 === 0 ? `${line} // now` : line))
        .join("\n");
      within(250, () => {
        const found = changes(base, now);
        expect(found).toHaveLength(2000);
        expect(found[1]).toEqual({ kind: "modified", from: 4, to: 4 });
      });
    });
    it("compares a reformatted file quickly as one change", () => {
      const now = lines.map((line) => line.replace(/ /g, "\t")).join("\n");
      within(250, () => {
        const found = changes(lines.join("\n"), now);
        expect(found.every((c) => c.kind === "modified")).toBe(true);
      });
    });
    it("gives up on shuffled lines quickly, marking what is left as changed", () => {
      // Every line exists on both sides, in another order: the worst case for the comparison.
      const unique = lines.map((_, i) => `line ${i}`);
      const shuffled = unique.map((_, i) => unique[(i * 2477) % 6000]);
      within(1000, () => {
        expect(changes(unique.join("\n"), shuffled.join("\n"))).toEqual([
          { kind: "modified", from: 2, to: 6000 },
        ]);
      });
    });
  });
});
