import { useEffect, useRef, useState } from "react";
import {
  ContinueIcon,
  GripIcon,
  PauseIcon,
  RestartIcon,
  StepIntoIcon,
  StepOutIcon,
  StepOverIcon,
  StopIcon,
} from "../../components/Icons";
import {
  continueDebugging,
  evaluateConsole,
  pauseDebugging,
  restartDebugging,
  stepInto,
  stepOut,
  stepOver,
  stopDebugging,
  useDebug,
} from "./debug";
import {
  keysOf,
  label as keyLabel,
  useKeybindings,
} from "../../workspace/keybindings";
import { host } from "./editors";

/**
 * The bottom panel's Debug Console: the program's output, the debugger's messages,
 * logpoints and expression results. Its history stays after a session until the next one starts or Clear.
 */
export function DebugConsole() {
  const { console: lines, session } = useDebug();
  const list = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [text, setText] = useState("");
  const follow = useRef(true);
  useEffect(() => {
    const element = list.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [lines]);
  return (
    <div className="debug-console">
      <div
        className="debug-console-lines"
        ref={list}
        role="log"
        aria-label="Debug Console"
        onScroll={(event) => {
          const el = event.currentTarget;
          follow.current =
            el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
        }}
      >
        {lines.map((line) => (
          <div key={line.id} className={`debug-console-line ${line.kind}`}>
            {line.kind === "input" ? `› ${line.text}` : line.text}
          </div>
        ))}
        {!lines.length && (
          <p className="muted">
            The program's output, debugger messages, logpoints and expression
            results appear here.
          </p>
        )}
      </div>
      <input
        className="debug-console-input"
        aria-label="Evaluate expression"
        placeholder={
          session?.state === "stopped"
            ? "Evaluate an expression in the selected frame"
            : "Expressions are evaluated while the program is paused"
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && text.trim()) {
            follow.current = true;
            setHistory([...history.filter((h) => h !== text), text]);
            setIndex(-1);
            setText("");
            void evaluateConsole(text);
          } else if (event.key === "ArrowUp" && history.length) {
            event.preventDefault();
            const next =
              index < 0 ? history.length - 1 : Math.max(index - 1, 0);
            setIndex(next);
            setText(history[next]);
          } else if (event.key === "ArrowDown" && index >= 0) {
            event.preventDefault();
            const next = index + 1;
            setIndex(next < history.length ? next : -1);
            setText(next < history.length ? history[next] : "");
          }
        }}
      />
    </div>
  );
}

/** Where the toolbar was moved to: its center as a share of the window's width, its top in
 * pixels, as VS Code keeps it. Kept in the WebView's local storage. */
const PLACE_KEY = "mozaik.debug.toolbar";
type Place = { x: number; y: number };
const DEFAULT_PLACE: Place = { x: 0.5, y: 30 };
function readPlace(): Place {
  try {
    const place = JSON.parse(localStorage.getItem(PLACE_KEY) ?? "null");
    if (
      place &&
      Number.isFinite(place.x) &&
      Number.isFinite(place.y) &&
      place.x >= 0 &&
      place.x <= 1 &&
      place.y >= 0
    )
      return { x: place.x, y: place.y };
  } catch {
    // An unreadable entry: the default place.
  }
  return DEFAULT_PLACE;
}
function savePlace(place: Place) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    // Storage refused: the place lasts until the window closes.
  }
}

/**
 * The small floating toolbar over the editors while a session runs, as in VS Code: moved by
 * its grip (double-click puts it back), its buttons with VS Code's keys (F5, F10, …).
 */
export function DebugToolbar() {
  const { session } = useDebug();
  useKeybindings();
  const [place, setPlace] = useState(readPlace);
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  // The window may have shrunk since: the toolbar stays inside it.
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  useEffect(() => {
    const resize = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  if (!session) return null;
  const width = bar.current?.offsetWidth ?? 200;
  const height = bar.current?.offsetHeight ?? 32;
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));
  const left = clamp(place.x * size.width, width / 2, size.width - width / 2);
  const top = clamp(place.y, 0, size.height - height);
  const moveTo = (center: number, y: number, save: boolean) => {
    const next = {
      x: clamp(center, width / 2, size.width - width / 2) / size.width,
      y: clamp(y, 0, size.height - height),
    };
    setPlace(next);
    if (save) savePlace(next);
  };
  const paused = session.state === "stopped";
  const act = (work: () => unknown) => () =>
    void Promise.resolve()
      .then(work)
      .catch((e) => host().report(e));
  const button = (
    label: string,
    key: string,
    Glyph: () => React.JSX.Element,
    action: () => unknown,
    disabled = false,
  ) => {
    const keys = keysOf(key);
    return (
      <button
        type="button"
        aria-label={label}
        aria-keyshortcuts={keys || undefined}
        title={keys ? `${label} (${keyLabel(keys, "")})` : label}
        disabled={disabled || session.ending}
        onClick={act(action)}
      >
        <Glyph />
      </button>
    );
  };
  return (
    <div
      ref={bar}
      className="debug-toolbar"
      role="toolbar"
      aria-label="Debug"
      style={{ left, top }}
    >
      <span
        className="debug-toolbar-grip"
        role="button"
        tabIndex={0}
        aria-label="Move Debug Toolbar"
        title="Drag to move; double-click to put back; arrows move it"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { dx: event.clientX - left, dy: event.clientY - top };
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          moveTo(
            event.clientX - drag.current.dx,
            event.clientY - drag.current.dy,
            false,
          );
        }}
        onPointerUp={(event) => {
          if (!drag.current) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          moveTo(left, top, true);
        }}
        onLostPointerCapture={() => (drag.current = null)}
        onDoubleClick={() => {
          setPlace(DEFAULT_PLACE);
          savePlace(DEFAULT_PLACE);
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 50 : 10;
          const steps: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const move = steps[event.key];
          if (!move) return;
          event.preventDefault();
          moveTo(left + move[0], top + move[1], true);
        }}
      >
        <GripIcon />
      </span>
      {paused
        ? button("Continue", "debug.continue", ContinueIcon, continueDebugging)
        : button(
            "Pause",
            "debug.pause",
            PauseIcon,
            pauseDebugging,
            session.state !== "running",
          )}
      {button("Step Over", "debug.stepOver", StepOverIcon, stepOver, !paused)}
      {button("Step Into", "debug.stepInto", StepIntoIcon, stepInto, !paused)}
      {button("Step Out", "debug.stepOut", StepOutIcon, stepOut, !paused)}
      {button("Restart", "debug.restart", RestartIcon, restartDebugging)}
      {button("Stop", "debug.stop", StopIcon, stopDebugging)}
    </div>
  );
}
