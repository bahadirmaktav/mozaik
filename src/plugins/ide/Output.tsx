import { useLayoutEffect, useRef, useState } from "react";
import { problemIn } from "./buildOutput";
import { host, reveal } from "./editors";
import { useOutput, type ChannelName } from "./channels";

const LINE = 18;
const OVERSCAN = 20;

/**
 * An output channel: only the visible lines are rendered, so long builds stay smooth. It
 * follows new output while scrolled to the end. A line naming a file and line opens it.
 */
export function Output({
  channel,
  base,
}: {
  channel: ChannelName;
  /** Folder relative paths in compiler messages start from. */
  base: string | null;
}) {
  const { lines, dropped, version } = useOutput(channel);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 400 });
  const following = useRef(true);
  useLayoutEffect(() => {
    const element = scroller.current!;
    const observer = new ResizeObserver(() =>
      setView({ top: element.scrollTop, height: element.clientHeight }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = scroller.current!;
    if (following.current) element.scrollTop = element.scrollHeight;
  }, [version]);
  const first = Math.max(0, Math.floor(view.top / LINE) - OVERSCAN);
  const last = Math.min(
    lines.length,
    Math.ceil((view.top + view.height) / LINE) + OVERSCAN,
  );
  function open(line: string) {
    // A drag that selected text is not a click on the line.
    if (window.getSelection()?.toString()) return;
    const problem = problemIn(line, base ?? "");
    if (!problem) return;
    void reveal(problem.path, {
      line: problem.line - 1,
      character: problem.column - 1,
    }).catch((e) => host().report(e));
  }
  return (
    <div
      className="output"
      ref={scroller}
      tabIndex={0}
      role="log"
      aria-label={`${channel} output`}
      onScroll={(e) => {
        const element = e.currentTarget;
        following.current =
          element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
        setView({ top: element.scrollTop, height: element.clientHeight });
      }}
    >
      {!lines.length && (
        <p className="muted output-empty">
          {channel === "CMake"
            ? "CMake configure and build output appears here."
            : channel === "Analysis"
              ? "clang-tidy's command lines and output appear here when an analysis runs."
              : channel === "Tests"
                ? "CTest's output appears here when tests run."
                : "Messages of the IDE (a definition not found, a failed action) appear here."}
        </p>
      )}
      <div className="output-lines" style={{ height: lines.length * LINE }}>
        {lines.slice(first, last).map((line, index) => {
          const number = first + index;
          const link = problemIn(line, base ?? "") !== null;
          return (
            <div
              key={number + dropped}
              className={`output-line${link ? " link" : ""}`}
              style={{ top: number * LINE }}
              onClick={link ? () => open(line) : undefined}
            >
              {line || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}
