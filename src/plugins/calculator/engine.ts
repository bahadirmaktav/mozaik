/**
 * The calculator's expression engine, shared by the Scientific (`number`) and Programmer
 * (`bigint`) modes. It never evaluates text as code: keys build a list of values, operators
 * and open parentheses, which `evaluate` reduces with operator precedence. A closed group
 * becomes one value at once, so the list never holds a closing parenthesis, and groups still
 * open at `=` close there, as in Windows Calculator.
 */
export class CalcError extends Error {}

/** A value in the expression; `text` shows how it was made (`sin(30)`), else the value. */
export interface Operand<T> {
  value: T;
  text: string | null;
}
export type Item<T> =
  | { kind: "value"; operand: Operand<T> }
  | { kind: "op"; op: string }
  | { kind: "open" };
export interface Binary<T> {
  symbol: string;
  precedence: number;
  right?: boolean;
  apply(a: T, b: T): T;
}
/** What a mode's numbers are: their operators, and how entries are typed and shown. */
export interface Kind<T> {
  zero: T;
  binary: Record<string, Binary<T>>;
  /** The value of a typed entry. */
  parse(entry: string): T;
  /** A value as the display shows it. */
  format(value: T): string;
  /** The entry with a digit (or `.`) added, or null when it cannot take it. */
  type(entry: string | null, digit: string): string | null;
  /** The entry with its sign changed, still typeable. */
  negateEntry(entry: string): string;
  negate(value: T): T;
}
export interface HistoryEntry<T> {
  expression: string;
  result: T;
}
export interface Session<T> {
  items: Item<T>[];
  /** Digits being typed. */
  entry: string | null;
  /** A value not typed: a result, a function of a value, a closed group, a recalled one. */
  current: Operand<T> | null;
  /** The finished expression shown above its result (`2 + 3 =`). */
  done: string | null;
  error: string | null;
  /** Newest first. */
  history: HistoryEntry<T>[];
  /** Newest first. */
  memory: T[];
}
const HISTORY_LIMIT = 100;

export function emptySession<T>(): Session<T> {
  return {
    items: [],
    entry: null,
    current: null,
    done: null,
    error: null,
    history: [],
    memory: [],
  };
}

/** Reduces values, operators and open parentheses (closed at the end) to one value. */
export function evaluate<T>(items: Item<T>[], kind: Kind<T>): T {
  const values: T[] = [];
  const ops: (string | null)[] = [];
  const reduce = () => {
    const op = ops.pop()!;
    const b = values.pop()!;
    const a = values.pop()!;
    values.push(kind.binary[op].apply(a, b));
  };
  for (const item of items) {
    if (item.kind === "value") values.push(item.operand.value);
    else if (item.kind === "open") ops.push(null);
    else {
      const next = kind.binary[item.op];
      for (;;) {
        const top = ops[ops.length - 1];
        if (top === undefined || top === null) break;
        const previous = kind.binary[top].precedence;
        if (
          previous > next.precedence ||
          (previous === next.precedence && !next.right)
        )
          reduce();
        else break;
      }
      ops.push(item.op);
    }
  }
  while (ops.length) {
    if (ops[ops.length - 1] === null) ops.pop();
    else reduce();
  }
  if (values.length !== 1) throw new CalcError("Invalid input");
  return values[0];
}

export const operandText = <T>(operand: Operand<T>, kind: Kind<T>) =>
  operand.text ?? kind.format(operand.value);

export function render<T>(items: Item<T>[], kind: Kind<T>) {
  return items
    .map((item) =>
      item.kind === "value"
        ? operandText(item.operand, kind)
        : item.kind === "open"
          ? "("
          : kind.binary[item.op].symbol,
    )
    .join(" ")
    .replace(/\( /g, "(");
}

const opens = <T>(items: Item<T>[]) =>
  items.filter((item) => item.kind === "open").length;
const lastValue = <T>(items: Item<T>[]) => {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "value") return item.operand;
  }
  return null;
};
/** The value being typed or made, if there is one. */
function pending<T>(s: Session<T>, kind: Kind<T>): Operand<T> | null {
  if (s.entry !== null) return { value: kind.parse(s.entry), text: null };
  return s.current;
}
/** After `=` a new number starts a new expression. */
const started = <T>(s: Session<T>): Session<T> =>
  s.error !== null || s.done !== null
    ? { ...s, items: [], entry: null, current: null, done: null, error: null }
    : s;
