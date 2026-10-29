import { describe, expect, it } from "vitest";
import { Lines, problemIn, problems } from "./buildOutput";

describe("build output", () => {
  it("recognises GCC, Clang, MSVC and CMake problems", () => {
    expect(
      problemIn(
        "C:/proj/src/main.cpp:4:9: error: 'x' was not declared in this scope",
        "C:/proj/build",
      ),
    ).toEqual({
      path: "C:/proj/src/main.cpp",
      line: 4,
      column: 9,
      severity: 1,
      message: "'x' was not declared in this scope",
    });
    expect(
      problemIn("../src/a.cpp:2: warning: unused [-Wunused]", "/p/build"),
    ).toMatchObject({ path: "/p/src/a.cpp", line: 2, column: 1 });
    expect(
      problemIn(
        "C:\\proj\\src\\main.cpp(12,5): error C2065: 'y': undeclared identifier",
        "C:\\proj\\build",
      ),
    ).toMatchObject({
      path: "C:\\proj\\src\\main.cpp",
      line: 12,
      column: 5,
      message: "C2065: 'y': undeclared identifier",
    });
    expect(problemIn("[2/3] Linking CXX executable app", "/b")).toBeNull();
    expect(problemIn("main.cpp:3:1: note: declared here", "/b")).toBeNull();
    const found = problems(
      [
        "CMake Error at CMakeLists.txt:3 (add_executable):",
        "  Cannot find source file:",
        "",
        "    nope.cpp",
        "/p/a.cpp:1:1: warning: w",
        "/p/a.cpp:1:1: warning: w",
      ].join("\n"),
      "/p",
      "/p/build",
    );
    expect(found).toHaveLength(2);
    expect(found[0]).toMatchObject({
      path: "/p/CMakeLists.txt",
      line: 3,
      severity: 1,
      message: "Cannot find source file:",
    });
    expect(found[1].severity).toBe(2);
  });

  it("keeps a bounded number of whole lines", () => {
    const lines = new Lines(3);
    lines.append("a\nb\r\nc");
    expect(lines.all()).toEqual(["a", "b", "c"]);
    lines.append("d\ne\n");
    expect(lines.lines).toEqual(["b", "cd", "e"]);
    expect(lines.dropped).toBe(1);
    lines.clear();
    expect(lines.all()).toEqual([]);
  });
});
