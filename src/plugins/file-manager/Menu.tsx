import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type MenuItem =
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      checked?: boolean;
      action: () => void;
    }
  | "separator";
/** Closes on outside pointer, Escape, Tab or window blur. */
export function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
}
/** Keeps a popup inside the window. */
export function usePlacement(
  ref: React.RefObject<HTMLElement | null>,
  x: number,
  y: number,
) {
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const rect = ref.current!.getBoundingClientRect();
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)),
    });
  }, [x, y]);
  return position;
}
/** Moves focus between the popup's enabled buttons with the arrow keys. */
export function arrowFocus(event: React.KeyboardEvent, container: HTMLElement) {
  const buttons = [
    ...container.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
  ];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "ArrowDown"
      ? (index + 1) % buttons.length
      : event.key === "ArrowUp"
        ? (index - 1 + buttons.length) % buttons.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : null;
  if (next === null || !buttons.length) return false;
  event.preventDefault();
  buttons[next].focus();
  return true;
}

export function Menu({
  label,
  items,
  x,
  y,
  onClose,
}: {
  label: string;
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onClose);
  const position = usePlacement(ref, x, y);
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, []);
  return (
    <Popup
      ref={ref}
      label={label}
      role="menu"
      style={position}
      onClose={onClose}
    >
      {items.map((item, index) =>
        item === "separator" ? (
          <div key={index} role="separator" className="menu-separator" />
        ) : (
          <button
            key={item.label}
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            disabled={item.disabled}
            tabIndex={-1}
            onClick={() => {
              onClose();
              item.action();
            }}
          >
            <span className="menu-check">{item.checked ? "✓" : ""}</span>
            <span className="menu-label">{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </Popup>
  );
}
export function Popup({
  ref,
  label,
  role,
  style,
  onClose,
  children,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  label: string;
  role: "menu" | "dialog";
  style: React.CSSProperties;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      ref={ref}
      className="menu"
      role={role}
      aria-label={label}
      style={style}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          onClose();
        } else arrowFocus(event, ref.current!);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}
