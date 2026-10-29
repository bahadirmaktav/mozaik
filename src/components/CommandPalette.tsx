import { useEffect, useRef, useState } from "react";

export type Command = {
  id: string;
  label: string;
  shortcut?: string;
  run: () => void;
};

/** Every word of the query must occur in the label, in any order. */
export function matchCommands(commands: Command[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return commands.filter((c) =>
    words.every((w) => c.label.toLowerCase().includes(w)),
  );
}

/** A filterable command list that drops from the title bar, like an editor's palette. */
export function CommandPalette({
  commands,
  onPick,
  onCancel,
}: {
  commands: Command[];
  onPick: (command: Command) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const matches = matchCommands(commands, query);
  const current = Math.min(selected, matches.length - 1);
  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label="Command palette"
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
        placeholder="Type a command"
        aria-label="Type a command"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-results"
        aria-activedescendant={
          matches[current] ? `palette-${matches[current].id}` : undefined
        }
        value={query}
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
            id={`palette-${command.id}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setSelected(index)}
            onClick={() => onPick(command)}
          >
            <span>{command.label}</span>
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </li>
        ))}
        {!matches.length && <li className="muted">No matching commands</li>}
      </ul>
    </dialog>
  );
}
