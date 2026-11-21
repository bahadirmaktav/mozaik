import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree, foldable } from "@codemirror/language";
import { cpp } from "@codemirror/lang-cpp";
import { codeFolding } from "./folding";

function state(text: string) {
  const s = EditorState.create({ doc: text, extensions: [cpp(), codeFolding] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}
function fold(s: EditorState, line: number) {
  const { from, to } = s.doc.line(line);
  const range = foldable(s, from, to);
  return range && s.doc.sliceString(range.from, range.to);
}

describe("code folding", () => {
  const text = [
    "void f(int x) {",
    "  if (x) {",
    "    a();",
    "    b();",
    "  } else if (x > 1) {",
    "    c();",
    "  } else {",
    "    d();",
    "  }",
    "}",
  ].join("\n");

  it("keeps the line of the closing bracket, so an else stays on its own line", () => {
    const s = state(text);
    expect(fold(s, 2)).toBe("\n    a();\n    b();");
    expect(fold(s, 5)).toBe("\n    c();");
    expect(fold(s, 7)).toBe("\n    d();\n  ");
  });

  it("folds a closing bracket alone on its line into the folded line", () => {
    const s = state(text);
    expect(fold(s, 1)).toBe(
      text.split("\n").slice(1, 9).join("\n").replace(/^/, "\n") + "\n",
    );
    const t = state("struct S {\n  int a;\n}; // S\n");
    expect(fold(t, 1)).toBe("\n  int a;\n");
  });

  it("folds a block with nothing between its brackets' lines as before", () => {
    const s = state("void h() {\n}\n");
    expect(fold(s, 1)).toBe("\n");
  });

  it("keeps a range that ends after code on the closing line", () => {
    const s = state("int g() {\n  return 1;\n  return 2; }\n");
    expect(fold(s, 1)).toBe("\n  return 1;\n  return 2; ");
  });
});
