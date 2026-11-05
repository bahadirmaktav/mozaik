import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";
import { syntaxTree } from "@codemirror/language";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { onTheme } from "../../workspace/themes";
import { gitChanges } from "./gitGutter";

/**
 * The Code Editor's minimap, after VS Code's: the code at a glance in the theme's colors, the
 * visible part as a slider, and the lines Git sees as changed along its left edge. A click or
 * a drag scrolls the code. Only the lines it shows are drawn, on a canvas outside the document.
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

/** The height of a line and of its marks, and the width of a character, in CSS pixels. */
const LINE = 3,
  MARK = 2,
  CHAR = 1.25,
  GIT_WIDTH = 2;
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
  firstLine: number;
  lastLine: number;
}
const minimapPlugin = (cpp: () => boolean) =>
  ViewPlugin.fromClass(
    class {
      dom = document.createElement("div");
      canvas = document.createElement("canvas");
      slider = document.createElement("div");
      /** The lines scrolled out of the top of the minimap, in pixels. */
      offset = 0;
      queued = false;
      forgetTheme: () => void;
      onScroll = () => this.schedule();

      constructor(readonly view: EditorView) {
        this.dom.className = "cm-minimap";
        this.dom.setAttribute("aria-hidden", "true");
        this.slider.className = "cm-minimap-slider";
        this.dom.append(this.canvas, this.slider);
        view.dom.appendChild(this.dom);
        view.scrollDOM.addEventListener("scroll", this.onScroll);
        this.dom.addEventListener("pointerdown", this.press);
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
        let next = 0;
        const columns = Math.floor((g.width - GIT_WIDTH) / CHAR);
        const tabSize = state.tabSize;
        context.globalAlpha = 0.75;
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
              GIT_WIDTH + 1 + runStart * CHAR,
              y,
              (end - runStart) * CHAR,
              MARK,
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
        // Git's changes along the left edge, as beside the line numbers.
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
          context.fillRect(0, top, GIT_WIDTH, Math.max(MARK, bottom - top));
        }
        slider.style.top = `${(g.firstLine - 1) * LINE - this.offset}px`;
        slider.style.height = `${Math.max(
          12,
          (g.lastLine - g.firstLine + 1) * LINE,
        )}px`;
      }
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
      }
    },
  );

/** `cpp` says whether the file uses the C++ highlighting colors. */
export const minimap = (cpp: () => boolean) => [
  minimapPlugin(cpp),
  EditorView.editorAttributes.of({ class: "cm-with-minimap" }),
];
