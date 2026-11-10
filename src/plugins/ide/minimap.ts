import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { syntaxTree } from "@codemirror/language";
import { forEachDiagnostic } from "@codemirror/lint";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { onTheme } from "../../workspace/themes";
import { gitChanges } from "./gitGutter";

/**
 * The Code Editor's minimap, after VS Code's: the code as faint lines in the theme's colors, the
 * visible part as a slider, and the lines Git sees as changed and those with errors as colored
 * bands, which are what it is mostly read for. A click or a drag scrolls the code. Only the lines
 * it shows are drawn, on a canvas outside the document. A native scrollbar can only lie inside the
 * scroller, on the code's side of the minimap, so with a minimap the code's vertical scrollbar is
 * this plugin's own.
 */
let shown = true;
/** How large the code is drawn: 1 to 3 times the smallest size. */
let scale = 1;
let width = 72;
const listeners = new Set<() => void>();
/** From Workspace Settings → IDE → Editor: whether it is shown, its width and scale. */
export function setMinimap(value: {
  shown: boolean;
  width: number;
  scale: number;
}) {
  document.documentElement.style.setProperty(
    "--ide-minimap-width",
    `${value.width}px`,
  );
  if (value.shown === shown && value.scale === scale && value.width === width)
    return;
  shown = value.shown;
  scale = value.scale;
  width = value.width;
  listeners.forEach((fn) => fn());
}
export const minimapEnabled = () => shown;
export function onMinimap(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/**
 * The height of a line and of its text, and the width of a character, in CSS pixels at
 * scale 1.
 */
const LINE_1 = 3,
  TEXT_1 = 1,
  CHAR_1 = 1.25,
  GIT_WIDTH = 3,
  ERROR_WIDTH = 3,
  TEXT_ALPHA = 0.5,
  BAND_ALPHA = 0.25,
  MIN_THUMB = 24;
const TOKENS = [
  "keyword",
  "type",
  "function",
  "string",
  "number",
  "comment",
  "meta",
  "property",
] as const;
type Token = (typeof TOKENS)[number];
const classes = tagHighlighter([
  {
    tag: [
      tags.keyword,
      tags.modifier,
      tags.controlKeyword,
      tags.operatorKeyword,
    ],
    class: "keyword",
  },
  { tag: [tags.typeName, tags.className, tags.namespace], class: "type" },
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.macroName,
    ],
    class: "function",
  },
  {
    tag: [tags.string, tags.special(tags.string), tags.regexp],
    class: "string",
  },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "number" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    class: "comment",
  },
  { tag: [tags.processingInstruction, tags.meta], class: "meta" },
  { tag: [tags.propertyName, tags.attributeName], class: "property" },
]);

