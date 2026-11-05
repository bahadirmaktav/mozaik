import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parseMarkdown";

describe("Markdown", () => {
  it("reads tables into rows of header and body cells", () => {
    const [table] = parseMarkdown("| A | *B* |\n|---|---|\n| 1 | 2 |\n");
    expect(table).toEqual({
      tag: "table",
      children: [
        {
          tag: "tbody",
          children: [
            {
              tag: "tr",
              children: [
                { tag: "th", children: ["A"] },
                {
                  tag: "th",
                  children: [{ tag: "em", children: ["B"] }],
                },
              ],
            },
            {
              tag: "tr",
              children: [
                { tag: "td", children: ["1"] },
                { tag: "td", children: ["2"] },
              ],
            },
          ],
        },
      ],
    });
  });
});