function failed<T>(s: Session<T>, error: unknown, done: string | null) {
  if (!(error instanceof CalcError)) throw error;
  return {
    ...s,
    items: [],
    entry: null,
    current: null,
    done,
    error: error.message,
  };
}

/** The value the display shows. */
export function shownValue<T>(s: Session<T>, kind: Kind<T>): T {
  return (pending(s, kind) ?? lastValue(s.items))?.value ?? kind.zero;
}
/** The large line: the error, the entry as typed, or the value. */
export function display<T>(s: Session<T>, kind: Kind<T>) {
  if (s.error !== null) return s.error;
  if (s.entry !== null) return s.entry;
  return kind.format(shownValue(s, kind));
}
/** The small line above it: the expression so far, or the finished one. */
export function expression<T>(s: Session<T>, kind: Kind<T>) {
  if (s.done !== null) return s.done;
  const tail = s.current?.text;
  return [render(s.items, kind), tail].filter(Boolean).join(" ");
}

export function digit<T>(s: Session<T>, kind: Kind<T>, d: string): Session<T> {
  s = started(s);
  const entry = kind.type(s.entry, d);
  return entry === null ? s : { ...s, entry, current: null };
}

export function operator<T>(
  s: Session<T>,
  kind: Kind<T>,
  op: string,
): Session<T> {
  if (s.error !== null) return s;
  s = { ...s, done: null };
  const value = pending(s, kind);
  const last = s.items[s.items.length - 1];
  if (value)
    return {
      ...s,
      items: [
        ...s.items,
        { kind: "value", operand: value },
        { kind: "op", op },
      ],
      entry: null,
      current: null,
    };
  if (last?.kind === "op")
    return { ...s, items: [...s.items.slice(0, -1), { kind: "op", op }] };
  return {
    ...s,
    items: [
      ...s.items,
      { kind: "value", operand: { value: kind.zero, text: null } },
      { kind: "op", op },
    ],
  };
}

export function open<T>(s: Session<T>, kind: Kind<T>): Session<T> {
  s = started(s);
  const value = pending(s, kind);
  // A number right before `(` multiplies it, as written in algebra.
  const before: Item<T>[] =
    value && kind.binary["*"]
      ? [
          { kind: "value", operand: value },
          { kind: "op", op: "*" },
        ]
      : [];
  return {
    ...s,
    items: [...s.items, ...before, { kind: "open" }],
    entry: null,
    current: null,
  };
}

export function close<T>(s: Session<T>, kind: Kind<T>): Session<T> {
  if (s.error !== null || !opens(s.items)) return s;
  const last = s.items[s.items.length - 1];
  const value =
    pending(s, kind) ??
    (last?.kind === "op"
      ? lastValue(s.items)!
      : { value: kind.zero, text: null });
  const start = s.items.map((item) => item.kind).lastIndexOf("open");
  const group: Item<T>[] = [
    ...s.items.slice(start + 1),
    { kind: "value", operand: value },
  ];
  const text = `(${render(group, kind)})`;
  try {
    return {
      ...s,
      items: s.items.slice(0, start),
      entry: null,
      current: { value: evaluate(group, kind), text },
    };
  } catch (error) {
    return failed(s, error, `${render(s.items.slice(0, start), kind)} ${text}`);
  }
}

export function equals<T>(s: Session<T>, kind: Kind<T>): Session<T> {
  if (s.error !== null) return s;
  if (s.done !== null && s.entry === null) return s;
  const last = s.items[s.items.length - 1];
  const value = pending(s, kind) ??
    (last?.kind === "op" ? lastValue(s.items) : null) ?? {
      value: kind.zero,
      text: null,
    };
  const items: Item<T>[] = [...s.items, { kind: "value", operand: value }];
  const text = `${render(items, kind)}${")".repeat(opens(items))} =`;
  try {
    const result = evaluate(items, kind);
    return {
      ...s,
      items: [],
      entry: null,
      current: { value: result, text: null },
      done: text,
      history: [{ expression: text, result }, ...s.history].slice(
        0,
        HISTORY_LIMIT,
      ),
    };
  } catch (error) {
    return failed(s, error, text);
  }
}

