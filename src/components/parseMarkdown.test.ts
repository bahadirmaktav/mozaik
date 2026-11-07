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

describe("Markdown with HTML", () => {
  it("keeps raw HTML as text unless asked for", () => {
    const [p] = parseMarkdown("a <b>bold</b> b");
    expect(p).toEqual({
      tag: "p",
      children: ["a ", "<b>", "bold", "</b>", " b"],
    });
  });

  it("reads a README's centered pictures, links and captions", () => {
    const nodes = parseMarkdown(
      '<p align="center">\n  <a href="shot.webp"><img src="shot.webp" alt="Shot" width="100%" onerror="x()"></a>\n  <br><sub>Caption &amp; more</sub>\n</p>\n',
      { html: true },
    );
    expect(nodes).toEqual([
      {
        tag: "p",
        align: "center",
        children: [
          {
            tag: "link",
            href: "shot.webp",
            children: [
              {
                tag: "image",
                src: "shot.webp",
                alt: "Shot",
                width: "100%",
                children: [],
              },
            ],
          },
          { tag: "br", children: [] },
          { tag: "sub", children: ["Caption & more"] },
        ],
      },
    ]);
  });

  it("drops scripts and unknown attributes, and keeps the text of unknown tags", () => {
    const nodes = parseMarkdown(
      '<div onclick="x()"><script>window.hacked = 1</script><font color="red">kept</font></div>\n\nText <i>in</i> a <span style="color:red">line</span><script>no</script>.\n',
      { html: true },
    );
    expect(nodes).toEqual([
      { tag: "div", children: ["kept"] },
      {
        tag: "p",
        children: [
          "Text ",
          { tag: "em", children: ["in"] },
          " a ",
          { tag: "span", children: ["line"] },
          ".",
        ],
      },
    ]);
  });

  it("nests HTML around Markdown blocks and skips layout whitespace", () => {
    const nodes = parseMarkdown(
      '<details>\n<summary>More</summary>\n\n- one\n\n</details>\n\n<table>\n  <tr>\n    <td width="50%">x</td>\n  </tr>\n</table>\n',
      { html: true },
    );
    expect(nodes).toEqual([
      {
        tag: "details",
        children: [
          { tag: "summary", children: ["More"] },
          {
            tag: "ul",
            children: [
              { tag: "li", children: [{ tag: "p", children: ["one"] }] },
            ],
          },
        ],
      },
      {
        tag: "table",
        children: [
          {
            tag: "tbody",
            children: [
              {
                tag: "tr",
                children: [{ tag: "td", width: "50%", children: ["x"] }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("gives Markdown links and images their address", () => {
    const [p] = parseMarkdown(
      '[Agents](AGENTS.md "The rules") ![A *b*](a.png)',
    );
    expect(p.children).toEqual([
      {
        tag: "link",
        href: "AGENTS.md",
        title: "AGENTS.md",
        children: ["Agents"],
      },
      " ",
      {
        tag: "image",
        src: "a.png",
        title: "a.png",
        alt: "A b",
        children: ["A ", { tag: "em", children: ["b"] }],
      },
    ]);
  });
});
