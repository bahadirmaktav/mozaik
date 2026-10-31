import { describe, expect, it } from "vitest";
import { command, modifierDown, moveKeys } from "./shortcuts";
import { matches } from "./keybindings";

function key(
  init: Partial<{
    key: string;
    code: string;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    altGraph: boolean;
  }>,
) {
  return {
    key: "",
    code: "",
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init,
    getModifierState: (name: string) => name === "AltGraph" && !!init.altGraph,
  };
}

describe("workspace shortcuts", () => {
  it("takes only the arrows while the physical modifier is held", () => {
    expect(
      command(key({ key: "ArrowLeft", ctrlKey: true }), "ControlRight", true),
    ).toEqual({ kind: "focus", edge: "left" });
    // Left Ctrl+arrows: the right key is not held, so the editor moves by word.
    expect(
      command(key({ key: "ArrowLeft", ctrlKey: true }), "ControlRight", false),
    ).toBeNull();
    // K, C and E are no longer workspace-key commands: Right Ctrl+C copies.
    for (const other of ["k", "c", "e", "z", "v", "Enter", "s"])
      expect(
        command(key({ key: other, ctrlKey: true }), "ControlRight", true),
      ).toBeNull();
  });
  it("ignores extra modifiers, AltGr and a missed keyup", () => {
    const base = { key: "ArrowUp", ctrlKey: true };
    expect(
      command(key({ ...base, shiftKey: true }), "ControlRight", true),
    ).toBeNull();
    expect(
      command(key({ ...base, altKey: true }), "ControlRight", true),
    ).toBeNull();
    expect(
      command(
        key({ ...base, altKey: true, altGraph: true }),
        "ControlLeft",
        true,
      ),
    ).toBeNull();
    // Held was not cleared, but the event shows Ctrl is up.
    expect(command(key({ key: "ArrowUp" }), "ControlRight", true)).toBeNull();
    expect(modifierDown(key({ altKey: true, altGraph: true }), "AltLeft")).toBe(
      false,
    );
  });
  it("supports Left Alt", () => {
    expect(
      command(key({ key: "ArrowDown", altKey: true }), "AltLeft", true),
    ).toEqual({ kind: "focus", edge: "bottom" });
  });
  it("opens the launcher, settings and closes with Ctrl+Shift keys on any layout", () => {
    const ctrlShift = { ctrlKey: true, shiftKey: true };
    // The launcher is a key position (VS Code's oem_7): `"` with Shift on US, İ on Turkish Q.
    expect(
      matches(key({ key: '"', code: "Quote", ...ctrlShift }), "launcher"),
    ).toBe(true);
    expect(
      matches(key({ key: "İ", code: "Quote", ...ctrlShift }), "launcher"),
    ).toBe(true);
    expect(
      matches(key({ key: "I", code: "KeyI", ...ctrlShift }), "launcher"),
    ).toBe(false);
    expect(
      matches(key({ key: "C", code: "KeyC", ...ctrlShift }), "module.close"),
    ).toBe(true);
    expect(
      matches(key({ key: "E", code: "KeyE", ...ctrlShift }), "window.close"),
    ).toBe(true);
    // Shift makes the comma key type `<` (US): the binding names the key.
    expect(
      matches(key({ key: "<", code: "Comma", ...ctrlShift }), "settings"),
    ).toBe(true);
    expect(
      matches(key({ key: ",", code: "Comma", ctrlKey: true }), "settings"),
    ).toBe(false);
    expect(moveKeys(key(ctrlShift))).toBe(true);
    expect(moveKeys(key({ ctrlKey: true }))).toBe(false);
    expect(moveKeys(key({ ...ctrlShift, altKey: true }))).toBe(false);
  });
});
