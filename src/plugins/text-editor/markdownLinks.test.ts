import { describe, expect, it } from "vitest";
import { headingSlug, linkTarget } from "./markdownLinks";

describe("Markdown links", () => {
  it("resolves relative files against the document's folder", () => {
    expect(linkTarget("C:\\repo\\README.md", "AGENTS.md")).toEqual({
      kind: "file",
      path: "C:\\repo\\AGENTS.md",
    });
    expect(
      linkTarget("C:\\repo\\docs\\a.md", "../docs/assets/My%20shot.webp"),
    ).toEqual({ kind: "file", path: "C:\\repo\\docs\\assets\\My shot.webp" });
    expect(
      linkTarget("/home/u/repo/README.md", "./docs/GUIDE.md#build"),
    ).toEqual({
      kind: "file",
      path: "/home/u/repo/docs/GUIDE.md",
      slug: "build",
    });
    expect(linkTarget("\\\\srv\\share\\a.md", "../../b.md")).toEqual({
      kind: "file",
      path: "\\\\srv\\share\\b.md",
    });
  });

  it("tells headings, web addresses and links that open nothing apart", () => {
    expect(linkTarget("/r/README.md", "#build-from-source")).toEqual({
      kind: "anchor",
      slug: "build-from-source",
    });
    expect(linkTarget("/r/README.md", "https://example.com")).toEqual({
      kind: "web",
      url: "https://example.com",
    });
    expect(linkTarget("/r/README.md", "javascript:alert(1)")).toBeNull();
    expect(linkTarget("/r/README.md", "data:text/html,x")).toBeNull();
    expect(linkTarget(null, "AGENTS.md")).toBeNull();
    // Root-relative means the repository's root on GitHub: unknown on Windows.
    expect(linkTarget("C:\\r\\README.md", "/docs/a.md")).toBeNull();
    expect(linkTarget("C:\\r\\README.md", "file:///C:/x/y.md")).toEqual({
      kind: "file",
      path: "C:\\x\\y.md",
    });
  });

  it("never points a local document at another computer", () => {
    // Reading `\\server\share` would make Windows sign in there (SMB) and send the user's
    // NTLM hash: a README must not name a share for a picture or link.
    for (const href of [
      "\\\\evil\\s\\x.png",
      "//evil/s/x.png",
      "\\/evil/s/x.png",
      " <\\\\evil\\s\\x.png>",
      "%5C%5Cevil%5Cs%5Cx.png",
      "%2F%2Fevil/s/x.png",
      "file://evil/s/x.png",
      "file:////evil/s/x.png",
      "file:\\\\evil\\s\\x.png",
      "\\\\?\\UNC\\evil\\s\\x.png",
      "\\\\.\\pipe\\x.png",
    ])
      expect(linkTarget("C:\\r\\README.md", href), href).toBeNull();
    // Up from a share stays on that share.
    expect(
      linkTarget("\\\\srv\\share\\a.md", "../../../other/s/x.png"),
    ).toEqual({ kind: "file", path: "\\\\srv\\share\\other\\s\\x.png" });
  });

  it("writes heading anchors as GitHub does", () => {
    expect(headingSlug("Build from source")).toBe("build-from-source");
    expect(headingSlug("What's inside?")).toBe("whats-inside");
    expect(headingSlug("Çalışma alanı")).toBe("çalışma-alanı");
  });
});
