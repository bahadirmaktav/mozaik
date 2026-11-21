import { CalcError, type Kind } from "./engine";

/** The Scientific mode's numbers: IEEE doubles shown to 15 significant digits. */
export type Angle = "deg" | "rad" | "grad";
const MAX_DIGITS = 32;

/** A result that is not a number is an error, as in Windows Calculator. */
function checked(value: number) {
  if (Number.isNaN(value)) throw new CalcError("Invalid input");
  if (!Number.isFinite(value)) throw new CalcError("Overflow");
  return value;
}

export function formatNumber(value: number): string {
  if (value === 0) return "0";
  const rounded = Number(value.toPrecision(15));
  if (rounded === 0) return "0";
  return Math.abs(rounded) >= 1e16 ? rounded.toExponential() : String(rounded);
}

function divide(a: number, b: number) {
  if (b === 0)
    throw new CalcError(
      a === 0 ? "Result is undefined" : "Cannot divide by zero",
    );
  return checked(a / b);
}
function power(a: number, b: number) {
  if (a === 0 && b < 0) throw new CalcError("Cannot divide by zero");
  // A negative base takes whole powers only; its odd roots are `yroot`.
  if (a < 0 && !Number.isInteger(b)) throw new CalcError("Invalid input");
  return checked(Math.pow(a, b));
}
function root(a: number, n: number) {
  if (n === 0) throw new CalcError("Invalid input");
  if (a < 0) {
    if (Number.isInteger(n) && Math.abs(n) % 2 === 1)
      return checked(-Math.pow(-a, 1 / n));
    throw new CalcError("Invalid input");
  }
  return checked(Math.pow(a, 1 / n));
}
function logBase(a: number, base: number) {
  if (a <= 0 || base <= 0 || base === 1) throw new CalcError("Invalid input");
  return checked(Math.log(a) / Math.log(base));
}

export const scientific: Kind<number> = {
  zero: 0,
  binary: {
    "+": { symbol: "+", precedence: 1, apply: (a, b) => checked(a + b) },
    "-": { symbol: "−", precedence: 1, apply: (a, b) => checked(a - b) },
    "*": { symbol: "×", precedence: 2, apply: (a, b) => checked(a * b) },
    "/": { symbol: "÷", precedence: 2, apply: divide },
    mod: {
      symbol: "mod",
      precedence: 2,
      apply: (a, b) => {
        if (b === 0) throw new CalcError("Cannot divide by zero");
        return checked(a % b);
      },
    },
    "^": { symbol: "^", precedence: 3, right: true, apply: power },
    yroot: { symbol: "yroot", precedence: 3, right: true, apply: root },
    logbase: { symbol: "log base", precedence: 3, apply: logBase },
  },
  parse: (entry) => Number(entry),
  format: formatNumber,
  type(entry, digit) {
    if (digit === ".") {
      if (entry === null) return "0.";
      return entry.includes(".") ? null : `${entry}.`;
    }
    if (!/^\d$/.test(digit)) return null;
    if (entry === null || entry === "0") return digit;
    if (entry === "-0") return `-${digit}`;
    if (entry.replace(/\D/g, "").length >= MAX_DIGITS) return null;
    return entry + digit;
  },
  negateEntry: (entry) =>
    entry.startsWith("-") ? entry.slice(1) : `-${entry}`,
  negate: (value) => -value,
};

const toRadians = (x: number, angle: Angle) =>
  angle === "deg"
    ? x * (Math.PI / 180)
    : angle === "grad"
      ? x * (Math.PI / 200)
      : x;
const fromRadians = (x: number, angle: Angle) =>
  angle === "deg"
    ? x * (180 / Math.PI)
    : angle === "grad"
      ? x * (200 / Math.PI)
      : x;
/** A turn in the angle unit, so sin 180° is 0 and tan 90° is undefined. */
const TURN: Record<Angle, number> = { deg: 360, rad: 2 * Math.PI, grad: 400 };
const tiny = (x: number) => (Math.abs(x) < 1e-15 ? 0 : x);

