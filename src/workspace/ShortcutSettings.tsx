import { useState } from "react";
import {
  chordParts,
  conflicts,
  keyName,
  keysOf,
  label,
  record,
  type Shortcut,
} from "./keybindings";

/**
 * One shortcut in Workspace Settings: click its keys and press new ones; Escape cancels.
 * A chord shortcut (`Ctrl+K Ctrl+C`) takes two key presses.
 * `custom` is the settings draft; changes are saved with the other settings.
 */
export function ShortcutRow({
  shortcut,
  custom,
  workspaceKey,
  onChange,
}: {
  shortcut: Shortcut;
  custom: Record<string, string>;
  workspaceKey: string;
  onChange: (custom: Record<string, string>) => void;
}) {
  const [recording, setRecording] = useState(false);
  // The first keys of a chord while its second keys are awaited.
  const [first, setFirst] = useState<string | null>(null);
  const chord = chordParts(shortcut.keys).length === 2;
  function stop() {
    setRecording(false);
    setFirst(null);
  }
  const [warning, setWarning] = useState("");
  function assign(keys: string | null) {
    const next = { ...custom };
    if (keys === null || keys === shortcut.keys) delete next[shortcut.id];
    else next[shortcut.id] = keys;
    onChange(next);
  }
  function keyDown(event: React.KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") return stop();
    // Workspace-key shortcuts take only the key: the held key itself is the modifier.
    let keys = shortcut.keys.startsWith("Mod+")
      ? ["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(event.key)
        ? null
        : `Mod+${event.shiftKey ? "Shift+" : ""}${keyName(event)}`
      : record(event.nativeEvent);
    if (!keys) return;
    if (chord && !first) return setFirst(keys);
    if (first) keys = `${first} ${keys}`;
    stop();
    const taken = conflicts(shortcut.id, keys, custom);
    if (taken.length)
      return setWarning(
        `${label(keys, workspaceKey)} is already ${taken
          .map((s) => `${s.label} (${s.scope})`)
          .join(", ")}.`,
      );
    setWarning("");
    assign(keys);
  }
  const keys = keysOf(shortcut.id, custom);
  const changed = shortcut.id in custom;
  const scope = shortcut.scope;
  return (
    <div className="shortcut-row">
      <span>{shortcut.label}</span>
      {shortcut.fixed ? (
        <kbd>{label(keys, workspaceKey)}</kbd>
      ) : (
        <button
          type="button"
          className={`shortcut-keys${recording ? " recording" : ""}`}
          aria-label={`${shortcut.label} (${scope}): ${keys ? label(keys, workspaceKey) : "none"}`}
          onClick={() => {
            setWarning("");
            if (recording) stop();
            else setRecording(true);
          }}
          onKeyDown={(event) => recording && keyDown(event)}
          onBlur={stop}
        >
          {recording
            ? shortcut.keys.startsWith("Mod+")
              ? `${workspaceKey} + …`
              : first
                ? `${label(first, workspaceKey)} …`
                : chord
                  ? "Press two keys…"
                  : "Press keys…"
            : keys
              ? label(keys, workspaceKey)
              : "—"}
        </button>
      )}
      <span className="shortcut-actions">
        {!shortcut.fixed && keys && (
          <button
            type="button"
            aria-label={`Remove ${shortcut.label} shortcut`}
            title="Remove"
            onClick={() => assign("")}
          >
            ×
          </button>
        )}
        {changed && (
          <button
            type="button"
            aria-label={`Reset ${shortcut.label} shortcut`}
            title={`Reset to ${shortcut.keys ? label(shortcut.keys, workspaceKey) : "none"}`}
            onClick={() => assign(null)}
          >
            ↺
          </button>
        )}
      </span>
      {warning && (
        <p className="settings-warning" role="alert">
          {warning}
        </p>
      )}
    </div>
  );
}
