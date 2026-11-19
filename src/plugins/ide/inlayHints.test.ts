import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import { hintDecorations, labelOf } from "./inlayHints";

describe("inlay hints", () => {
  const doc = Text.of(["let x = add(1, 2);", "}"]);
  const at = (line: number, character: number) => ({ line, character });
  it("places a widget after the position and reads labels made of parts", () => {
    const set = hintDecorations(doc, [
      { position: at(0, 5), label: ": i32", kind: 1 },
      {
        position: at(0, 12),
        label: [{ value: "a" }, { value: ":" }],
        kind: 2,
        paddingRight: true,
      },
    ]);
    const found: [number, string][] = [];
    set.between(0, doc.length, (from, _to, value) => {
      found.push([from, (value.spec.widget as { text: string }).text]);
    });
    expect(found).toEqual([
      [5, ": i32"],
      [12, "a:"],
    ]);
  });
  it("leaves out hints past the text, as after an edit the server has not seen", () => {
    const set = hintDecorations(doc, [
      { position: at(5, 0), label: "x" },
      { position: at(1, 9), label: "x" },
      { position: at(0, 1), label: "  " },
    ]);
    expect(set.size).toBe(0);
    expect(labelOf({ position: at(0, 0), label: [{ value: "T" }] })).toBe("T");
  });
});
