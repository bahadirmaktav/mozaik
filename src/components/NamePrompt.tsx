import { useEffect, useRef, useState } from "react";

/**
 * Asks for a name in the command palette's place: type it and press Enter, Escape or a
 * click outside cancels. The row under the field says what Enter does; `existing` names are
 * listed below it and fill the field when clicked. A string returned by `onSubmit` is an
 * error shown in place of that row, and the prompt stays open.
 */
export function NamePrompt({
  title,
  placeholder,
  initial = "",
  selectStem = false,
  maxLength,
  action,
  existing = [],
  existingCaption,
  onSubmit,
  onCancel,
}: {
  title: string;
  placeholder: string;
  initial?: string;
  /** Selects the name without its extension, as file managers do. */
  selectStem?: boolean;
  maxLength?: number;
  /** What Enter does with the trimmed name, e.g. `Save “Daily” as a template`. */
  action: (name: string) => string;
  existing?: string[];
  existingCaption?: string;
  onSubmit: (name: string) => Promise<string | void> | string | void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initial),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const trimmed = name.trim();
  async function submit() {
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const failure = await onSubmit(trimmed);
      if (failure) setError(failure);
    } finally {
      setBusy(false);
    }
  }
  const matches = existing.filter((e) =>
    e.toLowerCase().includes(trimmed.toLowerCase()),
  );
  return (
    <dialog
      ref={ref}
      className="palette"
      aria-label={title}
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
        placeholder={placeholder}
        aria-label={placeholder}
        aria-describedby="name-prompt-action"
        spellCheck={false}
        maxLength={maxLength}
        value={name}
        onFocus={(e) => {
          const input = e.currentTarget;
          const dot = input.value.lastIndexOf(".");
          input.setSelectionRange(
            0,
            selectStem && dot > 0 ? dot : input.value.length,
          );
        }}
        onChange={(e) => {
          setName(e.target.value);
          setError("");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <ul className="palette-results">
        <li
          id="name-prompt-action"
          className={error ? "name-prompt-error" : trimmed ? "active" : "muted"}
          role={error ? "alert" : undefined}
          onClick={() => void submit()}
        >
          <span>{error || (trimmed ? action(trimmed) : title)}</span>
          {trimmed && !error && <kbd>Enter</kbd>}
        </li>
        {matches.map((e, i) => (
          <li
            key={e}
            className={i === 0 ? "palette-group" : undefined}
            onClick={() => {
              setName(e);
              setError("");
              ref.current?.querySelector("input")?.focus();
            }}
          >
            <span>{e}</span>
            {i === 0 && existingCaption && (
              <span className="palette-caption">{existingCaption}</span>
            )}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
