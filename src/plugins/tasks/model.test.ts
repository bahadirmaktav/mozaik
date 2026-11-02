import { describe, expect, it } from "vitest";
import type { Task, TasksDocument } from "../../services/tasks";
import { anchors, groups, listColor, selectedList, step } from "./model";
import {
  parseMarkdown,
  type MarkdownNode,
} from "../../components/parseMarkdown";

const task = (id: string, listId: string, orderKey: number, status = "todo") =>
  ({
    id,
    listId,
    orderKey,
    status,
    title: id,
    descriptionMarkdown: "",
    priority: "medium",
    createdAt: "",
    updatedAt: "",
  }) as Task;
const document = (tasks: Task[], selectedListId = "all"): TasksDocument => ({
  schemaVersion: 1,
  revision: 1,
  lists: [
    { id: "inbox", name: "Inbox", system: true },
    { id: "work", name: "Work", system: false },
  ],
  tasks,
  preferences: { selectedListId },
});

describe("list colors", () => {
  it("keep Inbox muted and give other lists a stable theme color", () => {
    const doc = document([]);
    expect(listColor(doc, "inbox")).toBe("var(--muted)");
    expect(listColor(doc, "work")).toMatch(/^var\(--syntax-/);
    expect(listColor(doc, "work")).toBe(listColor(doc, "work"));
  });
});
const ids = (tasks: Task[]) => tasks.map((t) => t.id);

describe("task grouping and ordering", () => {
  const doc = document([
    task("c", "inbox", 2),
    task("a", "inbox", 0),
    task("b", "work", 1),
    task("d", "work", 3),
    task("x", "work", 0, "done"),
  ]);
  it("merges All Lists by the shared status order and filters single lists", () => {
    expect(ids(groups(doc, "all").todo)).toEqual(["a", "b", "c", "d"]);
    expect(ids(groups(doc, "work").todo)).toEqual(["b", "d"]);
    expect(ids(groups(doc, "work").done)).toEqual(["x"]);
    expect(groups(doc, "inbox").in_progress).toEqual([]);
  });
  it("falls back to All Lists for a stale selection", () => {
    expect(selectedList(document([], "work"))).toBe("work");
    expect(selectedList(document([], "deleted"))).toBe("all");
  });
  it("anchors drops to visible neighbours", () => {
    const work = groups(doc, "work").todo;
    expect(anchors(work, 0)).toEqual({ before: "b", after: null });
    expect(anchors(work, 2)).toEqual({ before: null, after: "d" });
    expect(anchors([], 0)).toEqual({ before: null, after: null });
    expect(step(work, "b", 1)).toEqual({ before: null, after: "d" });
    expect(step(work, "d", -1)).toEqual({ before: "b", after: null });
    expect(step(work, "b", -1)).toBeNull();
  });
});

describe("markdown preview", () => {
  const tags = (nodes: (MarkdownNode | string)[]): string[] =>
    nodes.flatMap((n) =>
      typeof n === "string" ? [] : [n.tag, ...tags(n.children)],
    );
  const text = (nodes: (MarkdownNode | string)[]): string =>
    nodes.map((n) => (typeof n === "string" ? n : text(n.children))).join("");
  it("renders common Markdown with a fixed set of elements", () => {
    const nodes = parseMarkdown(
      "# Title\n\nSome **bold**, _em_, ~~old~~ and `code`.\n\n- [x] done\n- [ ] open\n\n3. three\n\n> quote\n\n```js\nlet a = 1;\n```",
    );
    expect(tags(nodes)).toEqual([
      "h1",
      "p",
      "strong",
      "em",
      "del",
      "code",
      "ul",
      "li",
      "task",
      "li",
      "task",
      "ol",
      "li",
      "p",
      "blockquote",
      "p",
      "pre",
    ]);
    expect(text(nodes)).toContain("Some bold, em, old and code.");
    expect(nodes[3]).toMatchObject({ tag: "ol", start: 3 });
    expect(text([nodes[5]])).toBe("let a = 1;");
  });
  it("keeps HTML, scripts, links and images inert", () => {
    const nodes = parseMarkdown(
      '<script>alert(1)</script>\n\nA <img src=x onerror=alert(1)> [link](javascript:alert(1) "t") ![pic](http://example.com/a.png) &lt;b&gt; \\*',
    );
    expect(tags(nodes)).toEqual(["p", "p", "link", "image"]);
    expect(text(nodes)).toContain("<script>alert(1)</script>");
    expect(text(nodes)).toContain("<img src=x onerror=alert(1)>");
    expect(text(nodes)).toContain("link pic <b> *");
    const paragraph = nodes[1] as MarkdownNode;
    expect(paragraph.children).toContainEqual({
      tag: "link",
      title: "javascript:alert(1)",
      children: ["link"],
    });
  });
});
