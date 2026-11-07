import { useRef } from "react";

/** A side list's edge: dragging it sets the list's width. The owner clamps what it is given. */
export function WidthResizer({
  className,
  label,
  width,
  onWidth,
}: {
  className: string;
  label: string;
  width: number;
  onWidth: (width: number) => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        const s = start.current;
        if (s) onWidth(s.width + event.clientX - s.x);
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
    />
  );
}
