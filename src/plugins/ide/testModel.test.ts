import { describe, expect, it } from "vitest";
import {
  definitionPattern,
  groupStatus,
  groupTests,
  ResultReader,
  splitName,
} from "./testModel";

const test = (name: string, target: string | null = "basic_tests") => ({
  name,
  target,
  args: [],
  disabled: false,
});

describe("testing view", () => {
  it("groups tests by program, then GoogleTest suite (a TEST_F's fixture)", () => {
    expect(
      splitName("Table/ItemValue.IsPriceTimesQuantity/(10, 1, 10)"),
    ).toEqual({
      suite: "Table/ItemValue",
      test: "IsPriceTimesQuantity/(10, 1, 10)",
    });
    expect(splitName("script")).toEqual({ suite: "", test: "script" });
    const groups = groupTests([
      test("InventoryBasic.StartsEmpty"),
      test("StockedInventory.HasThreeItems", "fixture_tests"),
      test("InventoryBasic.ShowsAFailure"),
      test("StockedInventory.TotalValue", "fixture_tests"),
      test("lint", null),
    ]);
    expect(
      groups.map((p) => [
        p.target,
        p.suites.map((s) => [s.name, s.tests.map((t) => t.label)]),
      ]),
    ).toEqual([
      ["basic_tests", [["InventoryBasic", ["StartsEmpty", "ShowsAFailure"]]]],
      [
        "fixture_tests",
        [["StockedInventory", ["HasThreeItems", "TotalValue"]]],
      ],
      [null, [["", ["lint"]]]],
    ]);
  });
  it("reads starts, results and a failed test's output from CTest, in any chunks", () => {
    const reader = new ResultReader();
    const output = [
      "Test project C:/p/build",
      "    Start  6: InventoryBasic.ShowsAFailure",
      "1/4 Test  #6: InventoryBasic.ShowsAFailure .......***Not Run (Disabled)   0.00 sec",
      "    Start  7: StockedInventory.HasThreeItems",
      "2/4 Test  #7: StockedInventory.HasThreeItems .....***Failed    0.01 sec",
      "Running main() from gtest_main.cc",
      "fixture_test.cpp:20: Failure",
      "    Start 13: Table/ItemValue.IsPriceTimesQuantity/(10, 1, 10)",
      "3/4 Test #13: Table/ItemValue.IsPriceTimesQuantity/(10, 1, 10) ...   Passed    0.01 sec",
      "4/4 Test #14: Crash ...***Exception: SegFault  0.02 sec",
      "",
      "75% tests passed, 1 tests failed out of 4",
    ].join("\r\n");
    const events = [
      ...reader.push(output.slice(0, 150)),
      ...reader.push(output.slice(150)),
      ...reader.push("", true),
    ];
    expect(events).toEqual([
      { kind: "start", name: "InventoryBasic.ShowsAFailure" },
      {
        kind: "result",
        name: "InventoryBasic.ShowsAFailure",
        status: "skipped",
        detail: "Not Run (Disabled)",
        seconds: 0,
      },
      { kind: "start", name: "StockedInventory.HasThreeItems" },
      {
        kind: "result",
        name: "StockedInventory.HasThreeItems",
        status: "failed",
        detail: "Failed",
        seconds: 0.01,
      },
      {
        kind: "output",
        name: "StockedInventory.HasThreeItems",
        line: "Running main() from gtest_main.cc",
      },
      {
        kind: "output",
        name: "StockedInventory.HasThreeItems",
        line: "fixture_test.cpp:20: Failure",
      },
      {
        kind: "start",
        name: "Table/ItemValue.IsPriceTimesQuantity/(10, 1, 10)",
      },
      {
        kind: "result",
        name: "Table/ItemValue.IsPriceTimesQuantity/(10, 1, 10)",
        status: "passed",
        detail: "Passed",
        seconds: 0.01,
      },
      {
        kind: "result",
        name: "Crash",
        status: "failed",
        detail: "Exception: SegFault",
        seconds: 0.02,
      },
      { kind: "output", name: "Crash", line: "" },
    ]);
  });
  it("summarizes groups and finds definitions without parameters", () => {
    expect(groupStatus(["passed", "running"])).toBe("running");
    expect(groupStatus(["passed", "failed"])).toBe("failed");
    expect(groupStatus(["passed", "skipped"])).toBe("passed");
    expect(groupStatus(["passed", undefined])).toBeUndefined();
    const pattern = new RegExp(
      definitionPattern("Table/ItemValue.IsPriceTimesQuantity/(10, 1, 10)"),
    );
    expect(pattern.test("TEST_P(ItemValue, IsPriceTimesQuantity) {")).toBe(
      true,
    );
    expect(
      new RegExp(definitionPattern("InventoryBasic.ShowsAFailure")).test(
        "TEST(InventoryBasic, DISABLED_ShowsAFailure) {",
      ),
    ).toBe(true);
  });
});
