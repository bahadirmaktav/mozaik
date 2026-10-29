import { describe, expect, it } from "vitest";
import { command, modifierDown } from "./shortcuts";

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
  it("takes only K, C, E and arrows while the physical modifier is held", () => {
    const k = key({ key: "k", code: "KeyK", ctrlKey: true });
    expect(command(k, "ControlRight", true)).toEqual({ kind: "launcher" });
    // Left Ctrl+K: the right key is not held, so the module keeps the shortcut.
    expect(command(k, "ControlRight", false)).toBeNull();
    expect(
      command(key({ key: "ArrowLeft", ctrlKey: true }), "ControlRight", true),
    ).toEqual({ kind: "focus", edge: "left" });
    expect(
      command(
        key({ key: "c", code: "KeyC", ctrlKey: true }),
        "ControlRight",
        true,
      ),
    ).toEqual({ kind: "close" });
    expect(
      command(
        key({ key: "e", code: "KeyE", ctrlKey: true }),
        "ControlRight",
        true,
      ),
    ).toEqual({ kind: "quit" });
    // Left Ctrl+C still copies.
    expect(
      command(
        key({ key: "c", code: "KeyC", ctrlKey: true }),
        "ControlRight",
        false,
      ),
    ).toBeNull();
    for (const other of ["z", "v", "Enter", "s"])
      expect(
        command(key({ key: other, ctrlKey: true }), "ControlRight", true),
      ).toBeNull();
  });
  it("ignores extra modifiers, AltGr and a missed keyup", () => {
    const base = { key: "k", code: "KeyK", ctrlKey: true };
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
    expect(
      command(key({ key: "k", code: "KeyK" }), "ControlRight", true),
    ).toBeNull();
    expect(modifierDown(key({ altKey: true, altGraph: true }), "AltLeft")).toBe(
      false,
    );
  });
  it("supports Left Alt and non-Latin layouts", () => {
    expect(
      command(key({ key: "ArrowDown", altKey: true }), "AltLeft", true),
    ).toEqual({ kind: "focus", edge: "bottom" });
    expect(
      command(
        key({ key: "л", code: "KeyK", ctrlKey: true }),
        "ControlRight",
        true,
      ),
    ).toEqual({ kind: "launcher" });
  });
});
