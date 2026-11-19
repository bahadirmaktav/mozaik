import { describe, expect, it } from "vitest";
import { splitQuery } from "./folderBrowserModel";

describe("splitQuery", () => {
  it("lists the folder before the last separator and filters by the rest", () => {
    expect(splitQuery("C:\\Users\\me\\Pro", "\\", "C:\\Users\\me")).toEqual({
      directory: "C:\\Users\\me\\",
      name: "Pro",
    });
    expect(splitQuery("/home/me/", "/", "/home/me")).toEqual({
      directory: "/home/me/",
      name: "",
    });
  });
  it("reads ~ as the home folder", () => {
    expect(splitQuery("~/src", "/", "/home/me")).toEqual({
      directory: "/home/me/",
      name: "src",
    });
    expect(splitQuery("~", "/", "/home/me")).toEqual({
      directory: "/home/me/",
      name: "",
    });
  });
  it("lists a bare drive's root and a bare name in home", () => {
    expect(splitQuery("D:", "\\", "C:\\Users\\me")).toEqual({
      directory: "D:\\",
      name: "",
    });
    expect(splitQuery("Doc", "\\", "C:\\Users\\me")).toEqual({
      directory: "C:\\Users\\me\\",
      name: "Doc",
    });
  });
});
