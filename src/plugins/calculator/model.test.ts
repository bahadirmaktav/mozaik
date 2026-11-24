import { describe, expect, it } from "vitest";
import {
  newCalculator,
  perform,
  shown,
  type Action,
  type Calculator,
} from "./model";
import { keyAction, pasteActions } from "./keys";
import { formatNumber } from "./scientific";
import { grouped } from "./programmer";

/** Types keys as the panel does; `[name]` is a function or a named key. */
function run(c: Calculator, keys: (string | Action)[]) {
  for (const key of keys) {
    const action = typeof key === "string" ? keyAction(key, c) : key;
    if (!action) throw new Error(`no key ${key}`);
    c = perform(c, action);
  }
  return c;
}
const chars = (text: string) => [...text];
const fn = (name: string): Action => ({ type: "fn", name });
const scientific = (text: string, ...more: (string | Action)[]) =>
  shown(run(newCalculator(), [...chars(text), ...more]));
const programmerAt = (base: 16 | 10 | 8 | 2, bits: 64 | 32 | 16 | 8 = 64) =>
  run(newCalculator(), [
    { type: "mode", mode: "programmer" },
    { type: "bits", bits },
    { type: "base", base },
  ]);

describe("Scientific", () => {
  it("follows operator precedence and parentheses", () => {
    expect(scientific("2+3*4=").display).toBe("14");
    expect(scientific("2*(3+4)^2=").display).toBe("98");
    expect(scientific("2^3^2=").display).toBe("512");
    expect(scientific("10-4-3=").display).toBe("3");
    expect(scientific("(1+2=").display).toBe("3");
  });
  it("writes the expression above the result", () => {
    const s = scientific("2*(3+4)=");
    expect(s.expression).toBe("2 × (3 + 4) =");
    expect(scientific("2+").expression).toBe("2 +");
    expect(scientific("2+3").display).toBe("3");
  });
  it("replaces an operator typed after another", () => {
    expect(scientific("6+*2=").display).toBe("12");
  });
  it("starts again after a result unless an operator continues it", () => {
    expect(scientific("2+3=4").display).toBe("4");
    expect(scientific("2+3=*2=").display).toBe("10");
  });
  it("applies functions to the value shown", () => {
    expect(scientific("30s").display).toBe("0.5");
    expect(scientific("30s").expression).toBe("sin(30)");
    expect(scientific("180s").display).toBe("0");
    expect(scientific("9@+1=").display).toBe("4");
    expect(scientific("5!").display).toBe("120");
    expect(scientific("2", fn("sqr"), fn("sqr")).expression).toBe(
      "sqr(sqr(2))",
    );
    expect(scientific("0.1+0.2=").display).toBe("0.3");
  });
  it("uses the angle unit", () => {
    const rad = run(newCalculator(), [
      { type: "angle", angle: "rad" },
      "0",
      "o",
    ]);
    expect(shown(rad).display).toBe("1");
    expect(scientific("1", fn("atan")).display).toBe("45");
  });
  it("reports errors as Windows Calculator does", () => {
    expect(scientific("5/0=").display).toBe("Cannot divide by zero");
    expect(scientific("0/0=").display).toBe("Result is undefined");
    expect(scientific("90t").display).toBe("Invalid input");
    expect(scientific("-").display).toBe("0");
    expect(scientific("200!").display).toBe("Overflow");
    // A digit after an error starts again.
    expect(scientific("5/0=7").display).toBe("7");
  });
  it("types decimals and signs", () => {
    expect(scientific("3,5*2=").display).toBe("7");
    expect(scientific("1..5").display).toBe("1.5");
    expect(scientific("5", { type: "negate" }, "+", "2", "=").display).toBe(
      "-3",
    );
    expect(scientific("12", "Backspace").display).toBe("1");
  });
  it("formats large and small results", () => {
    expect(formatNumber(1e20)).toBe("1e+20");
    expect(formatNumber(123456789012345)).toBe("123456789012345");
    expect(formatNumber(1 / 3)).toBe("0.333333333333333");
  });
  it("keeps history and memory", () => {
    let c = run(newCalculator(), [...chars("2+3="), { type: "memoryStore" }]);
    c = run(c, [...chars("4="), { type: "memoryAdd", sign: 1 }]);
    expect(c.scientific.memory).toEqual([9]);
    expect(c.scientific.history.map((h) => h.expression)).toEqual([
      "4 =",
      "2 + 3 =",
    ]);
    c = perform(c, { type: "recall", index: 1 });
    expect(shown(c).display).toBe("5");
    c = run(c, ["*", { type: "memoryRecall" }, "="]);
    expect(shown(c).display).toBe("45");
  });
  it("pastes numbers and expressions", () => {
    const c = newCalculator();
    expect(pasteActions("1,234.5", c)?.length).toBe(6);
    expect(pasteActions("sin(3)", c)).toBeNull();
    const pasted = run(c, pasteActions(" 2 * (3 + 4) ", c)!);
    expect(shown(run(pasted, ["="])).display).toBe("14");
  });
  it("refuses a paste too long to type", () => {
    const c = newCalculator();
    expect(pasteActions("1+".repeat(400) + "1", c)?.length).toBe(801);
    expect(pasteActions("1+".repeat(100_000) + "1", c)).toBeNull();
  });
});

