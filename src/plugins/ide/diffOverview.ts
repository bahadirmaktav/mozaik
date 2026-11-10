import type { MergeView } from "@codemirror/merge";
import type { EditorView } from "@codemirror/view";

/** The changes' colors, as the comparison's (`App.css`). */
const REMOVED = "#f24848",
  ADDED = "#3fb950",
  /** The smallest band, so that a one-line change in a long file still shows. */
  MIN_BAND = 2,
  MIN_SLIDER = 16;

/** Where each side of a chunk lies in the content, in pixels from its top. */
export interface Band {
  top: number;
  bottom: number;
  side: "a" | "b";
}

/** The vertical extent of each changed side, from the merge view's chunks. */
export function bands(merge: MergeView, offset: { a: number; b: number }) {
  const out: Band[] = [];
  const add = (view: EditorView, side: "a" | "b", from: number, to: number) => {
    if (to <= from) return;
    const end = Math.max(from, to - 1);
    out.push({
      top: view.lineBlockAt(from).top + offset[side],
      bottom: view.lineBlockAt(end).bottom + offset[side],
      side,
    });
  };
  for (const chunk of merge.chunks) {
    add(merge.a, "a", chunk.fromA, chunk.toA);
    add(merge.b, "b", chunk.fromB, chunk.toB);
  }
  return out;
}

/**
 * The comparison's overview, after VS Code's diff editor: the whole comparison in the height of
 * a narrow column, with the removed lines red at its left and the added lines green at its
 * right, and the visible part as a slider. Code is not drawn; changes are what it is read for.
 * It is the comparison's scrollbar: a press brings that place to the middle, a drag moves it.
 */
export class DiffOverview {
  readonly dom = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly slider = document.createElement("div");
  private frame = 0;
  private readonly resize = new ResizeObserver(() => this.schedule());
  private readonly onScroll = () => this.schedule();
  private readonly onWheel = (event: WheelEvent) => {
    this.scroller.scrollTop += event.deltaY;
  };

  constructor(
    private readonly merge: MergeView,
    private readonly scroller: HTMLElement,
  ) {
    this.dom.className = "diff-overview";
    this.dom.setAttribute("aria-hidden", "true");
    this.slider.className = "diff-overview-slider";
    this.dom.append(this.canvas, this.slider);
    scroller.addEventListener("scroll", this.onScroll, { passive: true });
    this.dom.addEventListener("pointerdown", this.press);
    this.dom.addEventListener("wheel", this.onWheel, { passive: true });
    this.resize.observe(scroller);
    this.resize.observe(this.dom);
    this.resize.observe(merge.dom);
  }

  /** Draws again at the next frame: after an edit, a scroll or a resize. */
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private scale() {
    const total = Math.max(this.scroller.scrollHeight, 1);
    return this.dom.clientHeight / total;
  }

  private draw() {
    const { merge, scroller, canvas, slider, dom } = this;
    if (!dom.isConnected) return;
    const width = dom.clientWidth,
      height = dom.clientHeight;
    const ratio = window.devicePixelRatio || 1;
    if (
      canvas.width !== Math.round(width * ratio) ||
      canvas.height !== Math.round(height * ratio)
    ) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.height = `${height}px`;
    }
    const context = canvas.getContext("2d");
    if (!context || !width || !height) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    // Each editor's place in the scrolled content.
    const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const offset = {
      a: merge.a.documentTop - top,
      b: merge.b.documentTop - top,
    };
    const scale = this.scale();
    const half = Math.floor(width / 2);
    for (const band of bands(merge, offset)) {
      const y = band.top * scale;
      const size = Math.max(MIN_BAND, (band.bottom - band.top) * scale);
      context.fillStyle = band.side === "a" ? REMOVED : ADDED;
      if (band.side === "a") context.fillRect(0, y, half, size);
      else context.fillRect(half, y, width - half, size);
    }
    const range = scroller.scrollHeight - scroller.clientHeight;
    slider.hidden = range <= 0;
    const size = Math.max(MIN_SLIDER, scroller.clientHeight * scale);
    slider.style.height = `${size}px`;
    slider.style.top = `${Math.min(height - size, scroller.scrollTop * scale)}px`;
  }

  /**
   * As VS Code's overview: a press beside the slider brings that place to the middle, then the
   * drag moves the slider with the pointer.
   */
  private press = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const { dom, scroller, slider } = this;
    const scale = this.scale();
    if (!scale) return;
    const box = dom.getBoundingClientRect();
    const rect = slider.getBoundingClientRect();
    const onSlider =
      !slider.hidden &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    // Where in the slider the pointer holds it.
    const grab = onSlider
      ? event.clientY - rect.top
      : (scroller.clientHeight * scale) / 2;
    const scroll = (clientY: number) => {
      scroller.scrollTop = (clientY - box.top - grab) / scale;
    };
    if (!onSlider) scroll(event.clientY);
    dom.setPointerCapture(event.pointerId);
    dom.classList.add("dragging");
    const move = (e: PointerEvent) => scroll(e.clientY);
    const end = () => {
      dom.removeEventListener("pointermove", move);
      dom.removeEventListener("pointerup", end);
      dom.removeEventListener("pointercancel", end);
      dom.classList.remove("dragging");
    };
    dom.addEventListener("pointermove", move);
    dom.addEventListener("pointerup", end);
    dom.addEventListener("pointercancel", end);
  };

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.scroller.removeEventListener("scroll", this.onScroll);
    this.dom.remove();
  }
}
