import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import type { ViewProps } from "../contract";
import { keysOf, matches } from "../../workspace/keybindings";
import { useCommands } from "../../workspace/commands";
import { Menu } from "../../components/Menu";
import { MenuIcon } from "../../components/Icons";
import { act, useCalculator } from "./store";
import { shown, type Action, type Calculator, type Mode } from "./model";
import { keyAction, pasteActions } from "./keys";
import { formatNumber, type Angle } from "./scientific";
import {
  BASES,
  WORDS,
  formatIn,
  grouped,
  isDigit,
  type Base,
} from "./programmer";

interface Key {
  label: string;
  /** The accessible name when the label is a symbol. */
  name?: string;
  action: Action;
  style?: "digit" | "op" | "equals";
  pressed?: boolean;
  disabled?: boolean;
  tall?: boolean;
  wide?: boolean;
}
const op = (label: string, value: string, name?: string): Key => ({
  label,
  name,
  action: { type: "op", op: value },
  style: "op",
});
const fn = (label: string, name: string, title?: string): Key => ({
  label,
  name: title,
  action: { type: "fn", name },
});
const digit = (d: string, disabled = false): Key => ({
  label: d,
  action: { type: "digit", digit: d },
  style: "digit",
  disabled,
});
const plain = (label: string, action: Action, name?: string): Key => ({
  label,
  action,
  name,
});
const MODES: Record<Mode, string> = {
  scientific: "Scientific",
  programmer: "Programmer",
};
const ANGLES: [Angle, string][] = [
  ["deg", "DEG"],
  ["rad", "RAD"],
  ["grad", "GRAD"],
];
const next = <T,>(list: [T, string][], value: T) =>
  list[(list.findIndex(([v]) => v === value) + 1) % list.length][0];

function scientificKeys(c: Calculator): Key[] {
  const second = c.second;
  const trig = (name: "sin" | "cos" | "tan") => {
    const full = `${second ? "a" : ""}${name}${c.hyperbolic ? "h" : ""}`;
    const label = `${name}${c.hyperbolic ? "h" : ""}${second ? "⁻¹" : ""}`;
    return fn(label, full);
  };
  return [
    {
      ...plain("2nd", { type: "second" }, "Second functions"),
      pressed: second,
    },
    {
      ...plain("hyp", { type: "hyperbolic" }, "Hyperbolic functions"),
      pressed: c.hyperbolic,
    },
    plain("π", { type: "constant", name: "pi" }, "Pi"),
    plain("e", { type: "constant", name: "e" }, "Euler's number"),
    plain("CE", { type: "clearEntry" }, "Clear entry"),
    trig("sin"),
    trig("cos"),
    trig("tan"),
    plain("C", { type: "clear" }, "Clear"),
    plain("⌫", { type: "backspace" }, "Backspace"),
    second ? fn("x³", "cube", "Cube") : fn("x²", "sqr", "Square"),
    fn("1/x", "recip", "Reciprocal"),
    fn("|x|", "abs", "Absolute value"),
    second ? fn("⌈x⌉", "ceil", "Ceiling") : fn("⌊x⌋", "floor", "Floor"),
    op("mod", "mod", "Modulo"),
    second ? fn("∛x", "cbrt", "Cube root") : fn("√x", "sqrt", "Square root"),
    plain("(", { type: "open" }, "Open parenthesis"),
    plain(")", { type: "close" }, "Close parenthesis"),
    fn("n!", "fact", "Factorial"),
    op("÷", "/", "Divide"),
    second ? op("ʸ√x", "yroot", "Y root of x") : op("xʸ", "^", "Power"),
    digit("7"),
    digit("8"),
    digit("9"),
    op("×", "*", "Multiply"),
    second
      ? fn("2ˣ", "pow2", "Two to the power")
      : fn("10ˣ", "pow10", "Ten to the power"),
    digit("4"),
    digit("5"),
    digit("6"),
    op("−", "-", "Minus"),
    second
      ? op("logᵧx", "logbase", "Log base y")
      : fn("log", "log", "Logarithm"),
    digit("1"),
    digit("2"),
    digit("3"),
    op("+", "+", "Plus"),
    second
      ? fn("eˣ", "exp", "E to the power")
      : fn("ln", "ln", "Natural logarithm"),
    plain("±", { type: "negate" }, "Negate"),
    digit("0"),
    { ...digit("."), name: "Decimal point" },
    { ...plain("=", { type: "equals" }, "Equals"), style: "equals" },
  ];
}
function programmerKeys(c: Calculator): Key[] {
  const d = (x: string) => digit(x, !isDigit(x, c.base));
  return [
    op("AND", "and"),
    op("OR", "or"),
    op("XOR", "xor"),
    op("NAND", "nand"),
    op("NOR", "nor"),
    fn("NOT", "not"),
    fn("RoL", "rol", "Rotate left"),
    fn("RoR", "ror", "Rotate right"),
    plain("CE", { type: "clearEntry" }, "Clear entry"),
    plain("C", { type: "clear" }, "Clear"),
    d("A"),
    op("<<", "lsh", "Shift left"),
    op(">>", "rsh", "Shift right"),
    plain("⌫", { type: "backspace" }, "Backspace"),
    op("÷", "/", "Divide"),
    d("B"),
    plain("(", { type: "open" }, "Open parenthesis"),
    plain(")", { type: "close" }, "Close parenthesis"),
    op("%", "mod", "Modulo"),
    op("×", "*", "Multiply"),
    d("C"),
    d("7"),
    d("8"),
    d("9"),
    op("−", "-", "Minus"),
    d("D"),
    d("4"),
    d("5"),
    d("6"),
    op("+", "+", "Plus"),
    d("E"),
    d("1"),
    d("2"),
    d("3"),
    {
      ...plain("=", { type: "equals" }, "Equals"),
      style: "equals",
      tall: true,
    },
    d("F"),
    plain("±", { type: "negate" }, "Negate"),
    { ...d("0"), wide: true },
  ];
}

