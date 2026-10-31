import { useEffect, useMemo, useRef, useState } from "react";
import { AddHint, addMode, type AddMode } from "./Launcher";

export type Command = {
  id: string;
  label: string;
  shortcut?: string;
  /** Muted text after the label, e.g. a compiler's path in a pick list. */
  detail?: string;
  /** Adds a tool: Enter, Ctrl+Enter or Ctrl+Shift+Enter choose `mode` as in the launcher. */
  adds?: boolean;
  run: (mode?: AddMode) => void;
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
/** How many recently run commands lead the list, as in VS Code. */
export const RECENT = 5;
const RECENT_KEY = "mozaik.recentCommands";
/** Labels of the commands run last, newest first; shared by the windows of this computer. */
function recentLabels(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}
function remember(label: string) {
  const labels = [label, ...recentLabels().filter((l) => l !== label)];
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(labels.slice(0, 50)));
  } catch {
    // Without storage the order simply starts over.
  }
}
/** How well a label matches the query: the whole label, the query at its start, the query
 * as one piece, or only its words. */
function rank(label: string, query: string) {
  const text = label.toLowerCase(),
    q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return 0;
  return text === q ? 0 : text.startsWith(q) ? 1 : text.includes(q) ? 2 : 3;
}
/**
 * The commands run most recently (up to `RECENT`, newest first), then the others by how
 * well they match the query and alphabetically. `recent` counts the first group.
 */
export function orderCommands(
  commands: Command[],
  recent: string[],
  query = "",
) {
  const first: Command[] = [];
  for (const label of recent) {
    if (first.length === RECENT) break;
    const command = commands.find((c) => c.label === label);
    if (command && !first.includes(command)) first.push(command);
  }
  const rest = commands
    .filter((c) => !first.includes(c))
    .sort(
      (a, b) =>
        rank(a.label, query) - rank(b.label, query) ||
        a.label.localeCompare(b.label),
    );
  return { list: [...first, ...rest], recent: first.length };
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
  onPick: (command: Command, mode: AddMode) => void;
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
  // Commands (`>`) lead with the recently run ones; files and pick lists keep their order.
  const commandsMode = !title && mode.prefix === ">";
  const recent = useMemo(recentLabels, []);
  const ordered = commandsMode
    ? orderCommands(
        typeof found === "string" ? [] : found,
        recent,
        query.slice(mode.prefix.length),
      )
    : { list: typeof found === "string" ? [] : found, recent: 0 };
  const matches = ordered.list;
  const current = Math.min(selected, matches.length - 1);
  function pick(command: Command, how: AddMode) {
    if (commandsMode) remember(command.label);
    onPick(command, how);
  }
  // The arrow keys keep the selected entry in view.
  useEffect(() => {
    document
      .getElementById(`palette-${current}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [current, query]);
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
            if (matches[current]) pick(matches[current], addMode(e));
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
            className={
              ordered.recent && index === ordered.recent
                ? "palette-group"
                : undefined
            }
            onMouseMove={() => setSelected(index)}
            onClick={(e) => pick(command, addMode(e))}
          >
            <span>{command.label}</span>
            {command.detail && (
              <span className="palette-detail" title={command.detail}>
                {command.detail}
              </span>
            )}
            {ordered.recent > 0 &&
              (index === 0 || index === ordered.recent) && (
                <span className="palette-caption">
                  {index === 0 ? "recently used" : "other commands"}
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
      {matches[current]?.adds && <AddHint />}
    </dialog>
  );
}
