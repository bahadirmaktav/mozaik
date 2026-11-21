import * as engine from "./engine";
import type { Kind, Session } from "./engine";
import { constants, functions, scientific, type Angle } from "./scientific";
import {
  bitFunctions,
  programmer,
  wrap,
  type Base,
  type Bits,
} from "./programmer";

/** A calculator panel: both modes keep their own expression, history and memory. */
export type Mode = "scientific" | "programmer";
export interface Calculator {
  mode: Mode;
  angle: Angle;
  /** The second functions (x³, sin⁻¹…) are on the keys. */
  second: boolean;
  /** The trigonometry keys are hyperbolic. */
  hyperbolic: boolean;
  base: Base;
  bits: Bits;
  scientific: Session<number>;
  programmer: Session<bigint>;
}
export type Action =
  | { type: "digit"; digit: string }
  | { type: "op"; op: string }
  | { type: "open" }
  | { type: "close" }
  | { type: "equals" }
  | { type: "negate" }
  | { type: "fn"; name: string }
  | { type: "constant"; name: string }
  | { type: "clear" }
  | { type: "clearEntry" }
  | { type: "backspace" }
  | { type: "memoryStore" }
  | { type: "memoryAdd"; sign: 1 | -1 }
  | { type: "memoryRecall"; index?: number }
  | { type: "memoryClear"; index?: number }
  | { type: "recall"; index: number }
  | { type: "clearHistory" }
  | { type: "mode"; mode: Mode }
  | { type: "angle"; angle: Angle }
  | { type: "second" }
  | { type: "hyperbolic" }
  | { type: "base"; base: Base }
  | { type: "bits"; bits: Bits };

export function newCalculator(): Calculator {
  return {
    mode: "scientific",
    angle: "deg",
    second: false,
    hyperbolic: false,
    base: 10,
    bits: 64,
    scientific: engine.emptySession(),
    programmer: engine.emptySession(),
  };
}
export const kindOf = (c: Calculator) => programmer(c.bits, c.base);

/** What a key or button does to a mode's session; mode-specific steps are passed in. */
function step<T>(
  s: Session<T>,
  kind: Kind<T>,
  action: Action,
  fn: (s: Session<T>, name: string) => Session<T>,
  constant: (s: Session<T>, name: string) => Session<T>,
): Session<T> {
  switch (action.type) {
    case "digit":
      return engine.digit(s, kind, action.digit);
    case "op":
      return kind.binary[action.op] ? engine.operator(s, kind, action.op) : s;
    case "open":
      return engine.open(s, kind);
    case "close":
      return engine.close(s, kind);
    case "equals":
      return engine.equals(s, kind);
    case "negate":
      return engine.negate(s, kind);
    case "fn":
      return fn(s, action.name);
    case "constant":
      return constant(s, action.name);
    case "clear":
      return engine.clear(s);
    case "clearEntry":
      return engine.clearEntry(s);
    case "backspace":
      return engine.backspace(s);
    case "memoryStore":
      return engine.memoryStore(s, kind);
    case "memoryAdd":
      return engine.memoryAdd(s, kind, action.sign);
    case "memoryRecall":
      return engine.memoryRecall(s, action.index);
    case "memoryClear":
      return engine.memoryClear(s, action.index);
    case "recall":
      return engine.recall(s, action.index);
    case "clearHistory":
      return { ...s, history: [] };
  }
  return s;
}

export function perform(c: Calculator, action: Action): Calculator {
  switch (action.type) {
    case "mode":
      return { ...c, mode: action.mode };
    case "angle":
      return { ...c, angle: action.angle };
    case "second":
      return { ...c, second: !c.second };
    case "hyperbolic":
      return { ...c, hyperbolic: !c.hyperbolic };
    case "base":
      if (c.mode !== "programmer" || action.base === c.base) return c;
      return {
        ...c,
        base: action.base,
        programmer: engine.convert(
          c.programmer,
          kindOf(c),
          programmer(c.bits, action.base),
          (v) => v,
        ),
      };
    case "bits":
      if (c.mode !== "programmer" || action.bits === c.bits) return c;
      return {
        ...c,
        bits: action.bits,
        programmer: engine.convert(
          c.programmer,
          kindOf(c),
          programmer(action.bits, c.base),
          (v) => wrap(v, action.bits),
        ),
      };
  }
  if (c.mode === "programmer") {
    const kind = kindOf(c);
    const programmerSession = step(
      c.programmer,
      kind,
      action,
      (s, name) => {
        const f = bitFunctions[name];
        return f
          ? engine.unary(s, kind, (x) => f.apply(x, c.bits), f.label)
          : s;
      },
      (s) => s,
    );
    return { ...c, programmer: programmerSession };
  }
  const session = step(
    c.scientific,
    scientific,
    action,
    (s, name) => {
      const f = functions[name];
      return f
        ? engine.unary(s, scientific, (x) => f.apply(x, c.angle), f.label)
        : s;
    },
    (s, name) => {
      const k = constants[name];
      return k ? engine.place(s, { value: k.value, text: k.text }) : s;
    },
  );
  return { ...c, scientific: session };
}

/** The panel's two lines and the value behind them. */
export function shown(c: Calculator) {
  if (c.mode === "programmer") {
    const kind = kindOf(c);
    return {
      expression: engine.expression(c.programmer, kind),
      display: engine.display(c.programmer, kind),
      value: engine.shownValue(c.programmer, kind),
      error: c.programmer.error,
    };
  }
  return {
    expression: engine.expression(c.scientific, scientific),
    display: engine.display(c.scientific, scientific),
    value: engine.shownValue(c.scientific, scientific),
    error: c.scientific.error,
  };
}