export default function CalculatorView({ instanceId, focused }: ViewProps) {
  const c = useCalculator(instanceId);
  const root = useRef<HTMLDivElement>(null);
  const [list, setList] = useState<"history" | "memory">("history");
  // In a narrow panel the history or memory list covers the keys while open.
  const [listOpen, setListOpen] = useState(false);
  const [modeMenu, setModeMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const commands = useCommands("Calculator", instanceId, focused);
  const { expression, display, value, error } = shown(c);
  const session = c.mode === "programmer" ? c.programmer : c.scientific;
  const run = (...actions: Action[]) => act(instanceId, ...actions);
  const setMode = (mode: Mode) => run({ type: "mode", mode });

  useEffect(() => {
    if (focused && !root.current?.contains(document.activeElement))
      root.current?.focus();
  }, [focused]);

  const copy = () =>
    void navigator.clipboard.writeText(display).catch(() => {});
  const paste = () =>
    void navigator.clipboard
      .readText()
      .then((text) => {
        const actions = pasteActions(text, c);
        if (actions) run({ type: "clearEntry" }, ...actions);
      })
      .catch(() => {});
  commands.current = [
    {
      label: "Scientific",
      shortcut: keysOf("calculator.scientific"),
      checked: c.mode === "scientific",
      action: () => setMode("scientific"),
    },
    {
      label: "Programmer",
      shortcut: keysOf("calculator.programmer"),
      checked: c.mode === "programmer",
      action: () => setMode("programmer"),
    },
    {
      label: "Copy Result",
      shortcut: keysOf("calculator.copy"),
      action: copy,
    },
    {
      label: "Paste",
      shortcut: keysOf("calculator.paste"),
      action: paste,
    },
    {
      label: "Clear History",
      disabled: !session.history.length,
      action: () => run({ type: "clearHistory" }),
    },
    {
      label: "Clear Memory",
      disabled: !session.memory.length,
      action: () => run({ type: "memoryClear" }),
    },
  ];

  function onKeyDown(event: KeyboardEvent) {
    const bases: [string, Base][] = [
      ["calculator.hex", 16],
      ["calculator.dec", 10],
      ["calculator.oct", 8],
      ["calculator.bin", 2],
    ];
    let action: (() => void) | null = null;
    if (matches(event.nativeEvent, "calculator.copy")) action = copy;
    else if (matches(event.nativeEvent, "calculator.paste")) action = paste;
    else if (matches(event.nativeEvent, "calculator.scientific"))
      action = () => setMode("scientific");
    else if (matches(event.nativeEvent, "calculator.programmer"))
      action = () => setMode("programmer");
    else if (matches(event.nativeEvent, "calculator.negate"))
      action = () => run({ type: "negate" });
    else if (c.mode === "programmer") {
      const base = bases.find(([id]) => matches(event.nativeEvent, id));
      if (base) action = () => run({ type: "base", base: base[1] });
    }
    if (!action && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const typed = keyAction(event.key, c);
      if (typed) action = () => run(typed);
    }
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  const keys = c.mode === "programmer" ? programmerKeys(c) : scientificKeys(c);
  const format = (v: number | bigint) =>
    typeof v === "bigint" ? formatIn(v, c.bits, c.base) : formatNumber(v);
  const length = Math.max(display.length, 10);
  return (
    <div
      className="calculator"
      ref={root}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // A click keeps the focus on the panel, so Enter stays `=` and not the clicked key.
      onMouseDown={(event) => {
        event.preventDefault();
        root.current?.focus();
      }}
      data-mode={c.mode}
    >
      <div className="calc-main">
        <div className="calc-bar">
          {/* As in Windows' Calculator: the mode's name, chosen from a menu button. */}
          <button
            type="button"
            className="calc-mode-button"
            aria-label="Mode"
            title="Mode"
            aria-haspopup="menu"
            aria-expanded={!!modeMenu}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setModeMenu(
                modeMenu ? null : { x: rect.left, y: rect.bottom + 2 },
              );
            }}
          >
            <MenuIcon />
          </button>
          <h2 className="calc-mode-name">{MODES[c.mode]}</h2>
          {c.mode === "scientific" ? (
            <button
              type="button"
              className="calc-setting"
              title="Angle unit"
              aria-label={`Angle unit: ${ANGLES.find(([a]) => a === c.angle)![1]}`}
              onClick={() =>
                run({ type: "angle", angle: next(ANGLES, c.angle) })
              }
            >
              {ANGLES.find(([a]) => a === c.angle)![1]}
            </button>
          ) : (
            <button
              type="button"
              className="calc-setting"
              title="Word size"
              aria-label={`Word size: ${WORDS.find(([b]) => b === c.bits)![1]}`}
              onClick={() => run({ type: "bits", bits: next(WORDS, c.bits) })}
            >
              {WORDS.find(([b]) => b === c.bits)![1]}
            </button>
          )}
          <button
            type="button"
            className="calc-setting calc-list-toggle"
            aria-pressed={listOpen}
            onClick={() => setListOpen((open) => !open)}
          >
            History
          </button>
        </div>
        <div className="calc-display" aria-live="polite">
          <div className="calc-expression" title={expression}>
            {/* Left to right inside the right-to-left box, which only puts the ellipsis
                on the left of a long expression. */}
            <span dir="ltr">{expression || " "}</span>
          </div>
          <output
            className="calc-value"
            data-error={error !== null || undefined}
            aria-label="Result"
            style={{ "--calc-length": length } as CSSProperties}
          >
            {display}
          </output>
        </div>
        {c.mode === "programmer" && (
          <div className="calc-bases" role="group" aria-label="Base">
            {BASES.map(([base, label]) => (
              <button
                key={base}
                type="button"
                aria-pressed={c.base === base}
                onClick={() => run({ type: "base", base })}
              >
                <span className="calc-base-name">{label}</span>
                <span className="calc-base-value">
                  {grouped(formatIn(value as bigint, c.bits, base), base)}
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="calc-memory" role="group" aria-label="Memory">
          {(
            [
              ["MC", { type: "memoryClear" }, "Memory clear"],
              ["MR", { type: "memoryRecall" }, "Memory recall"],
              ["M+", { type: "memoryAdd", sign: 1 }, "Memory add"],
              ["M−", { type: "memoryAdd", sign: -1 }, "Memory subtract"],
              ["MS", { type: "memoryStore" }, "Memory store"],
            ] as [string, Action, string][]
          ).map(([label, action, name]) => (
            <button
              key={label}
              type="button"
              aria-label={name}
              title={name}
              disabled={
                (label === "MC" || label === "MR") && !session.memory.length
              }
              onClick={() => run(action)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="calc-keys" data-mode={c.mode}>
          {keys.map((key, index) => (
            <button
              key={index}
              type="button"
              className="calc-key"
              data-style={key.style}
              data-tall={key.tall || undefined}
              data-wide={key.wide || undefined}
              aria-label={key.name}
              title={key.name}
              aria-pressed={key.pressed}
              disabled={key.disabled}
              onClick={() => run(key.action)}
            >
              {key.label}
            </button>
          ))}
        </div>
      </div>
      <aside className="calc-side" data-open={listOpen || undefined}>
        <div className="calc-side-tabs" role="tablist">
          {(
            [
              ["history", "History"],
              ["memory", "Memory"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={list === id}
              onClick={() => setList(id)}
            >
              {label}
            </button>
          ))}
        </div>
        {list === "history" ? (
          <ul className="calc-list" aria-label="History">
            {session.history.map((entry, index) => (
              <li key={session.history.length - index}>
                <button
                  type="button"
                  onClick={() => {
                    run({ type: "recall", index });
                    setListOpen(false);
                  }}
                >
                  <span className="calc-list-expression">
                    {entry.expression}
                  </span>
                  <span className="calc-list-value">
                    {format(entry.result)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="calc-list" aria-label="Memory">
            {session.memory.map((entry, index) => (
              <li key={session.memory.length - index}>
                <button
                  type="button"
                  onClick={() => {
                    run({ type: "memoryRecall", index });
                    setListOpen(false);
                  }}
                >
                  <span className="calc-list-value">{format(entry)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {(list === "history" ? session.history : session.memory).length ===
        0 ? (
          <p className="calc-empty">
            {list === "history" ? "No history yet" : "Nothing in memory"}
          </p>
        ) : (
          <button
            type="button"
            className="calc-setting calc-clear-list"
            onClick={() =>
              run(
                list === "history"
                  ? { type: "clearHistory" }
                  : { type: "memoryClear" },
              )
            }
          >
            Clear {list === "history" ? "history" : "memory"}
          </button>
        )}
      </aside>
      {modeMenu && (
        <Menu
          label="Mode"
          x={modeMenu.x}
          y={modeMenu.y}
          items={(Object.keys(MODES) as Mode[]).map((mode) => ({
            label: MODES[mode],
            shortcut: keysOf(`calculator.${mode}`),
            checked: c.mode === mode,
            action: () => setMode(mode),
          }))}
          onClose={() => {
            setModeMenu(null);
            root.current?.focus();
          }}
        />
      )}
    </div>
  );
}
