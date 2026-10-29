import { useState } from "react";
import {
  conflicts,
  keyName,
  keysOf,
  label,
  record,
  scopes,
  shortcuts,
  useKeybindings,
  type Shortcut,
} from "./keybindings";

/** Every shortcut by place: click its keys and press new ones; Escape cancels. */
export function ShortcutSettings({
  workspaceKey,
  onChange,
}: {
  workspaceKey: string;
  onChange: (custom: Record<string, string>) => void;
}) {
  const custom = useKeybindings();
  const [recording, setRecording] = useState<string | null>(null);
  const [warning, setWarning] = useState<{ id: string; text: string } | null>(
    null,
  );
  function assign(shortcut: Shortcut, keys: string | null) {
    const next = { ...custom };
    if (keys === null || keys === shortcut.keys) delete next[shortcut.id];
    else next[shortcut.id] = keys;
    onChange(next);
  }
  function keyDown(event: React.KeyboardEvent, shortcut: Shortcut) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") return setRecording(null);
    // Workspace-key shortcuts take only the key: the held key itself is the modifier.
    const keys = shortcut.keys.startsWith("Mod+")
      ? ["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(event.key)
        ? null
        : `Mod+${event.shiftKey ? "Shift+" : ""}${keyName(event)}`
      : record(event.nativeEvent);
    if (!keys) return;
    setRecording(null);
    const taken = conflicts(shortcut.id, keys);
    if (taken.length)
      return setWarning({
        id: shortcut.id,
        text: `${label(keys, workspaceKey)} is already ${taken
          .map((s) => `${s.label} (${s.scope})`)
          .join(", ")}.`,
      });
    setWarning(null);
    assign(shortcut, keys);
  }
  return (
    <div className="shortcut-settings">
      {scopes.map((scope) => (
        <section key={scope} aria-label={`${scope} shortcuts`}>
          <h3>{scope}</h3>
          {shortcuts
            .filter((s) => s.scope === scope)
            .map((shortcut) => {
              const keys = keysOf(shortcut.id);
              const changed = shortcut.id in custom;
              return (
                <div key={shortcut.id} className="shortcut-row">
                  <span>{shortcut.label}</span>
                  {shortcut.fixed ? (
                    <kbd>{label(keys, workspaceKey)}</kbd>
                  ) : (
                    <button
                      type="button"
                      className={`shortcut-keys${recording === shortcut.id ? " recording" : ""}`}
                      aria-label={`${shortcut.label} (${scope}): ${keys ? label(keys, workspaceKey) : "none"}`}
                      onClick={() => {
                        setWarning(null);
                        setRecording(
                          recording === shortcut.id ? null : shortcut.id,
                        );
                      }}
                      onKeyDown={(event) =>
                        recording === shortcut.id && keyDown(event, shortcut)
                      }
                      onBlur={() =>
                        recording === shortcut.id && setRecording(null)
                      }
                    >
                      {recording === shortcut.id
                        ? shortcut.keys.startsWith("Mod+")
                          ? `${workspaceKey} + …`
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
                        onClick={() => assign(shortcut, "")}
                      >
                        ×
                      </button>
                    )}
                    {changed && (
                      <button
                        type="button"
                        aria-label={`Reset ${shortcut.label} shortcut`}
                        title={`Reset to ${shortcut.keys ? label(shortcut.keys, workspaceKey) : "none"}`}
                        onClick={() => assign(shortcut, null)}
                      >
                        ↺
                      </button>
                    )}
                  </span>
                  {warning?.id === shortcut.id && (
                    <p className="settings-warning" role="alert">
                      {warning.text}
                    </p>
                  )}
                </div>
              );
            })}
        </section>
      ))}
    </div>
  );
}
