import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/** Left/Right move focus between the buttons of a dialog's action row, wrapping around. */
function moveBetweenActions(event: KeyboardEvent<HTMLDialogElement>) {
  const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (!step || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey)
    return;
  const button = event.target;
  const row = button instanceof HTMLButtonElement ? button.parentElement : null;
  if (!row?.classList.contains("dialog-actions")) return;
  const buttons = [
    ...row.querySelectorAll<HTMLButtonElement>(
      ":scope > button:not(:disabled)",
    ),
  ];
  const index = buttons.indexOf(button as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  buttons[(index + step + buttons.length) % buttons.length].focus();
}

export function Dialog({
  title,
  children,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    // React's autoFocus runs while the dialog is still closed; showModal would focus the
    // first button instead (often the destructive one).
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      aria-label={title}
      onKeyDown={moveBetweenActions}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
