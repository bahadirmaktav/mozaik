import { useEffect, useRef, useState } from "react";

export type Command = {
  id: string;
  label: string;
  shortcut?: string;
  /** Muted text after the label, e.g. a compiler's path in a pick list. */
  detail?: string;
  run: () => void;
};
/** What the palette lists for queries starting with `prefix`; a string is a status line. */
export interface PaletteMode {
  prefix: string;
  placeholder: string;
  items: (query: string) => Command[] | string;
}

/** Every word of the query must occur in the label, in any order. */
export function matchCommands(commands: Command[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((c) =>
    words.every((w) => c.label.toLowerCase().includes(w)),
  );
}
/** The mode with the longest prefix the query starts with. */
function modeOf(modes: PaletteMode[], query: string) {
  return [...modes]
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((m) => query.startsWith(m.prefix));
}

/**
 * A filterable list that drops from the top of the window, like an editor's palette. As in
 * VS Code, `>` lists commands and other prefixes switch to the given `modes` (files,
 * symbols). With `title` it is a pick list (a kit, a target) instead.
 */
export function CommandPalette({
  commands,
  modes = [],
  initial = "",
  onPick,
  onCancel,
  title,
}: {
  commands: Command[];
  modes?: PaletteMode[];
  initial?: string;
  onPick: (command: Command) => void;
  onCancel: () => void;
  title?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(initial),
    [selected, setSelected] = useState(0);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const all: PaletteMode[] = title
    ? [
        {
          prefix: "",
          placeholder: title,
          items: (q) => matchCommands(commands, q),
        },
      ]
    : [
        {
          prefix: ">",
          placeholder: "Type a command",
          items: (q) => matchCommands(commands, q),
        },
        ...modes,
      ];
  const mode = modeOf(all, query) ?? all[0];
  const found = mode.items(
    query.startsWith(mode.prefix) ? query.slice(mode.prefix.length) : query,
  );
  const matches = typeof found === "string" ? [] : found;
  const current = Math.min(selected, matches.length - 1);
  const label = title ?? "Command palette";
  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      // A click on the backdrop lands on the dialog element itself.
      onPointerDown={(event) => {
        if (event.target === ref.current) onCancel();
      }}
    >
      <input
        className="palette-search"
        autoFocus
        placeholder={mode.placeholder}
        aria-label={mode.placeholder}
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={
          matches[current] ? `palette-${current}` : undefined
        }
        value={query}
        onFocus={(e) => {
          // A prefix stays in front of the cursor, ready for the query.
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!matches.length) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setSelected((current + step + matches.length) % matches.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (matches[current]) onPick(matches[current]);
          }
        }}
      />
      <ul id="palette-results" className="palette-results" role="listbox">
        {matches.map((command, index) => (
          <li
            key={command.id}
            id={`palette-${index}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setSelected(index)}
            onClick={() => onPick(command)}
          >
            <span>{command.label}</span>
            {command.detail && (
              <span className="palette-detail" title={command.detail}>
                {command.detail}
              </span>
            )}
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </li>
        ))}
        {!matches.length && (
          <li className="muted">
            {typeof found === "string" && found
              ? found
              : title
                ? "Nothing matches"
                : mode.prefix === ">"
                  ? "No matching commands"
                  : "No matches"}
          </li>
        )}
      </ul>
    </dialog>
  );
}
