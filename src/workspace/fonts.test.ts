import { describe, expect, it } from "vitest";
import { defaultFonts } from "../services/preferences";
import {
  fontVariables,
  moduleFonts,
  TERMINAL_FONT,
  terminalFont,
  validFont,
} from "./fonts";

describe("fonts", () => {
  it("keeps every default until a font is chosen", () => {
    const variables = fontVariables(defaultFonts);
    expect(variables["--font-ui"]).toBe("system-ui, sans-serif");
    expect(
      Object.entries(variables).filter(([, v]) => v !== null),
    ).toHaveLength(1);
    expect(terminalFont(defaultFonts)).toBe(TERMINAL_FONT);
  });

  it("gives each module its own font unless the General font is for all", () => {
    const fonts = {
      ...defaultFonts,
      ui: "Inter",
      terminal: "JetBrainsMono Nerd Font",
      notes: "Georgia",
    };
    expect(moduleFonts(fonts)).toMatchObject({
      terminal: "JetBrainsMono Nerd Font",
      notes: "Georgia",
      textEditor: null,
    });
    const variables = fontVariables(fonts);
    expect(variables["--font-ui"]).toBe('"Inter", system-ui, sans-serif');
    expect(variables["--font-notes"]).toBe('"Georgia", system-ui, sans-serif');
    expect(variables["--font-text-editor"]).toBeNull();
    expect(terminalFont(fonts)).toBe(
      `"JetBrainsMono Nerd Font", ${TERMINAL_FONT}`,
    );

    const all = moduleFonts({ ...fonts, all: true });
    expect(Object.values(all).every((f) => f === "Inter")).toBe(true);
    // "All" without a General font leaves the modules alone.
    expect(moduleFonts({ ...fonts, ui: null, all: true }).notes).toBe(
      "Georgia",
    );
  });

  it("monospace modules fall back to a monospace font", () => {
    const variables = fontVariables({ ...defaultFonts, ide: "Fira Code" });
    expect(variables["--font-ide"]).toBe(
      '"Fira Code", Consolas, "Liberation Mono", monospace',
    );
    expect(
      fontVariables({ ...defaultFonts, ide: "monospace" })["--font-ide"],
    ).toMatch(/^monospace, /);
  });

  it("never lets a name leave its CSS value", () => {
    expect(validFont("CaskaydiaCove Nerd Font Mono")).toBe(true);
    for (const bad of ['a"; color: red', "a, b", "a}", "a\\", "x(1)", "a;b"])
      expect(validFont(bad)).toBe(false);
    expect(fontVariables({ ...defaultFonts, ui: 'x"}' })["--font-ui"]).toBe(
      "system-ui, sans-serif",
    );
  });
});
