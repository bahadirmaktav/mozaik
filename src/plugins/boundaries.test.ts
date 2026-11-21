import { describe, expect, it } from "vitest";

// A module imports the core, the shared layers, `contract` and `shared`, never another
// module's files (docs/decisions/034-module-boundaries.md). Tests may compare two modules.
const SOURCES: Record<string, string> = import.meta.glob(
  ["./*/**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"],
  { query: "?raw", import: "default", eager: true },
);
const COMMON = new Set(["contract", "shared"]);

/** The folder under `src/plugins` a relative specifier from `file` lands in, or null
 * outside `src/plugins`. */
function moduleOf(file: string, specifier: string) {
  const parts = file.split("/").slice(1, -1);
  for (const part of specifier.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part !== ".") parts.push(part);
  }
  return parts[0] ?? null;
}

describe("module boundaries", () => {
  it("finds the modules' sources", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
  });
  it("keeps modules from importing each other", () => {
    const crossings: string[] = [];
    for (const [file, text] of Object.entries(SOURCES)) {
      const module = file.split("/")[1];
      if (COMMON.has(module)) continue;
      for (const [, specifier] of text.matchAll(
        /(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g,
      )) {
        const target = moduleOf(file, specifier);
        if (target === null || target === module || COMMON.has(target))
          continue;
        crossings.push(`${file} -> ${specifier}`);
      }
    }
    expect(crossings).toEqual([]);
  });
});
