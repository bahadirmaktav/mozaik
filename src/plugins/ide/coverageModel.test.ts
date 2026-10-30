import { describe, expect, it } from "vitest";
import {
  coverageTree,
  lineState,
  parseReport,
  percent,
  totals,
  type CoverageNode,
} from "./coverageModel";

const LCOV = [
  "TN:",
  "SF:src/main.cpp",
  "FN:3,main",
  "FN:9,_Z6unusedv",
  "FNDA:1,main",
  "DA:3,1",
  "DA:4,5",
  "DA:5,0",
  "BRDA:4,0,0,5",
  "BRDA:4,0,1,0",
  "BRDA:5,0,0,-",
  "BRDA:5,0,1,-",
  "end_of_record",
  "SF:C:\\work\\p\\src\\inventory\\Inventory.cpp",
  "FNL:0,7,9",
  "FNA:0,2,_ZN9Inventory3addEv",
  "DA:7,2",
  "end_of_record",
  // A second test's record of the same file adds up.
  "SF:src/main.cpp",
  "DA:5,3",
  "FNDA:2,main",
  "end_of_record",
  "",
].join("\r\n");

const COBERTURA = `<?xml version="1.0" ?>
<!DOCTYPE coverage SYSTEM 'http://cobertura.sourceforge.net/xml/coverage-04.dtd'>
<coverage line-rate="0.75" branch-rate="0.5" version="gcovr 8.3">
  <sources><source>C:/work/p</source></sources>
  <packages><package name="src"><classes>
    <class name="main_cpp" filename="src/main.cpp" line-rate="0.75">
      <methods>
        <method name="main" signature="" line-rate="1"><lines><line number="3" hits="1"/></lines></method>
        <method name="unused&lt;int&gt;" signature="" line-rate="0"><lines><line number="9" hits="0"/></lines></method>
      </methods>
      <lines>
        <line number="3" hits="1" branch="false"/>
        <line number="4" hits="5" branch="true" condition-coverage="50% (1/2)"/>
        <line number="5" hits="0" branch="false"/>
        <line number="9" hits="0" branch="false"/>
      </lines>
    </class>
  </classes></package></packages>
</coverage>`;

const names = (nodes: CoverageNode[]): unknown =>
  nodes.map((n) =>
    n.kind === "folder" ? [n.name, names(n.children)] : n.name,
  );

describe("coverage reports", () => {
  it("read LCOV records, merging a file's records and lcov 2 functions", () => {
    const report = parseReport(LCOV, "C:\\work\\p");
    expect(report.format).toBe("lcov");
    const [main, inventory] = report.files;
    expect(main.path).toBe("C:\\work\\p\\src\\main.cpp");
    expect([...main.lines]).toEqual([
      [3, { hits: 1 }],
      [4, { hits: 5, branches: { covered: 1, total: 2 } }],
      [5, { hits: 3, branches: { covered: 0, total: 2 } }],
    ]);
    expect(main.functions).toEqual([
      { name: "main", line: 3, hits: 3 },
      { name: "_Z6unusedv", line: 9, hits: 0 },
    ]);
    expect(inventory.functions).toEqual([
      { name: "_ZN9Inventory3addEv", line: 7, hits: 2 },
    ]);
    expect(totals(report.files)).toEqual({
      lines: { covered: 4, total: 4 },
      functions: { covered: 2, total: 3 },
      branches: { covered: 1, total: 4 },
    });
  });
  it("read Cobertura classes against the report's source folder", () => {
    const report = parseReport(COBERTURA, "/elsewhere");
    expect(report.format).toBe("cobertura");
    const [main] = report.files;
    expect(main.path).toBe("C:\\work\\p\\src\\main.cpp");
    expect(main.lines.get(4)).toEqual({
      hits: 5,
      branches: { covered: 1, total: 2 },
    });
    expect(main.functions).toEqual([
      { name: "main", line: 3, hits: 1 },
      { name: "unused<int>", line: 9, hits: 0 },
    ]);
    expect(percent(totals(report.files).lines)).toBe("50%");
  });
  it("refuse other files and name line states", () => {
    expect(() => parseReport("<html></html>", "/p")).toThrow("Cobertura");
    expect(() => parseReport("hello", "/p")).toThrow("LCOV");
    expect(lineState({ hits: 0 })).toBe("uncovered");
    expect(lineState({ hits: 2, branches: { covered: 1, total: 2 } })).toBe(
      "partial",
    );
    expect(lineState({ hits: 2 })).toBe("covered");
    expect(percent({ covered: 1, total: 3 })).toBe("33.3%");
    expect(percent({ covered: 0, total: 0 })).toBe("");
  });
  it("build a compact folder tree, files outside the project apart", () => {
    const file = (path: string) => ({ path, lines: new Map(), functions: [] });
    const tree = coverageTree(
      [
        file("/p/src/main.cpp"),
        file("/p/src/inventory/a/Inventory.cpp"),
        file("/p/include/inventory/Inventory.hpp"),
        file("/usr/include/c++/vector"),
      ],
      "/p",
    );
    expect(names(tree)).toEqual([
      ["/usr/include/c++", ["vector"]],
      ["include/inventory", ["Inventory.hpp"]],
      ["src", [["inventory/a", ["Inventory.cpp"]], "main.cpp"]],
    ]);
  });
});
