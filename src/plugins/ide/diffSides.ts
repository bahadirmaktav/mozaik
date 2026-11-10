import type { MergeView } from "@codemirror/merge";
import type { EditorView } from "@codemirror/view";

/** The narrowest a side may become, as a share of both. */
const MIN_SHARE = 0.1;
/** The left side's share of the width, kept for the next comparison while the window lasts. */
let share = 0.5;
export const clampShare = (value: number) =>
  Math.min(1 - MIN_SHARE, Math.max(MIN_SHARE, value));

/**
 * The two sides of a comparison: a line between them that a drag moves (a double click puts it
 * back in the middle), and a horizontal scrollbar under each side at the bottom of the view.
 * The merge view makes each side as tall as its text and scrolls them together, so the sides'
 * own horizontal scrollbars lie under their last line; these bars stand in for them.
 */
export class DiffSides {
  readonly bars = document.createElement("div");
  private readonly splitter = document.createElement("div");
  private readonly sides: {
    view: EditorView;
    bar: HTMLDivElement;
    inner: HTMLDivElement;
  }[];
  private frame = 0;
  private readonly resize = new ResizeObserver(() => this.schedule());

  constructor(private readonly merge: MergeView) {
    const wrapA = merge.a.dom.parentElement!;
    this.splitter.className = "diff-splitter";
    this.splitter.setAttribute("role", "separator");
    this.splitter.setAttribute("aria-orientation", "vertical");
    this.splitter.setAttribute("aria-label", "Resize the comparison's sides");
    // Right of the old side, before the revert arrows if there are any.
    wrapA.after(this.splitter);
    this.splitter.addEventListener("pointerdown", this.press);
    this.splitter.addEventListener("dblclick", () => this.setShare(0.5));
    this.bars.className = "diff-hbars";
    this.sides = [merge.a, merge.b].map((view) => {
      const bar = document.createElement("div");
      bar.className = "diff-hbar";
      bar.setAttribute("aria-hidden", "true");
      const inner = document.createElement("div");
      bar.append(inner);
      this.bars.append(bar);
      bar.addEventListener("scroll", () => {
        if (view.scrollDOM.scrollLeft !== bar.scrollLeft)
          view.scrollDOM.scrollLeft = bar.scrollLeft;
      });
      view.scrollDOM.addEventListener("scroll", () => {
        if (bar.scrollLeft !== view.scrollDOM.scrollLeft)
          bar.scrollLeft = view.scrollDOM.scrollLeft;
      });
      this.resize.observe(view.scrollDOM);
      this.resize.observe(view.contentDOM);
      return { view, bar, inner };
    });
    this.apply();
  }

  private apply() {
    const [a, b] = [this.merge.a, this.merge.b].map(
      (v) => v.dom.parentElement!,
    );
    a.style.flexGrow = String(share);
    b.style.flexGrow = String(1 - share);
    this.schedule();
  }
  setShare(value: number) {
    share = clampShare(value);
    this.apply();
  }

  /** Places the bars under their sides, at the next frame. */
  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.place();
    });
  }
  private place() {
    if (!this.bars.isConnected) return;
    const origin = this.bars.getBoundingClientRect().left;
    let any = false;
    for (const { view, bar, inner } of this.sides) {
      const scroller = view.scrollDOM;
      const box = scroller.getBoundingClientRect();
      const wide = scroller.scrollWidth > scroller.clientWidth + 1;
      any ||= wide;
      bar.style.left = `${box.left - origin}px`;
      bar.style.width = `${scroller.clientWidth}px`;
      bar.style.visibility = wide ? "" : "hidden";
      inner.style.width = `${scroller.scrollWidth}px`;
      if (bar.scrollLeft !== scroller.scrollLeft)
        bar.scrollLeft = scroller.scrollLeft;
    }
    this.bars.hidden = !any;
  }

  private press = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const { splitter } = this;
    const editors = splitter.parentElement!;
    // The share counts the sides only: the line and the arrows between them keep their width.
    const fixed = [...editors.children].reduce(
      (sum, child) =>
        child === this.merge.a.dom.parentElement ||
        child === this.merge.b.dom.parentElement
          ? sum
          : sum + (child as HTMLElement).offsetWidth,
      0,
    );
    const box = editors.getBoundingClientRect();
    const sides = box.width - fixed;
    if (sides <= 0) return;
    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add("dragging");
    const grab = event.clientX - splitter.getBoundingClientRect().left;
    const move = (e: PointerEvent) =>
      this.setShare((e.clientX - grab - box.left) / sides);
    const end = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", end);
      splitter.removeEventListener("pointercancel", end);
      splitter.classList.remove("dragging");
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", end);
    splitter.addEventListener("pointercancel", end);
  };

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.splitter.remove();
    this.bars.remove();
  }
}
