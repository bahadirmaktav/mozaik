import { useState } from "react";
import { Dialog } from "./Dialog";

/** Asks for a name; Save resolves with it (trimmed), Cancel or Escape with null. */
export function NameDialog({
  title,
  label,
  action,
  onDone,
}: {
  title: string;
  label: string;
  action: string;
  onDone: (name: string | null) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Dialog title={title} onCancel={() => onDone(null)}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) onDone(name.trim());
        }}
      >
        <input
          data-autofocus
          className="tasks-name-input"
          aria-label={label}
          maxLength={60}
          spellCheck={false}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="dialog-actions">
          <button type="submit" disabled={!name.trim()}>
            {action}
          </button>
          <button type="button" onClick={() => onDone(null)}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
