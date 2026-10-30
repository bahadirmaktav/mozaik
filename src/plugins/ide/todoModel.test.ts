import { describe, expect, it } from "vitest";
import {
  parseTodo,
  tagColor,
  todoEditorPattern,
  todoSearchPattern,
} from "./todoModel";

const TAGS = ["TODO", "FIXME", "INFO"];
/** What the project search reports for the first match of the pattern in a line. */
function search(line: string, tags = TAGS) {
  const pattern = new RegExp(todoSearchPattern(tags)!);
  const m = pattern.exec(line);
  return m
    ? {
        line: 3,
        column: m.index,
        length: m[0].length,
        preview: line,
        offset: m.index,
      }
    : null;
}

describe("TODO tags", () => {
  it("finds tags after comment markers and at line starts only", () => {
    expect(search("  // TODO: free the buffer")).not.toBeNull();
    expect(search("# FIXME later")).not.toBeNull();
    expect(search("/* INFO(bob) see docs */")).not.toBeNull();
    expect(search(" * TODO in a block comment")).not.toBeNull();
    expect(search("TODO")).not.toBeNull();
    expect(search("int todo = TODO_COUNT; // nothing")).toBeNull();
    expect(search("// TODOS are not TODO")).toBeNull();
    expect(search('printf("TODO");')).toBeNull();
  });
  it("reads the tag, its comment and the tag's column", () => {
    expect(parseTodo(search("  // TODO: free the buffer")!, TAGS)).toEqual({
      tag: "TODO",
      text: "free the buffer",
      line: 3,
      column: 5,
    });
    expect(parseTodo(search("x(); /* FIXME  leaks */")!, TAGS)).toMatchObject({
      tag: "FIXME",
      text: "leaks",
    });
    expect(parseTodo(search("<!-- INFO -->")!, TAGS)?.text).toBe("");
  });
  it("prefers the longest tag and escapes the user's own", () => {
    const tags = ["TODO", "TODO!", "C++"];
    expect(parseTodo(search("// TODO! now", tags)!, tags)?.tag).toBe("TODO!");
    expect(search("// C++ quirk", tags)).not.toBeNull();
    expect(search("// C quirk", tags)).toBeNull();
    expect(todoSearchPattern([])).toBeNull();
  });
  it("marks only the tag in the editor", () => {
    const pattern = todoEditorPattern(TAGS)!;
    const m = pattern.exec("  // TODO: x")!;
    expect(m[1]).toBe("TODO");
    expect(m.index + m[0].length).toBe(9);
  });
  it("gives every tag a stable color", () => {
    expect(tagColor("todo")).toBe(tagColor("TODO"));
    expect(tagColor("REVIEW")).toBe(tagColor("REVIEW"));
  });
});
