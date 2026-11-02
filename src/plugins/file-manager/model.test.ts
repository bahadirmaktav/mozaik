import { describe, expect, it } from "vitest";
import type { FileEntry } from "../../services/filesystem";
import {
  affects,
  formatSize,
  goBack,
  goForward,
  retain,
  select,
  sortEntries,
  visibleEntries,
  relativeFolder,
  visit,
  within,
  type History,
} from "./model";

const entry = (name: string, change: Partial<FileEntry> = {}): FileEntry => ({
  path: `/home/${name}`,
  name,
  kind: "file",
  targetKind: null,
  hidden: false,
  size: 0,
  modified: 0,
  broken: false,
  unsupported: false,
  ...change,
});
const names = (entries: FileEntry[]) => entries.map((e) => e.name);

describe("file manager listing", () => {
  const entries = [
    entry("b.txt", { size: 10, modified: 3 }),
    entry("src", { kind: "directory", size: null, modified: 1 }),
    entry("a10.txt", { size: 10, modified: 1 }),
    entry("a2.txt", { size: 300, modified: 2 }),
    entry("link", { kind: "symlink", targetKind: "directory", size: null }),
    entry(".env", { hidden: true }),
  ];
  it("keeps folders first in every sort with a stable name tiebreak", () => {
    expect(
      names(sortEntries(entries, { by: "name", direction: "asc" })),
    ).toEqual(["link", "src", ".env", "a2.txt", "a10.txt", "b.txt"]);
    expect(
      names(sortEntries(entries, { by: "name", direction: "desc" })).slice(
        0,
        2,
      ),
    ).toEqual(["src", "link"]);
    expect(
      names(sortEntries(entries, { by: "size", direction: "desc" })),
    ).toEqual(["link", "src", "a2.txt", "a10.txt", "b.txt", ".env"]);
    expect(
      names(sortEntries(entries, { by: "modified", direction: "asc" })).slice(
        2,
      ),
    ).toEqual([".env", "a10.txt", "a2.txt", "b.txt"]);
  });
  it("filters names in the current listing and hides hidden entries by default", () => {
    expect(names(visibleEntries(entries, "", false))).not.toContain(".env");
    expect(names(visibleEntries(entries, "", true))).toContain(".env");
    // Search results show their folder relative to the searched one.
    expect(relativeFolder("/home/u/a/b/x.txt", "/home/u", "/")).toBe("a/b");
    expect(relativeFolder("/home/u/x.txt", "/home/u", "/")).toBe(".");
    expect(relativeFolder("C:\\src\\x.rs", "C:\\", "\\")).toBe("src");
    expect(relativeFolder("C:\\x.rs", "C:\\", "\\")).toBe(".");
    expect(names(visibleEntries(entries, " A1", false))).toEqual(["a10.txt"]);
  });
  it("formats sizes without sizing folders", () => {
    expect(formatSize(null)).toBe("—");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(5 * 1024 ** 3)).toBe("5.0 GB");
  });
});

describe("file manager navigation and selection", () => {
  it("drops the forward branch when visiting after Back", () => {
    let history: History = { back: [], forward: [] };
    history = visit(history, "/a");
    history = visit(history, "/b");
    const back = goBack(history, "/c")!;
    expect(back.target).toBe("/b");
    expect(goForward(back.history, "/b")!.target).toBe("/c");
    expect(visit(back.history, "/b")).toEqual({
      back: ["/a", "/b"],
      forward: [],
    });
    expect(goBack({ back: [], forward: [] }, "/")).toBeNull();
  });
  it("supports click, ctrl toggle and shift range in visible order", () => {
    const order = ["a", "b", "c", "d"];
    let s = select(
      { paths: new Set(), anchor: null, cursor: null },
      order,
      "b",
      {},
    );
    s = select(s, order, "d", { shift: true });
    expect([...s.paths]).toEqual(["b", "c", "d"]);
    s = select(s, order, "c", { ctrl: true });
    expect([...s.paths]).toEqual(["b", "d"]);
    expect([...retain(s, ["a", "d"]).paths]).toEqual(["d"]);
  });
  it("matches paths per platform rules", () => {
    expect(within("C:\\Users\\me\\x", "c:\\users", "\\")).toBe(true);
    expect(within("/home/me2", "/home/me", "/")).toBe(false);
    expect(within("/a/b", "/", "/")).toBe(true);
    expect(affects("/a/b/new.txt", "/a/b", "/")).toBe(true);
    expect(affects("/a/b/c/new.txt", "/a/b", "/")).toBe(false);
    expect(affects("C:\\new.txt", "C:\\", "\\")).toBe(true);
  });
});
