import { afterEach, describe, expect, it } from "vitest";
import {
  conflicts,
  keysOf,
  matches,
  matchesHeld,
  record,
  setCustom,
} from "./keybindings";

const key = (
  key: string,
  extra: Partial<{
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    altGraph: boolean;
  }> = {},
) => ({
  key,
  code: extra.code ?? "",
  ctrlKey: !!extra.ctrlKey,
  altKey: !!extra.altKey,
  shiftKey: !!extra.shiftKey,
  metaKey: false,
  getModifierState: (name: string) => name === "AltGraph" && !!extra.altGraph,
});

afterEach(() => setCustom({}));
describe("keybindings", () => {
  it("match exact modifiers, letters in any case and the K position on other layouts", () => {
    expect(matches(key("s", { ctrlKey: true }), "save")).toBe(true);
    expect(matches(key("S", { ctrlKey: true, shiftKey: true }), "save")).toBe(
      false,
    );
    expect(
      matches(key("S", { ctrlKey: true, shiftKey: true }), "save.as"),
    ).toBe(true);
    expect(matchesHeld(key("л", { code: "KeyK" }), "launcher")).toBe(true);
    // AltGr typing a character is never a shortcut.
    expect(
      matches(
        key("n", { ctrlKey: true, altKey: true, altGraph: true }),
        "window",
      ),
    ).toBe(false);
  });
  it("record pressed keys, apply changes and report conflicts", () => {
    expect(record(key("Control", { ctrlKey: true }))).toBeNull();
    expect(record(key("ArrowUp", { ctrlKey: true, altKey: true }))).toBe(
      "Ctrl+Alt+ArrowUp",
    );
    setCustom({ new: "Ctrl+Shift+Y", "code.definition.click": "X", bad: "Y" });
    expect(keysOf("new")).toBe("Ctrl+Shift+Y");
    // Fixed and unknown shortcuts cannot change.
    expect(keysOf("code.definition.click")).toBe("Ctrl+Click");
    expect(matches(key("n", { ctrlKey: true }), "new")).toBe(false);
    expect(conflicts("new", "Ctrl+S").map((s) => s.id)).toEqual(["save"]);
    // The same keys in two modules that are never focused together are fine.
    expect(conflicts("code.line", "Ctrl+L")).toEqual([]);
  });
});
