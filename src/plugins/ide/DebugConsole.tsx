import { useEffect, useRef, useState } from "react";
import {
  ContinueIcon,
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
import { host } from "./editors";

/**
 * The bottom panel's Debug Console: the debugger's messages, logpoints and expression
 * results. Its history stays after a session until the next one starts or Clear.
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
            Debugger messages, logpoints and expression results appear here.
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

/** The small floating toolbar over the editors while a session runs, as in VS Code. */
export function DebugToolbar() {
  const { session } = useDebug();
  if (!session) return null;
  const paused = session.state === "stopped";
  const act = (work: () => unknown) => () =>
    void Promise.resolve()
      .then(work)
      .catch((e) => host().report(e));
  const button = (
    label: string,
    Glyph: () => React.JSX.Element,
    action: () => unknown,
    disabled = false,
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || session.ending}
      onClick={act(action)}
    >
      <Glyph />
    </button>
  );
  return (
    <div className="debug-toolbar" role="toolbar" aria-label="Debug">
      {paused
        ? button("Continue", ContinueIcon, continueDebugging)
        : button(
            "Pause",
            PauseIcon,
            pauseDebugging,
            session.state !== "running",
          )}
      {button("Step Over", StepOverIcon, stepOver, !paused)}
      {button("Step Into", StepIntoIcon, stepInto, !paused)}
      {button("Step Out", StepOutIcon, stepOut, !paused)}
      {button("Restart", RestartIcon, restartDebugging)}
      {button("Stop", StopIcon, stopDebugging)}
    </div>
  );
}