describe("Programmer", () => {
  it("types in the base and shows the value in every base", () => {
    const c = run(programmerAt(16), ["F", "F"]);
    expect(shown(c).display).toBe("FF");
    expect(shown(perform(c, { type: "base", base: 10 })).display).toBe("255");
    expect(shown(perform(c, { type: "base", base: 2 })).display).toBe(
      "11111111",
    );
    // Digits of another base are not keys.
    expect(keyAction("9", programmerAt(8))).toBeNull();
  });
  it("wraps to the word size in two's complement", () => {
    expect(shown(run(programmerAt(16, 8), chars("7F+1="))).display).toBe("80");
    expect(shown(run(programmerAt(10, 8), chars("127+1="))).display).toBe(
      "-128",
    );
    // A digit that would not fit is not taken.
    expect(shown(run(programmerAt(10, 8), chars("1289"))).display).toBe("12");
    const word = run(programmerAt(10, 32), chars("70000"));
    expect(shown(perform(word, { type: "bits", bits: 16 })).display).toBe(
      "4464",
    );
  });
  it("has integer division and bitwise operators with C's precedence", () => {
    expect(shown(run(programmerAt(10), chars("7/2="))).display).toBe("3");
    expect(shown(run(programmerAt(10), chars("-7%3="))).display).toBe("-1");
    expect(shown(run(programmerAt(10), chars("1|2&3="))).display).toBe("3");
    expect(shown(run(programmerAt(10), chars("1<4+1="))).display).toBe("32");
    expect(shown(run(programmerAt(10), chars("6^3="))).display).toBe("5");
    expect(shown(run(programmerAt(10), chars("5/0="))).display).toBe(
      "Cannot divide by zero",
    );
  });
  it("negates, nots and rotates within the word", () => {
    expect(shown(run(programmerAt(16, 8), ["0", "~"])).display).toBe("FF");
    expect(shown(run(programmerAt(10, 8), ["0", "~"])).display).toBe("-1");
    expect(
      shown(run(programmerAt(2, 8), [..."10000001", fn("rol")])).display,
    ).toBe("11");
    expect(shown(run(programmerAt(2, 8), ["1", fn("ror")])).display).toBe(
      "10000000",
    );
    expect(
      shown(run(programmerAt(10, 8), ["5", { type: "negate" }])).display,
    ).toBe("-5");
  });
  it("pastes with the base's prefix", () => {
    const c = programmerAt(16);
    expect(shown(run(c, pasteActions("0xff", c)!)).display).toBe("FF");
  });
  it("groups readout digits", () => {
    expect(grouped("11111111", 2)).toBe("1111 1111");
    expect(grouped("-1234567", 10)).toBe("-1,234,567");
    expect(grouped("1FFFF", 16)).toBe("1 FFFF");
  });
});