/** A function of the shown value (`sin`, `NOT`), which replaces it. */
export function unary<T>(
  s: Session<T>,
  kind: Kind<T>,
  apply: (value: T) => T,
  label: (text: string) => string,
): Session<T> {
  if (s.error !== null) return s;
  const fresh = s.done !== null;
  const value = pending(s, kind) ??
    lastValue(s.items) ?? { value: kind.zero, text: null };
  const text = label(
    fresh ? kind.format(value.value) : operandText(value, kind),
  );
  try {
    return {
      ...s,
      done: null,
      entry: null,
      current: { value: apply(value.value), text },
    };
  } catch (error) {
    return failed(s, error, text);
  }
}

export function negate<T>(s: Session<T>, kind: Kind<T>): Session<T> {
  if (s.error !== null) return s;
  if (s.entry !== null) return { ...s, entry: kind.negateEntry(s.entry) };
  return unary(s, kind, kind.negate, (text) => `negate(${text})`);
}

/** A value that replaces the entry (π, a recalled memory or result). */
export function place<T>(s: Session<T>, operand: Operand<T>): Session<T> {
  s = started(s);
  return { ...s, entry: null, current: operand };
}

export function clearEntry<T>(s: Session<T>): Session<T> {
  if (s.error !== null || s.done !== null) return clear(s);
  return { ...s, entry: null, current: null };
}
export function clear<T>(s: Session<T>): Session<T> {
  return {
    ...s,
    items: [],
    entry: null,
    current: null,
    done: null,
    error: null,
  };
}
export function backspace<T>(s: Session<T>): Session<T> {
  if (s.error !== null) return clear(s);
  if (s.done !== null) return { ...s, done: null };
  if (s.entry === null) return s;
  const entry = s.entry.slice(0, -1);
  return { ...s, entry: entry === "" || entry === "-" ? null : entry };
}

export function memoryStore<T>(s: Session<T>, kind: Kind<T>): Session<T> {
  if (s.error !== null) return s;
  return { ...s, memory: [shownValue(s, kind), ...s.memory] };
}
export function memoryAdd<T>(
  s: Session<T>,
  kind: Kind<T>,
  sign: 1 | -1,
): Session<T> {
  if (s.error !== null) return s;
  const value = shownValue(s, kind);
  const [top, ...rest] = s.memory.length ? s.memory : [kind.zero];
  try {
    const next = kind.binary[sign === 1 ? "+" : "-"].apply(top, value);
    return { ...s, memory: [next, ...rest] };
  } catch (error) {
    return failed(s, error, null);
  }
}
export function memoryRecall<T>(s: Session<T>, index = 0): Session<T> {
  const value = s.memory[index];
  return value === undefined ? s : place(s, { value, text: null });
}
export function memoryClear<T>(s: Session<T>, index?: number): Session<T> {
  return {
    ...s,
    memory: index === undefined ? [] : s.memory.filter((_, i) => i !== index),
  };
}
/** Shows an earlier calculation and its result again, to go on from. */
export function recall<T>(s: Session<T>, index: number): Session<T> {
  const entry = s.history[index];
  if (!entry) return s;
  return {
    ...clear(s),
    current: { value: entry.result, text: null },
    done: entry.expression,
  };
}

/** Values changed to another kind (a programmer word size), entry kept typeable. */
export function convert<T>(
  s: Session<T>,
  from: Kind<T>,
  to: Kind<T>,
  map: (value: T) => T,
): Session<T> {
  const operand = (o: Operand<T>): Operand<T> => ({
    value: map(o.value),
    text: o.text,
  });
  return {
    ...s,
    items: s.items.map((item) =>
      item.kind === "value"
        ? { ...item, operand: operand(item.operand) }
        : item,
    ),
    entry: s.entry === null ? null : to.format(map(from.parse(s.entry))),
    current: s.current && operand(s.current),
    history: s.history.map((h) => ({ ...h, result: map(h.result) })),
    memory: s.memory.map(map),
  };
}
