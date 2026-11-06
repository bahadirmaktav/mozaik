import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { fit, wheelFactor, zoomAt, type Size, type View } from "./panZoomModel";

/** Where the user left a picture; kept by the owner so it survives a tab switch. */
export type PanZoomMemory = { view?: View };
const KEY_FACTOR = 1.25;
const KEY_STEP = 40;

/**
 * Shows a picture of `size` in a viewport: Ctrl+wheel zooms at the pointer, dragging with the
 * left button (or the wheel) moves it, a double click or the percentage fits it again. It
 * fits by itself until the user moves it. Everything stays in this component: no IPC.
 */
export function PanZoom({
  size,
  memory,
  label,
  children,
}: {
  size: Size | null;
  memory: PanZoomMemory;
  label: string;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [view, setView] = useState(memory.view ?? null);
  const drag = useRef<{ x: number; y: number; from: View } | null>(null);
  const shown =
    view ?? (size && box ? fit(size, box) : { x: 0, y: 0, scale: 1 });
  /** The user's own place: kept from now on, also when the picture changes. */
  function place(next: View) {
    memory.view = next;
    setView(next);
  }
  function refit() {
    memory.view = undefined;
    setView(null);
  }
  useLayoutEffect(() => {
    const element = viewport.current!;
    const measure = () =>
      setBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // React's wheel listener is passive, and only this one can keep the page from zooming.
  const latest = useRef(shown);
  latest.current = shown;
  useEffect(() => {
    const element = viewport.current!;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const now = latest.current;
      place(
        event.ctrlKey
          ? zoomAt(
              now,
              wheelFactor(event.deltaY),
              event.clientX - rect.left,
              event.clientY - rect.top,
            )
          : {
              ...now,
              x: now.x - (event.shiftKey ? event.deltaY : event.deltaX),
              y: now.y - (event.shiftKey ? 0 : event.deltaY),
            },
      );
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const center = () => ({
    x: (box?.width ?? 0) / 2,
    y: (box?.height ?? 0) / 2,
  });
  function keys(event: React.KeyboardEvent) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const { x, y } = center();
    const moves: Record<string, () => void> = {
      "+": () => place(zoomAt(shown, KEY_FACTOR, x, y)),
      "=": () => place(zoomAt(shown, KEY_FACTOR, x, y)),
      "-": () => place(zoomAt(shown, 1 / KEY_FACTOR, x, y)),
      "0": refit,
      ArrowLeft: () => place({ ...shown, x: shown.x + KEY_STEP }),
      ArrowRight: () => place({ ...shown, x: shown.x - KEY_STEP }),
      ArrowUp: () => place({ ...shown, y: shown.y + KEY_STEP }),
      ArrowDown: () => place({ ...shown, y: shown.y - KEY_STEP }),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    move();
  }
  return (
    <div
      className="pan-zoom"
      ref={viewport}
      role="group"
      tabIndex={0}
      aria-label={`${label}. Ctrl and the wheel zoom, dragging moves it.`}
      onKeyDown={keys}
      onDoubleClick={refit}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add("dragging");
        drag.current = { x: event.clientX, y: event.clientY, from: shown };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (dx || dy)
          place({ ...start.from, x: start.from.x + dx, y: start.from.y + dy });
      }}
      onPointerUp={(event) => {
        drag.current = null;
        event.currentTarget.classList.remove("dragging");
      }}
      onPointerCancel={(event) => {
        drag.current = null;
        event.currentTarget.classList.remove("dragging");
      }}
    >
      <div
        className="pan-zoom-content"
        style={{
          width: size?.width,
          height: size?.height,
          transform: `translate(${shown.x}px, ${shown.y}px) scale(${shown.scale})`,
        }}
      >
        {children}
      </div>
      <button
        type="button"
        className="pan-zoom-level"
        title="Fit to the panel"
        aria-label={`Zoom ${Math.round(shown.scale * 100)} percent. Fit to the panel`}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={refit}
      >
        {Math.round(shown.scale * 100)}%
      </button>
    </div>
  );
}
