import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ISearchOptions } from "@xterm/addon-search";
import { focus, searchOf, selectionOf } from "./runtime";

/**
 * Find in an IDE terminal, as VS Code's terminal find widget: the editors' widget without
 * Replace or Find in Selection, over the scrollback. Matches are highlighted and counted
 * (at most `LIMIT`), Enter and Shift+Enter (or F3) step through them.
 */
const LIMIT = 1000;
// The addon wants #RRGGBB colors: VS Code's find highlight hues, readable on every theme.
const DECORATIONS: ISearchOptions["decorations"] = {
  matchBackground: "#623315",
  matchBorder: "#9e6a03",
  matchOverviewRuler: "#d18616",
  activeMatchBackground: "#9e6a03",
  activeMatchBorder: "#ffcc66",
  activeMatchColorOverviewRuler: "#ffcc66",
};

export interface TerminalFindHandle {
  /** Shows the widget (with the terminal's selection as the search) and focuses it. */
  open(): void;
  close(): void;
}
interface Options {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

const PATHS = {
  up: "M8 12V4M4 8l4-4 4 4",
  down: "M8 4v8M4 8l4 4 4-4",
  close: "M4 4l8 8M12 4l-8 8",
};
const Icon = ({ name }: { name: keyof typeof PATHS }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d={PATHS[name]} />
  </svg>
);

function Toggle({
  label,
  text,
  on,
  className,
  onClick,
}: {
  label: string;
  text: string;
  on: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={className ? `cm-find-toggle ${className}` : "cm-find-toggle"}
      title={label}
      aria-label={label.replace(/ \(.*\)$/, "")}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {text}
    </button>
  );
}
function Action({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: keyof typeof PATHS;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cm-find-action"
      title={label}
      aria-label={label.replace(/ \(.*\)$/, "")}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

export const TerminalFind = forwardRef<
  TerminalFindHandle,
  { id: string; shown: boolean; onShown: (shown: boolean) => void }
>(function TerminalFind({ id, shown, onShown }, ref) {
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [options, setOptions] = useState<Options>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const [result, setResult] = useState({ index: -1, count: 0 });
  const [invalid, setInvalid] = useState(false);
  const latest = useRef({ text, options });
  latest.current = { text, options };

  useEffect(() => {
    const search = searchOf(id);
    if (!search) return;
    const changed = search.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResult({ index: resultIndex, count: resultCount }),
    );
    return () => changed.dispose();
  }, [id]);

  function find(forward: boolean) {
    const search = searchOf(id);
    const { text, options } = latest.current;
    if (!search) return;
    if (!text || !shown) {
      search.clearDecorations();
      setResult({ index: -1, count: 0 });
      setInvalid(false);
      return;
    }
    if (options.regex) {
      try {
        new RegExp(text);
      } catch {
        search.clearDecorations();
        setResult({ index: -1, count: 0 });
        setInvalid(true);
        return;
      }
    }
    setInvalid(false);
    const settings = { ...options, decorations: DECORATIONS };
    if (forward) search.findNext(text, settings);
    else search.findPrevious(text, settings);
  }
  // Typing or a toggle searches up from the match (from the newest output at first), as
  // VS Code's terminal does; a longer search stays on a match that still fits.
  const searched = useRef(options);
  useEffect(() => {
    // The addon notes new options before comparing them, so it would keep the old matches.
    if (searched.current !== options) searchOf(id)?.clearDecorations();
    searched.current = options;
    find(false);
  }, [text, options, shown]);

  useImperativeHandle(ref, () => ({
    open() {
      const selected = selectionOf(id);
      onShown(true);
      // The terminal's selection, on one line, becomes the search.
      if (selected && !selected.includes("\n")) setText(selected);
      requestAnimationFrame(() => {
        field.current?.focus();
        field.current?.select();
      });
    },
    close,
  }));

  function close() {
    searchOf(id)?.clearDecorations();
    onShown(false);
    focus(id);
  }
  const flip = (key: keyof Options) =>
    setOptions((o) => ({ ...o, [key]: !o[key] }));
  function keydown(event: ReactKeyboardEvent) {
    const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const toggle =
      event.altKey && plain
        ? (
            { KeyC: "caseSensitive", KeyW: "wholeWord", KeyR: "regex" } as const
          )[event.code as "KeyC"]
        : undefined;
    if (toggle) flip(toggle);
    else if (event.key === "Enter" || event.key === "F3") find(!event.shiftKey);
    else if (event.key === "Escape") close();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  if (!shown) return null;
  const count =
    !text || result.count === 0
      ? "No results"
      : `${result.index < 0 ? "?" : result.index + 1} of ${
          result.count >= LIMIT ? `${LIMIT}+` : result.count
        }`;
  return (
    <div className="cm-find terminal-find" role="search" onKeyDown={keydown}>
      <div className="cm-find-rows">
        <div className="cm-find-row">
          <div className={invalid ? "cm-find-input invalid" : "cm-find-input"}>
            <input
              ref={field}
              type="text"
              placeholder="Find"
              aria-label="Find"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Toggle
              label="Match Case (Alt+C)"
              text="Aa"
              on={options.caseSensitive}
              onClick={() => flip("caseSensitive")}
            />
            <Toggle
              label="Match Whole Word (Alt+W)"
              text="ab"
              on={options.wholeWord}
              className="cm-find-word"
              onClick={() => flip("wholeWord")}
            />
            <Toggle
              label="Use Regular Expression (Alt+R)"
              text=".*"
              on={options.regex}
              onClick={() => flip("regex")}
            />
          </div>
          <span
            className={
              text && result.count === 0
                ? "cm-find-count none"
                : "cm-find-count"
            }
            aria-live="polite"
          >
            {count}
          </span>
          <Action
            label="Previous Match (Shift+Enter)"
            icon="up"
            onClick={() => find(false)}
          />
          <Action
            label="Next Match (Enter)"
            icon="down"
            onClick={() => find(true)}
          />
          <Action label="Close (Escape)" icon="close" onClick={close} />
        </div>
      </div>
    </div>
  );
});