interface Geometry {
  width: number;
  height: number;
  top: number;
  scrollTop: number;
  range: number;
  client: number;
  firstLine: number;
  lastLine: number;
}
const minimapPlugin = (cpp: () => boolean) =>
  ViewPlugin.fromClass(
    class {
      dom = document.createElement("div");
      canvas = document.createElement("canvas");
      slider = document.createElement("div");
      bar = document.createElement("div");
      thumb = document.createElement("div");
      /** The thumb's height and the distance it travels, in pixels. */
      thumbHeight = 0;
      travel = 0;
      /** The lines scrolled out of the top of the minimap, in pixels. */
      offset = 0;
      queued = false;
      /** The scale's sizes, fixed for this plugin: a new scale sets the minimap up again. */
      LINE = LINE_1 * scale;
      TEXT = TEXT_1 * scale;
      CHAR = CHAR_1 * scale;
      /** The last geometry drawn, for drags. */
      geometry: Geometry | null = null;
      /** The scroll position a drag asks for, applied once per frame. */
      target: number | null = null;
      frame = 0;
      /** The theme's colors, read again when the theme changes. */
      palette: { key: string; colors: Map<string, string> } | null = null;
      forgetTheme: () => void;
      onScroll = () => this.schedule();
      onWheel = (event: WheelEvent) => {
        this.view.scrollDOM.scrollTop += event.deltaY;
      };

      constructor(readonly view: EditorView) {
        this.dom.className = "cm-minimap";
        this.dom.setAttribute("aria-hidden", "true");
        this.slider.className = "cm-minimap-slider";
        this.dom.append(this.canvas, this.slider);
        this.bar.className = "cm-code-scrollbar";
        this.bar.setAttribute("aria-hidden", "true");
        this.thumb.className = "cm-code-scrollbar-thumb";
        this.bar.append(this.thumb);
        view.dom.append(this.dom, this.bar);
        view.scrollDOM.addEventListener("scroll", this.onScroll);
        this.dom.addEventListener("pointerdown", this.press);
        this.bar.addEventListener("pointerdown", this.pressBar);
        this.dom.addEventListener("wheel", this.onWheel, { passive: true });
        this.bar.addEventListener("wheel", this.onWheel, { passive: true });
        this.forgetTheme = onTheme(() => {
          this.palette = null;
          this.schedule();
        });
        this.schedule();
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.geometryChanged ||
          update.transactions.some((t) => t.effects.length) ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        )
          this.schedule();
      }
      schedule() {
        if (this.queued) return;
        this.queued = true;
        this.view.requestMeasure({
          read: (view): Geometry | null => {
            // Turned off or set up again since this was asked for.
            const parent = this.dom.parentElement;
            if (!parent) return null;
            const scroll = view.scrollDOM;
            const doc = view.state.doc;
            const lineAt = (height: number) =>
              doc.lineAt(view.lineBlockAtHeight(height).from).number;
            return {
              width: this.dom.clientWidth,
              height: parent.clientHeight - scroll.offsetTop,
              top: scroll.offsetTop,
              scrollTop: scroll.scrollTop,
              range: scroll.scrollHeight - scroll.clientHeight,
              client: scroll.clientHeight,
              firstLine: lineAt(scroll.scrollTop),
              lastLine: lineAt(scroll.scrollTop + scroll.clientHeight),
            };
          },
          write: (geometry) => {
            this.queued = false;
            if (geometry) this.draw(geometry);
          },
        });
      }
      draw(g: Geometry) {
        const { view, canvas, slider, LINE, TEXT, CHAR } = this;
        this.geometry = g;
        const { state } = view;
        this.dom.style.top = `${g.top}px`;
        this.drawBar(g);
        const ratio = window.devicePixelRatio || 1;
        const width = Math.round(g.width * ratio);
        const height = Math.round(g.height * ratio);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
          canvas.style.height = `${g.height}px`;
        }
        const context = canvas.getContext("2d");
        if (!context || !g.width || !g.height) return;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, g.width, g.height);
        const lines = state.doc.lines;
        const overflow = Math.max(0, lines * LINE - g.height);
        // The minimap scrolls along with the code, in proportion.
        this.offset = g.range > 0 ? overflow * (g.scrollTop / g.range) : 0;
        const first = Math.min(lines, Math.floor(this.offset / LINE) + 1);
        const last = Math.min(lines, first + Math.ceil(g.height / LINE));
        // Reading the theme's colors costs a style lookup, so not on every scroll.
        // The page sets the theme's colors inline, so they tell cheaply whether it changed.
        const useCpp = cpp();
        const root = document.documentElement.style;
        const key = [
          useCpp,
          root.getPropertyValue("--text"),
          root.getPropertyValue("--syntax-keyword"),
          root.getPropertyValue("--cpp-keyword"),
        ].join("|");
        if (this.palette?.key !== key) {
          const style = getComputedStyle(view.dom);
          const read = (name: string) => style.getPropertyValue(name).trim();
          const colors = new Map<string, string>();
          const base = read("--text") || "#888";
          colors.set("--text", base);
          for (const name of ["--success", "--syntax-function", "--error"])
            colors.set(name, read(name));
          for (const token of TOKENS)
            colors.set(
              token,
              (useCpp && read(`--cpp-${token}`)) ||
                read(`--syntax-${token}`) ||
                base,
            );
          this.palette = { key, colors };
        }
        const colors = this.palette.colors;
        const color = (name: string, fallback: string) =>
          colors.get(name) || fallback;
        const text = color("--text", "#888");
        const palette = colors as Map<Token, string>;
        const from = state.doc.line(first).from;
        const to = state.doc.line(last).to;
        const tokens: { from: number; to: number; token: Token }[] = [];
        highlightTree(
          syntaxTree(state),
          classes,
          (start, end, name) =>
            tokens.push({ from: start, to: end, token: name as Token }),
          from,
          to,
        );
        tokens.sort((a, b) => a.from - b.from);
        // Git's changes under the text, with a solid edge as beside the line numbers.
        const shades = {
          added: color("--success", "#9ccc9c"),
          modified: color("--syntax-function", "#8ab4f8"),
          deleted: color("--error", "#f28b82"),
        };
        for (const change of gitChanges(state)) {
          const top = (change.from - 1) * LINE - this.offset;
          const bottom = change.to * LINE - this.offset;
          if (bottom < 0 || top > g.height) continue;
          context.fillStyle = shades[change.kind];
          context.globalAlpha = BAND_ALPHA;
          context.fillRect(GIT_WIDTH, top, g.width - GIT_WIDTH, bottom - top);
          context.globalAlpha = 1;
          context.fillRect(0, top, GIT_WIDTH, bottom - top);
        }
        // Errors likewise, with their solid edge at the other side, which tells them from a
        // deletion of Git's in the same color.
        context.fillStyle = color("--error", "#f28b82");
        forEachDiagnostic(state, (diagnostic, start, end) => {
          if (diagnostic.severity !== "error") return;
          const top = (state.doc.lineAt(start).number - 1) * LINE - this.offset;
          const bottom = state.doc.lineAt(end).number * LINE - this.offset;
          if (bottom < 0 || top > g.height) return;
          context.globalAlpha = BAND_ALPHA;
          context.fillRect(0, top, g.width - ERROR_WIDTH, bottom - top);
          context.globalAlpha = 1;
          context.fillRect(
            g.width - ERROR_WIDTH,
            top,
            ERROR_WIDTH,
            bottom - top,
          );
        });
        let next = 0;
        const columns = Math.floor((g.width - GIT_WIDTH) / CHAR);
        const tabSize = state.tabSize;
        context.globalAlpha = TEXT_ALPHA;
        for (let number = first; number <= last; number++) {
          const line = state.doc.line(number);
          const y = (number - 1) * LINE - this.offset;
          while (next < tokens.length && tokens[next].to <= line.from) next++;
          let index = next;
          let column = 0;
          let runStart = -1;
          let runColor = "";
          const flush = (end: number) => {
            if (runStart < 0) return;
            context.fillStyle = runColor;
            context.fillRect(
              GIT_WIDTH + 2 + runStart * CHAR,
              y + TEXT,
              (end - runStart) * CHAR,
              TEXT,
            );
            runStart = -1;
          };
          for (let i = 0; i < line.length && column < columns; i++) {
            const code = line.text.charCodeAt(i);
            if (code === 32 || code === 9) {
              flush(column);
              column += code === 9 ? tabSize - (column % tabSize) : 1;
              continue;
            }
            const at = line.from + i;
            while (index < tokens.length && tokens[index].to <= at) index++;
            const token = tokens[index];
            const shade =
              token && token.from <= at ? palette.get(token.token)! : text;
            if (shade !== runColor) flush(column);
            if (runStart < 0) {
              runStart = column;
              runColor = shade;
            }
            column++;
          }
          flush(column);
        }
        context.globalAlpha = 1;
        slider.style.top = `${(g.firstLine - 1) * LINE - this.offset}px`;
        slider.style.height = `${Math.max(
          12,
          (g.lastLine - g.firstLine + 1) * LINE,
        )}px`;
      }
      drawBar(g: Geometry) {
        const { bar, thumb } = this;
        bar.style.top = `${g.top}px`;
        thumb.hidden = g.range <= 0;
        this.thumbHeight = Math.min(
          g.height,
          Math.max(MIN_THUMB, (g.height * g.client) / (g.range + g.client)),
        );
        this.travel = g.height - this.thumbHeight;
        thumb.style.height = `${this.thumbHeight}px`;
        thumb.style.top = `${g.range > 0 ? this.travel * (g.scrollTop / g.range) : 0}px`;
      }
      /** A press on the track brings the thumb there; either way the thumb follows the drag. */
      pressBar = (event: PointerEvent) => {
        if (event.button !== 0 || this.thumb.hidden) return;
        event.preventDefault();
        const { bar, thumb, view } = this;
        const grab =
          event.target === thumb
            ? event.clientY - thumb.getBoundingClientRect().top
            : this.thumbHeight / 2;
        const top = bar.getBoundingClientRect().top;
        const scroller = view.scrollDOM;
        const range = scroller.scrollHeight - scroller.clientHeight;
        const scroll = (clientY: number) =>
          this.scrollLater(
            this.travel > 0
              ? ((clientY - top - grab) / this.travel) * range
              : 0,
          );
        scroll(event.clientY);
        bar.setPointerCapture(event.pointerId);
        bar.classList.add("cm-dragging");
        const move = (e: PointerEvent) => scroll(e.clientY);
        const end = () => {
          this.flush();
          bar.removeEventListener("pointermove", move);
          bar.removeEventListener("pointerup", end);
          bar.removeEventListener("pointercancel", end);
          bar.classList.remove("cm-dragging");
          view.focus();
        };
        bar.addEventListener("pointermove", move);
        bar.addEventListener("pointerup", end);
        bar.addEventListener("pointercancel", end);
      };
      /**
       * Scrolls the code at the next frame: pointer events can come faster than frames, and
       * each scroll lays the editor out again.
       */
      scrollLater(top: number) {
        this.target = top;
        if (!this.frame)
          this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.flush();
          });
      }
      flush() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.frame = 0;
        if (this.target !== null) this.view.scrollDOM.scrollTop = this.target;
        this.target = null;
      }
      /** The scroll position that puts the line under the pointer in the middle of the view. */
      centered(clientY: number) {
        const { view, LINE } = this;
        const y = clientY - this.dom.getBoundingClientRect().top;
        const number = Math.min(
          view.state.doc.lines,
          Math.max(1, Math.floor((y + this.offset) / LINE) + 1),
        );
        const block = view.lineBlockAt(view.state.doc.line(number).from);
        return block.top - view.scrollDOM.clientHeight / 2;
      }
      /**
       * As in VS Code: a press outside the slider brings that line to the middle, then the
       * drag moves the slider with the pointer. The minimap scrolls along with the code, so
       * following the line under the pointer instead jumps back and forth.
       */
      press = (event: PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const { dom, view, slider } = this;
        dom.setPointerCapture(event.pointerId);
        const scroller = view.scrollDOM;
        const range = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight,
        );
        const rect = slider.getBoundingClientRect();
        const onSlider =
          event.clientY >= rect.top && event.clientY <= rect.bottom;
        const start = onSlider
          ? scroller.scrollTop
          : Math.max(0, Math.min(range, this.centered(event.clientY)));
        if (!onSlider) this.scrollLater(start);
        // How far the slider moves for each pixel the code scrolls (see `draw`).
        const g = this.geometry;
        const overflow = g
          ? Math.max(0, view.state.doc.lines * this.LINE - g.height)
          : 0;
        const perPixel =
          this.LINE / view.defaultLineHeight -
          (range > 0 ? overflow / range : 0);
        const from = event.clientY;
        const move = (e: PointerEvent) => {
          if (perPixel <= 0) return;
          this.scrollLater(
            Math.max(0, Math.min(range, start + (e.clientY - from) / perPixel)),
          );
        };
        const end = () => {
          this.flush();
          dom.removeEventListener("pointermove", move);
          dom.removeEventListener("pointerup", end);
          dom.removeEventListener("pointercancel", end);
          this.view.focus();
        };
        dom.addEventListener("pointermove", move);
        dom.addEventListener("pointerup", end);
        dom.addEventListener("pointercancel", end);
      };
      destroy() {
        if (this.frame) cancelAnimationFrame(this.frame);
        this.forgetTheme();
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
        this.dom.remove();
        this.bar.remove();
      }
    },
  );

/** `cpp` says whether the file uses the C++ highlighting colors. */
export const minimap = (cpp: () => boolean) => [
  minimapPlugin(cpp),
  EditorView.editorAttributes.of({ class: "cm-with-minimap" }),
];