function trig(name: "sin" | "cos" | "tan", x: number, angle: Angle) {
  const turn = TURN[angle];
  const reduced = angle === "rad" ? x : x % turn;
  if (
    name === "tan" &&
    angle !== "rad" &&
    Math.abs(reduced % (turn / 2)) === turn / 4
  )
    throw new CalcError("Invalid input");
  return checked(tiny(Math[name](toRadians(reduced, angle))));
}

/** Γ(x) by Lanczos' approximation, for the factorial of a non-integer. */
function gamma(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  x -= 1;
  let sum = c[0];
  for (let i = 1; i < g + 2; i++) sum += c[i] / (x + i);
  const t = x + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * sum;
}
export function factorial(x: number) {
  if (Number.isInteger(x)) {
    if (x < 0) throw new CalcError("Invalid input");
    if (x > 170) throw new CalcError("Overflow");
    let result = 1;
    for (let i = 2; i <= x; i++) result *= i;
    return result;
  }
  return checked(gamma(x + 1));
}

export interface Fn {
  /** How the expression line writes it around its argument. */
  label: (text: string) => string;
  apply: (x: number, angle: Angle) => number;
}
const named = (name: string) => (text: string) => `${name}(${text})`;
const positive = (x: number) => {
  if (x <= 0) throw new CalcError("Invalid input");
  return x;
};
export const functions: Record<string, Fn> = {
  sqr: { label: named("sqr"), apply: (x) => checked(x * x) },
  cube: { label: named("cube"), apply: (x) => checked(x * x * x) },
  sqrt: {
    label: named("√"),
    apply: (x) => {
      if (x < 0) throw new CalcError("Invalid input");
      return Math.sqrt(x);
    },
  },
  cbrt: { label: named("cuberoot"), apply: (x) => Math.cbrt(x) },
  recip: { label: named("1/"), apply: (x) => divide(1, x) },
  abs: { label: named("abs"), apply: (x) => Math.abs(x) },
  floor: { label: named("floor"), apply: (x) => Math.floor(x) },
  ceil: { label: named("ceil"), apply: (x) => Math.ceil(x) },
  pow10: { label: named("10^"), apply: (x) => checked(Math.pow(10, x)) },
  pow2: { label: named("2^"), apply: (x) => checked(Math.pow(2, x)) },
  exp: { label: named("e^"), apply: (x) => checked(Math.exp(x)) },
  log: { label: named("log"), apply: (x) => Math.log10(positive(x)) },
  ln: { label: named("ln"), apply: (x) => Math.log(positive(x)) },
  fact: { label: named("fact"), apply: factorial },
  sin: { label: named("sin"), apply: (x, a) => trig("sin", x, a) },
  cos: { label: named("cos"), apply: (x, a) => trig("cos", x, a) },
  tan: { label: named("tan"), apply: (x, a) => trig("tan", x, a) },
  asin: {
    label: named("sin⁻¹"),
    apply: (x, a) => checked(fromRadians(Math.asin(x), a)),
  },
  acos: {
    label: named("cos⁻¹"),
    apply: (x, a) => checked(fromRadians(Math.acos(x), a)),
  },
  atan: {
    label: named("tan⁻¹"),
    apply: (x, a) => checked(fromRadians(Math.atan(x), a)),
  },
  sinh: { label: named("sinh"), apply: (x) => checked(Math.sinh(x)) },
  cosh: { label: named("cosh"), apply: (x) => checked(Math.cosh(x)) },
  tanh: { label: named("tanh"), apply: (x) => checked(Math.tanh(x)) },
  asinh: { label: named("sinh⁻¹"), apply: (x) => checked(Math.asinh(x)) },
  acosh: { label: named("cosh⁻¹"), apply: (x) => checked(Math.acosh(x)) },
  atanh: { label: named("tanh⁻¹"), apply: (x) => checked(Math.atanh(x)) },
};
export const constants: Record<string, { value: number; text: string }> = {
  pi: { value: Math.PI, text: "π" },
  e: { value: Math.E, text: "e" },
};
