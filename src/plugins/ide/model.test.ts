import { describe, expect, it } from "vitest";
import {
  applyEdits,
  decorations,
  emptyTrail,
  fileEdits,
  goBack,
  goForward,
  offsetAt,
  rank,
  rows,
  sortEntries,
  visit,
} from "./model";
import { fromUri, pathKey, relative, serverFor, toUri, within } from "./paths";

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
      { path: "/p/src/a.cpp", status: "M" },
      { path: "/p/new", status: "U" },
    ]);
    expect(state("/p/src/a.cpp")).toBe("M");
    expect(state("/p/src")).toBe("folder");
    expect(state("/p/new/deep/x.h")).toBe("U");
    expect(state("/p/other.cpp")).toBeUndefined();
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

describe("text edits", () => {
  const at = (line: number, character: number) => ({ line, character });
  it("apply UTF-16 positions from the end and reject overlaps", () => {
    const text = "int 𝒳 = old;\nold();\n";
    expect(offsetAt(text, at(0, 9))).toBe(9);
    expect(offsetAt(text, at(0, 999))).toBe(13);
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
