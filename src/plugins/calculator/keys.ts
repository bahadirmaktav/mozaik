import type { Action, Calculator } from "./model";
import { isDigit } from "./programmer";

/**
 * The keys that type into a calculator, as in Windows Calculator. They are characters, so
 * they follow the user's layout (a Turkish keyboard's `*` and `(` included); the decimal
 * comma of a numeric keypad is the decimal point. The rebindable keys (mode, base, sign,
 * copy, paste) are in `workspace/keybindings.ts`.
 */
const SCIENTIFIC: Record<string, Action> = {
  "^": { type: "op", op: "^" },
  y: { type: "op", op: "^" },
  "%": { type: "op", op: "mod" },
  "!": { type: "fn", name: "fact" },
  "@": { type: "fn", name: "sqrt" },
  q: { type: "fn", name: "sqr" },
  r: { type: "fn", name: "recip" },
  s: { type: "fn", name: "sin" },
  o: { type: "fn", name: "cos" },
  t: { type: "fn", name: "tan" },
  l: { type: "fn", name: "log" },
  n: { type: "fn", name: "ln" },
  p: { type: "constant", name: "pi" },
  ".": { type: "digit", digit: "." },
  ",": { type: "digit", digit: "." },
};
const PROGRAMMER: Record<string, Action> = {
  "%": { type: "op", op: "mod" },
  "&": { type: "op", op: "and" },
  "|": { type: "op", op: "or" },
  "^": { type: "op", op: "xor" },
  "~": { type: "fn", name: "not" },
  "<": { type: "op", op: "lsh" },
  ">": { type: "op", op: "rsh" },
};
const COMMON: Record<string, Action> = {
  "+": { type: "op", op: "+" },
  "-": { type: "op", op: "-" },
  "*": { type: "op", op: "*" },
  "/": { type: "op", op: "/" },
  "(": { type: "open" },
  ")": { type: "close" },
  "=": { type: "equals" },
  Enter: { type: "equals" },
  Escape: { type: "clear" },
  Delete: { type: "clearEntry" },
  Backspace: { type: "backspace" },
};

/** What a key typed without Ctrl, Alt or Meta does, or null to leave it alone. */
export function keyAction(key: string, c: Calculator): Action | null {
  if (c.mode === "programmer") {
    if (isDigit(key, c.base))
      return { type: "digit", digit: key.toUpperCase() };
    return PROGRAMMER[key] ?? COMMON[key] ?? null;
  }
  if (/^\d$/.test(key)) return { type: "digit", digit: key };
  const lower = key.length === 1 ? key.toLowerCase() : key;
  return SCIENTIFIC[lower] ?? COMMON[key] ?? null;
}

/**
 * Pasted text typed key by key, so a number or an expression (`2*(3+4)`) both work. Spaces,
 * digit separators and a `0x`/`0b`/`0o` prefix of the shown base are skipped; anything else
 * that is not a key stops the paste. Only the first line is pasted.
 */
export function pasteActions(text: string, c: Calculator): Action[] | null {
  let rest = text.trim().split(/\r?\n/)[0];
  // Of `1,234.5` the comma groups digits; alone (`3,5`) it is the decimal comma.
  if (c.mode === "scientific" && rest.includes("."))
    rest = rest.replace(/,/g, "");
  if (c.mode === "programmer") {
    const prefix = { 16: /^0x/i, 8: /^0o/i, 2: /^0b/i, 10: null }[c.base];
    if (prefix) rest = rest.replace(prefix, "");
  }
  const actions: Action[] = [];
  for (const char of rest.replace(/[\s_']/g, "")) {
    const action =
      c.mode === "scientific" && /[a-z]/i.test(char)
        ? null
        : keyAction(char, c);
    if (!action) return null;
    actions.push(action);
  }
  return actions.length ? actions : null;
}
