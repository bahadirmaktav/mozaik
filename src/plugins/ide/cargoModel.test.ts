import { describe, expect, it } from "vitest";
import { cargoProblems, targetLabel } from "./cargoModel";

describe("Cargo output", () => {
  it("reads rustc's errors and warnings with the place they point at", () => {
    const output = [
      "   Compiling demo v0.1.0 (C:\\w)",
      "warning: unused variable: `y`",
      " --> src\\lib.rs:3:9",
      "  |",
      "3 |     let y = 1;",
      "  |         ^ help: if this is intentional, prefix it with an underscore: `_y`",
      "  |",
      "  = note: `#[warn(unused_variables)]` on by default",
      "",
      "error[E0425]: cannot find value `x` in this scope",
      "  --> src/main.rs:12:20",
      "   |",
      '12 |     println!("{}", x);',
      "   |                    ^ not found in this scope",
      "",
      "warning: `demo` (lib) generated 1 warning",
      'error: could not compile `demo` (bin "demo") due to 1 previous error',
    ].join("\r\n");
    expect(cargoProblems(output)).toEqual([
      {
        path: "src\\lib.rs",
        line: 3,
        column: 9,
        severity: 2,
        message: "unused variable: `y`",
      },
      {
        path: "src/main.rs",
        line: 12,
        column: 20,
        severity: 1,
        message: "cannot find value `x` in this scope",
        code: "E0425",
      },
    ]);
  });
  it("counts a message once and takes only its first place", () => {
    const one = [
      "error[E0308]: mismatched types",
      " --> src/main.rs:2:5",
      "  |",
      "note: function defined here",
      " --> src/util.rs:1:8",
    ].join("\n");
    expect(cargoProblems(`${one}\n${one}`)).toHaveLength(1);
    // Clippy's lints have a path as their code.
    expect(
      cargoProblems(
        "warning[clippy::needless_return]: unneeded `return` statement\n --> src/a.rs:4:5",
      )[0].code,
    ).toBe("clippy::needless_return");
  });
  it("names Cargo targets by their name and CMake targets as they are", () => {
    expect(targetLabel("cargo:bin:demo-app:demo")).toBe("demo");
    expect(targetLabel("app_tests")).toBe("app_tests");
  });
});
