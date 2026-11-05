import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { decorate } from "./semanticTokens";

const legend = ["class", "function", "keyword", "parameter"];
const marks = (doc: Text, data: number[]) => {
  const found: [string, string][] = [];
  decorate(doc, data, legend).between(0, doc.length, (from, to, value) => {
    found.push([doc.sliceString(from, to), value.spec.class]);
  });
  return found;
};

describe("semantic tokens", () => {
  const doc = Text.of(["class Foo {", "  int bar(int n);", "};"]);
  it("reads relative positions into marks of each name's kind", () => {
    expect(
      marks(
        doc,
        [
          // Foo: line 0, column 6, length 3, type 0.
          0, 6, 3, 0, 0,
          // bar: next line, column 6; n: same line, 8 further on.
          1, 6, 3, 1, 0, 0, 8, 1, 3, 0,
        ],
      ),
    ).toEqual([
      ["Foo", "cm-sem-type"],
      ["bar", "cm-sem-function"],
      ["n", "cm-sem-parameter"],
    ]);
  });
  it("leaves kinds without a color to the grammar", () => {
    expect(marks(doc, [0, 0, 5, 2, 0])).toEqual([]);
  });
  it("ignores tokens past the text, as after an edit the server has not seen", () => {
    expect(marks(doc, [9, 0, 1, 0, 0])).toEqual([]);
    expect(marks(doc, [0, 8, 40, 0, 0])).toEqual([]);
  });
});
