import { useEffect, useState } from "react";
import type { PluginDefinition } from "../plugins/contract";
import { Dialog } from "./Dialog";

/** Where a tool is added: a split of the focused panel, a tab in it, or a floating panel. */
export type AddMode = "auto" | "tab" | "float";
/** Enter splits, Ctrl+Enter adds a tab, Ctrl+Shift+Enter a floating panel (also on click). */
export const addMode = (event: { ctrlKey: boolean; shiftKey: boolean }) =>
  event.ctrlKey ? (event.shiftKey ? "float" : "tab") : "auto";
/** The keys of `addMode`, shown under the launcher and the palette's add commands. */
export function AddHint() {
  return (
    <p className="launcher-hint muted">
      <kbd>Enter</kbd> split <kbd>Ctrl Enter</kbd> new tab{" "}
      <kbd>Ctrl Shift Enter</kbd> floating
    </p>
  );
}

export function Launcher({
  plugins,
  onPick,
  onCancel,
}: {
  plugins: PluginDefinition[];
  onPick: (plugin: PluginDefinition, mode: AddMode) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(0);
  const matches = plugins.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const current = Math.min(selected, matches.length - 1);
  const selectedId = matches[current]?.id;
  // The arrow keys keep the selected tool in view.
  useEffect(() => {
    if (selectedId)
      document
        .getElementById(`launcher-${selectedId}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);
  return (
    <Dialog title="Add to workspace" onCancel={onCancel}>
      <input
        className="launcher-search"
        autoFocus
        placeholder="Search tools"
        aria-label="Search tools"
        role="combobox"
        aria-expanded="true"
        aria-controls="launcher-results"
        aria-activedescendant={
          matches[current] ? `launcher-${matches[current].id}` : undefined
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
            if (matches[current]) onPick(matches[current], addMode(e));
          }
        }}
      />
      <ul id="launcher-results" className="launcher-results" role="listbox">
        {matches.map((plugin, index) => (
          <li
            key={plugin.id}
            id={`launcher-${plugin.id}`}
            role="option"
            aria-selected={index === current}
            onMouseMove={() => setSelected(index)}
            onClick={(e) => onPick(plugin, addMode(e))}
          >
            {plugin.name}
          </li>
        ))}
        {!matches.length && <li className="muted">No tools found</li>}
      </ul>
      <AddHint />
    </Dialog>
  );
}
