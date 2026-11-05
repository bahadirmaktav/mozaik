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
});
