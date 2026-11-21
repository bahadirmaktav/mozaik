import { CalcError, type Binary, type Kind } from "./engine";

/**
 * The Programmer mode's numbers: integers of a word size, held as signed two's complement
 * `bigint`s, as Windows Calculator does. DEC shows them signed; HEX, OCT and BIN show their
 * bits.
 */
export type Bits = 64 | 32 | 16 | 8;
export type Base = 16 | 10 | 8 | 2;
export const WORDS: [Bits, string][] = [
  [64, "QWORD"],
  [32, "DWORD"],
  [16, "WORD"],
  [8, "BYTE"],
];
export const BASES: [Base, string][] = [
  [16, "HEX"],
  [10, "DEC"],
  [8, "OCT"],
  [2, "BIN"],
];
const PREFIX: Record<Base, string> = { 16: "0x", 10: "", 8: "0o", 2: "0b" };
const DIGITS = "0123456789ABCDEF";

export const wrap = (value: bigint, bits: Bits) => BigInt.asIntN(bits, value);
export const unsigned = (value: bigint, bits: Bits) =>
  BigInt.asUintN(bits, value);
/** Whether a digit can be typed in the base. */
export const isDigit = (digit: string, base: Base) =>
  digit.length === 1 && DIGITS.slice(0, base).includes(digit.toUpperCase());

export function formatIn(value: bigint, bits: Bits, base: Base) {
  return base === 10
    ? wrap(value, bits).toString()
    : unsigned(value, bits).toString(base).toUpperCase();
}
/** Digits in groups, for the base readouts: 4 in HEX and BIN, 3 in OCT and DEC. */
export function grouped(text: string, base: Base) {
  const size = base === 16 || base === 2 ? 4 : 3;
  const sign = text.startsWith("-") ? "-" : "";
  const digits = text.slice(sign.length);
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= size)
    groups.unshift(digits.slice(Math.max(0, end - size), end));
  return sign + groups.join(base === 10 ? "," : " ");
}

function shift(bits: Bits, left: boolean) {
  return (a: bigint, b: bigint) => {
    if (b < 0n) throw new CalcError("Invalid input");
    const count = b > BigInt(bits) ? BigInt(bits) : b;
    return wrap(left ? a << count : a >> count, bits);
  };
}
function binary(bits: Bits): Record<string, Binary<bigint>> {
  const w = (value: bigint) => wrap(value, bits);
  const divisor = (b: bigint) => {
    if (b === 0n) throw new CalcError("Cannot divide by zero");
    return b;
  };
  return {
    or: { symbol: "OR", precedence: 1, apply: (a, b) => w(a | b) },
    nor: { symbol: "NOR", precedence: 1, apply: (a, b) => w(~(a | b)) },
    xor: { symbol: "XOR", precedence: 2, apply: (a, b) => w(a ^ b) },
    and: { symbol: "AND", precedence: 3, apply: (a, b) => w(a & b) },
    nand: { symbol: "NAND", precedence: 3, apply: (a, b) => w(~(a & b)) },
    lsh: { symbol: "<<", precedence: 4, apply: shift(bits, true) },
    rsh: { symbol: ">>", precedence: 4, apply: shift(bits, false) },
    "+": { symbol: "+", precedence: 5, apply: (a, b) => w(a + b) },
    "-": { symbol: "−", precedence: 5, apply: (a, b) => w(a - b) },
    "*": { symbol: "×", precedence: 6, apply: (a, b) => w(a * b) },
    "/": { symbol: "÷", precedence: 6, apply: (a, b) => w(a / divisor(b)) },
    mod: { symbol: "%", precedence: 6, apply: (a, b) => w(a % divisor(b)) },
  };
}

const kinds = new Map<string, Kind<bigint>>();
/** The numbers of a word size, typed and shown in a base. */
export function programmer(bits: Bits, base: Base): Kind<bigint> {
  const key = `${bits}:${base}`;
  let kind = kinds.get(key);
  if (kind) return kind;
  const min = -(1n << BigInt(bits - 1));
  const max = (1n << BigInt(bits - 1)) - 1n;
  const parse = (entry: string) =>
    base === 10
      ? wrap(BigInt(entry === "-" ? "0" : entry), bits)
      : wrap(BigInt(PREFIX[base] + entry), bits);
  kind = {
    zero: 0n,
    binary: binary(bits),
    parse,
    format: (value) => formatIn(value, bits, base),
    type(entry, digit) {
      if (!isDigit(digit, base)) return null;
      const d = digit.toUpperCase();
      const next =
        entry === null || entry === "0"
          ? d
          : entry === "-0"
            ? `-${d}`
            : entry + d;
      // A digit that would not fit in the word is not taken.
      if (base === 10) {
        const value = BigInt(next);
        return value < min || value > max ? null : next;
      }
      return BigInt(PREFIX[base] + next) >> BigInt(bits) ? null : next;
    },
    negateEntry: (entry) => formatIn(-parse(entry), bits, base),
    negate: (value) => wrap(-value, bits),
  };
  kinds.set(key, kind);
  return kind;
}

export interface BitFn {
  label: (text: string) => string;
  apply: (x: bigint, bits: Bits) => bigint;
}
export const bitFunctions: Record<string, BitFn> = {
  not: { label: (t) => `NOT(${t})`, apply: (x, bits) => wrap(~x, bits) },
  rol: {
    label: (t) => `RoL(${t})`,
    apply(x, bits) {
      const u = unsigned(x, bits);
      return wrap((u << 1n) | (u >> BigInt(bits - 1)), bits);
    },
  },
  ror: {
    label: (t) => `RoR(${t})`,
    apply(x, bits) {
      const u = unsigned(x, bits);
      return wrap((u >> 1n) | ((u & 1n) << BigInt(bits - 1)), bits);
    },
  },
};
