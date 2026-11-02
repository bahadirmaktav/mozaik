import { afterEach, describe, expect, it } from "vitest";
import {
  chordStart,
  conflicts,
  keysOf,
  label,
  matches,
  matchesChord,
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
    expect(
      matchesHeld(key("ArrowLeft", { code: "ArrowLeft" }), "focus.left"),
    ).toBe(true);
    // AltGr typing a character is never a shortcut.
    expect(
      matches(
        key("n", { ctrlKey: true, altKey: true, altGraph: true }),
        "window",
      ),
    ).toBe(false);
  });
  it("zoom the IDE with whichever keys type + and -", () => {
    const zoom = (k: string, code: string) =>
      key(k, { code, ctrlKey: true, shiftKey: true });
    // US Shift+=, Turkish Q Shift+4 and the keypad all type +.
    expect(matches(zoom("+", "Equal"), "ide.zoom.in")).toBe(true);
    expect(matches(zoom("+", "Digit4"), "ide.zoom.in")).toBe(true);
    expect(matches(zoom("+", "NumpadAdd"), "ide.zoom.in")).toBe(true);
    // Shift+- types _ on US and Turkish Q; the key is named unshifted.
    expect(matches(zoom("_", "Minus"), "ide.zoom.out")).toBe(true);
    expect(matches(zoom("-", "NumpadSubtract"), "ide.zoom.out")).toBe(true);
    expect(label(keysOf("ide.zoom.in"), "Right Ctrl")).toBe("Ctrl+Shift++");
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
    // A workspace-key change saved before the launcher left the workspace key is dropped.
    setCustom({ launcher: "Mod+J", "focus.left": "Ctrl+J" });
    expect(keysOf("launcher")).toBe("Ctrl+Shift+[Quote]");
    // A position key shows what it types (the US layout without a layout map).
    expect(label(keysOf("launcher"), "Right Ctrl")).toBe("Ctrl+Shift+'");
    expect(keysOf("focus.left")).toBe("Mod+ArrowLeft");
    setCustom({ new: "Ctrl+Shift+Y" });
    expect(matches(key("n", { ctrlKey: true }), "new")).toBe(false);
    expect(conflicts("new", "Ctrl+S").map((s) => s.id)).toEqual(["save"]);
    // The same keys in two modules that are never focused together are fine.
    expect(conflicts("code.line", "Ctrl+L")).toEqual([]);
  });
  it("match chords key by key, never as a single key", () => {
    const chords = ["code.comment.add", "code.comment.remove"];
    const k = key("k", { ctrlKey: true, code: "KeyK" });
    expect(matches(k, "code.comment.add")).toBe(false);
    expect(chordStart(key("k"), chords)).toBeNull();
    const first = chordStart(k, chords)!;
    expect(first).toBe("Ctrl+K");
    const c = key("c", { ctrlKey: true, code: "KeyC" });
    expect(matchesChord(c, first, "code.comment.add")).toBe(true);
    expect(matchesChord(c, first, "code.comment.remove")).toBe(false);
    expect(
      matchesChord(key("u", { ctrlKey: true }), first, "code.comment.remove"),
    ).toBe(true);
    // A chord may be changed to a single key, which then matches as usual.
    setCustom({ "code.comment.add": "Ctrl+Shift+7" });
    expect(chordStart(k, ["code.comment.add"])).toBeNull();
    expect(
      matches(
        key("7", { ctrlKey: true, shiftKey: true, code: "Digit7" }),
        "code.comment.add",
      ),
    ).toBe(true);
  });
});
