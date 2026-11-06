import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import {
  applyEdits,
  decorations,
  emptyTrail,
  ignoredBy,
  fileEdits,
  goBack,
  goForward,
  offsetAt,
  offsetIn,
  rank,
  rows,
  sortEntries,
  textChange,
  visit,
} from "./model";
import {
  fromUri,
  pathKey,
  plainPath,
  relative,
  serverFor,
  toUri,
  within,
} from "./paths";

describe("paths", () => {
  it("compare canonical and plain Windows spellings and convert URIs", () => {
    expect(pathKey("\\\\?\\C:\\Proj\\A.cpp")).toBe(pathKey("c:/proj/a.cpp"));
    expect(within("\\\\?\\C:\\proj", "C:\\proj\\src\\a.cpp")).toBe(true);
    expect(within("C:\\proj", "C:\\project\\a.cpp")).toBe(false);
    expect(relative("\\\\?\\C:\\proj", "\\\\?\\C:\\proj\\src\\a.cpp")).toBe(
      "src/a.cpp",
    );
    expect(toUri("\\\\?\\C:\\my proj\\a#.cpp")).toBe(
      "file:///C:/my%20proj/a%23.cpp",
    );
    expect(pathKey(fromUri("file:///c%3A/my%20proj/a%23.cpp"))).toBe(
      pathKey("C:\\my proj\\a#.cpp"),
    );
    expect(fromUri(toUri("/home/u/ğ x.h"))).toBe("/home/u/ğ x.h");
    // Debuggers get the plain spelling: GDB cannot find `\\?\C:\…` in the debug info.
    expect(plainPath("\\\\?\\C:\\proj\\a.hpp")).toBe("C:\\proj\\a.hpp");
    expect(plainPath("/home/u/a.hpp")).toBe("/home/u/a.hpp");
    expect(serverFor("x/MAIN.CPP")?.language).toBe("cpp");
    expect(serverFor("readme.md")).toBeNull();
  });
});

describe("explorer", () => {
  it("lists folders first and nests expanded folders", () => {
    const entry = (path: string, directory = false) => ({
      path,
      name: path.split("/").pop()!,
      directory,
    });
    const children = new Map([
      [
        "/p",
        sortEntries([
          entry("/p/b.cpp"),
          entry("/p/src", true),
          entry("/p/A.h"),
        ]),
      ],
      ["/p/src", [entry("/p/src/main.cpp")]],
    ]);
    const visible = (expanded: string[]) =>
      rows("/p", new Set(expanded), children).map(
        (r) => `${r.depth}:${r.entry.name}`,
      );
    expect(visible([])).toEqual(["0:src", "0:A.h", "0:b.cpp"]);
    expect(visible(["/p/src"])).toEqual([
      "0:src",
      "1:main.cpp",
      "0:A.h",
      "0:b.cpp",
    ]);
  });
  it("marks changed files, their folders and untracked folder contents", () => {
    const state = decorations("/p", [
      { path: "/p/src/b.cpp", status: "U" },
      { path: "/p/src/a.cpp", status: "M" },
      { path: "/p/new", status: "U" },
    ]);
    expect(state("/p/src/a.cpp")).toEqual({ status: "M", folder: false });
    // Folders above changes take the most important one's color.
    expect(state("/p/src")).toEqual({ status: "M", folder: true });
    expect(state("/p")).toEqual({ status: "M", folder: true });
    expect(state("/p/new/deep/x.h")).toEqual({ status: "U", folder: false });
    expect(state("/p/other.cpp")).toBeUndefined();
  });
  it("dims what Git ignores, including everything in an ignored folder", () => {
    const ignored = ignoredBy("/p", ["/p/build", "/p/src/a.o"]);
    expect(ignored("/p/build")).toBe(true);
    expect(ignored("/p/build/deep/x.o")).toBe(true);
    expect(ignored("/p/src/a.o")).toBe(true);
    expect(ignored("/p/src")).toBe(false);
    expect(ignored("/p/builder")).toBe(false);
  });
});

