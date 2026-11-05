import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { syntaxTree } from "@codemirror/language";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { onTheme } from "../../workspace/themes";
import { gitChanges } from "./gitGutter";

/**
 * The Code Editor's minimap, after VS Code's: the code as faint lines in the theme's colors, the
 * visible part as a slider, and the lines Git sees as changed as colored bands, which are what it
 * is mostly read for. A click or a drag scrolls the code. Only the lines it shows are drawn, on a
 * canvas outside the document. A native scrollbar can only lie inside the scroller, on the code's
 * side of the minimap, so with a minimap the code's vertical scrollbar is this plugin's own.
 */
let shown = true;
const listeners = new Set<() => void>();
/** From Workspace Settings → IDE → Editor. */
export function setMinimapEnabled(value: boolean) {
  if (value === shown) return;
  shown = value;
  listeners.forEach((fn) => fn());
}
export const minimapEnabled = () => shown;
export function onMinimap(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The height of a line and of its text, and the width of a character, in CSS pixels. */
const LINE = 3,
  TEXT = 1,
  CHAR = 1.25,
  GIT_WIDTH = 3,
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
        this.forgetTheme = onTheme(() => this.schedule());
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
          read: (view): Geometry => {
            const scroll = view.scrollDOM;
            const doc = view.state.doc;
            const lineAt = (height: number) =>
              doc.lineAt(view.lineBlockAtHeight(height).from).number;
            return {
              width: this.dom.clientWidth,
              height: this.dom.parentElement!.clientHeight - scroll.offsetTop,
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
            this.draw(geometry);
          },
        });
      }
      draw(g: Geometry) {
        const { view, canvas, slider } = this;
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
        const style = getComputedStyle(view.dom);
        const color = (name: string, fallback: string) =>
          style.getPropertyValue(name).trim() || fallback;
        const text = color("--text", "#888");
        const palette = new Map<Token, string>();
        const useCpp = cpp();
        for (const token of TOKENS)
          palette.set(
            token,
            (useCpp && style.getPropertyValue(`--cpp-${token}`).trim()) ||
              color(`--syntax-${token}`, text),
          );
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
              y + 1,
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
        const scroll = (clientY: number) => {
          const y = clientY - bar.getBoundingClientRect().top - grab;
          const scroller = view.scrollDOM;
          scroller.scrollTop =
            this.travel > 0
              ? (y / this.travel) *
                (scroller.scrollHeight - scroller.clientHeight)
              : 0;
        };
        scroll(event.clientY);
        bar.setPointerCapture(event.pointerId);
        bar.classList.add("cm-dragging");
        const move = (e: PointerEvent) => scroll(e.clientY);
        const end = () => {
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
      /** Scrolls so the line under the pointer is in the middle of the view. */
      scrollTo(clientY: number) {
        const { view } = this;
        const y = clientY - this.dom.getBoundingClientRect().top;
        const number = Math.min(
          view.state.doc.lines,
          Math.max(1, Math.floor((y + this.offset) / LINE) + 1),
        );
        const block = view.lineBlockAt(view.state.doc.line(number).from);
        view.scrollDOM.scrollTop = block.top - view.scrollDOM.clientHeight / 2;
      }
      press = (event: PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const { dom } = this;
        dom.setPointerCapture(event.pointerId);
        this.scrollTo(event.clientY);
        const move = (e: PointerEvent) => this.scrollTo(e.clientY);
        const end = () => {
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
