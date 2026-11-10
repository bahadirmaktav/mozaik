import { describe, expect, it } from "vitest";
import { countText, preserveCase } from "./find";

describe("find widget", () => {
  it("keeps the match's case in a replacement, as VS Code's Preserve Case", () => {
    expect(preserveCase("FOO", "bar")).toBe("BAR");
    expect(preserveCase("foo", "Bar")).toBe("bar");
    expect(preserveCase("Foo", "bar")).toBe("Bar");
    expect(preserveCase("fOo", "bar")).toBe("bar");
    expect(preserveCase("123", "Bar")).toBe("Bar");
  });

  it("counts the matches and the one the selection is on", () => {
    const ranges = [
      { from: 0, to: 3 },
      { from: 10, to: 13 },
    ];
    expect(countText(ranges, { from: 10, to: 13 })).toBe("2 of 2");
    expect(countText(ranges, { from: 5, to: 5 })).toBe("? of 2");
    expect(countText([], { from: 0, to: 0 })).toBe("No results");
    expect(countText(null, { from: 0, to: 0 })).toBe("9999+");
  });
});
