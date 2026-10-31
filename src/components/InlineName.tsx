import { useRef, useState } from "react";

/**
 * A name typed in place, in a tree or list row, as in a file explorer: Enter or leaving the
 * field submits, Escape cancels, an empty or unchanged name cancels. A failed submit keeps
 * the field open with its error.
 */
export function InlineName({
  label,
  initial,
  stem = false,
  submit,
  onDone,
}: {
  label: string;
  initial: string;
  /** Selects the name without its extension, so typing keeps the extension. */
  stem?: boolean;
  /** Resolves with an error message, or null once done. */
  submit: (name: string) => Promise<string | null>;
  /** The submitted name, or null when cancelled. */
  onDone: (name: string | null) => void;
}) {
  const [name, setName] = useState(initial),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  async function send() {
    if (busy.current) return;
    if (!name.trim() || name.trim() === initial) return onDone(null);
    busy.current = true;
    const failure = await submit(name);
    busy.current = false;
    if (failure) setError(failure);
    else onDone(name);
  }
  return (
    <span className="inline-name">
      <input
        autoFocus
        className="inline-name-input"
        aria-label={label}
        aria-invalid={!!error}
        maxLength={255}
        spellCheck={false}
        value={name}
        onFocus={(e) => {
          const dot = stem ? e.currentTarget.value.lastIndexOf(".") : -1;
          e.currentTarget.setSelectionRange(
            0,
            dot > 0 ? dot : e.currentTarget.value.length,
          );
        }}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // The list's keys (F2, Delete, arrows) stay out of the field.
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone(null);
          }
        }}
        onBlur={() => void send()}
      />
      {error && (
        <span className="inline-name-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
