import { describe, expect, it } from "vitest";
import { endsInIncludeFolder } from "./includes";

describe("include folders", () => {
  it("knows a path that ends in a folder", () => {
    expect(endsInIncludeFolder("#include <boost/")).toBe(true);
    expect(endsInIncludeFolder('  #  include "core/net/')).toBe(true);
    expect(endsInIncludeFolder("#import <Foundation/")).toBe(true);
  });
  it("leaves headers, other lines and finished paths alone", () => {
    expect(endsInIncludeFolder("#include <boost/optional.hpp>")).toBe(false);
    expect(endsInIncludeFolder("#include <vector")).toBe(false);
    expect(endsInIncludeFolder("int a = b / ")).toBe(false);
    expect(endsInIncludeFolder('// #include "x/')).toBe(false);
  });
});