describe("quick open", () => {
  it("ranks file name matches above scattered path matches", () => {
    const files = [
      "src/main.cpp",
      "docs/maintenance/index.md",
      "src/mapping.h",
    ];
    expect(rank("main", files)[0]).toBe("src/main.cpp");
    expect(rank("mph", files)).toEqual(["src/mapping.h"]);
    expect(rank("zzz", files)).toEqual([]);
  });
});

describe("location history", () => {
  it("goes back and forward and a new jump clears forward", () => {
    const a = { path: "/a", pos: 1 },
      b = { path: "/b", pos: 2 },
      c = { path: "/c", pos: 3 };
    let trail = visit(emptyTrail(), a);
    const back = goBack(trail, b)!;
    expect(back.target).toEqual(a);
    const forward = goForward(back.trail, a)!;
    expect(forward.target).toEqual(b);
    expect(goBack(forward.trail, b)!.target).toEqual(a);
    trail = visit(back.trail, c);
    expect(trail.forward).toEqual([]);
    expect(goForward(trail, c)).toBeNull();
  });
});

describe("text change", () => {
  const apply = (before: string, after: string) => {
    const { from, to, insert } = textChange(before, after);
    return before.slice(0, from) + insert + before.slice(to);
  };
  it("covers only the changed part", () => {
    expect(textChange("a\nb\nc\n", "a\nB\nc\n")).toEqual({
      from: 2,
      to: 3,
      insert: "B",
    });
    expect(textChange("abc", "abXbc")).toEqual({
      from: 2,
      to: 2,
      insert: "Xb",
    });
  });
  it("gives the new text when start and end overlap or a side is empty", () => {
    for (const [before, after] of [
      ["aaa", "aa"],
      ["aa", "aaa"],
      ["abab", "ab"],
      ["", "x"],
      ["x", ""],
      ["abc", "xyz"],
    ])
      expect(apply(before, after)).toBe(after);
  });
});

describe("text edits", () => {
  const at = (line: number, character: number) => ({ line, character });
  it("apply UTF-16 positions from the end and reject overlaps", () => {
    const text = "int 𝒳 = old;\nold();\n";
    expect(offsetAt(text, at(0, 9))).toBe(9);
    expect(offsetAt(text, at(0, 999))).toBe(13);
    // The same places in an editor's document, also past a line's end and the last line.
    const doc = Text.of(text.split("\n"));
    for (const place of [at(0, 9), at(0, 999), at(1, 2), at(2, 0), at(9, 9)])
      expect(offsetIn(doc, place)).toBe(offsetAt(text, place));
    const edits = [
      { range: { start: at(1, 0), end: at(1, 3) }, newText: "fresh" },
      { range: { start: at(0, 9), end: at(0, 12) }, newText: "fresh" },
    ];
    expect(applyEdits(text, edits)).toBe("int 𝒳 = fresh;\nfresh();\n");
    expect(() =>
      applyEdits(text, [
        { range: { start: at(0, 0), end: at(0, 5) }, newText: "" },
        { range: { start: at(0, 2), end: at(0, 3) }, newText: "" },
      ]),
    ).toThrow(/overlapping/);
  });
  it("collect edits per file and refuse file operations", () => {
    const edit = { range: { start: at(0, 0), end: at(0, 0) }, newText: "x" };
    expect(
      fileEdits({ changes: { "file:///a": [edit], "file:///b": [] } }),
    ).toEqual(new Map([["file:///a", [edit]]]));
    expect(
      fileEdits({
        documentChanges: [
          { textDocument: { uri: "file:///a" }, edits: [edit] },
        ],
      }).get("file:///a"),
    ).toEqual([edit]);
    expect(() =>
      fileEdits({ documentChanges: [{ kind: "delete", uri: "file:///a" }] }),
    ).toThrow(/does not apply/);
  });
});
