import { useEffect, useRef, useState, type PointerEvent } from "react";
import { EditorState } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import type { ViewProps } from "../contract";
import { Dialog } from "../../components/Dialog";
import { Menu, type MenuItem } from "../../components/Menu";
import { MoreIcon } from "../../components/Icons";
import { drawingsBackend } from "../../services/drawings";
import { theme } from "../text-editor/theme";
import {
  content,
  diagramFiles as files,
  dirty,
  STARTER,
  viewState,
} from "./diagrams";
import { errorText, pngFile, renderDiagram, svgFile, svgSize } from "./render";
import { PanZoom } from "../../components/PanZoom";
import { useCommands } from "../../workspace/commands";

const RENDER_DELAY = 300;
const MIN_PANE = 120;
const live = new Map<string, EditorView>();

function editorState(text: string) {
  return EditorState.create({
    doc: text,
    extensions: [
      lineNumbers(),
      drawSelection(),
      history(),
      highlightActiveLine(),
      EditorState.allowMultipleSelections.of(false),
      keymap.of([
        ...defaultKeymap.filter((k) => !k.key?.includes("Mod-Alt")),
        ...historyKeymap,
        indentWithTab,
      ]),
      theme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        "aria-label": "Mermaid source",
        spellcheck: "false",
      }),
    ],
  });
}
const source = (id: string) => content(files.get(id)) ?? STARTER;
/** The store reloads a clean diagram from disk through this runtime. */
function register(id: string) {
  files.registerRuntime(id, {
    // Text reaches the store on every edit; nothing is pending.
    flush() {},
    reload(text) {
      const state = editorState(text);
      viewState(id).editor = state;
      live.get(id)?.setState(state);
    },
    dispose() {
      live.get(id)?.destroy();
      live.delete(id);
    },
  });
}

type Preview = { svg: string | null; error: string | null; busy: boolean };
export default function DiagramView({ instanceId, focused }: ViewProps) {
  const diagram = files.useOne(instanceId);
  const commands = useCommands("Mermaid", instanceId, focused);
  const split = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => viewState(instanceId).ratio);
  const [vertical, setVertical] = useState(false);
  const [preview, setPreview] = useState<Preview>({
    svg: null,
    error: null,
    busy: true,
  });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmReload, setConfirmReload] = useState(false);
  const text = diagram ? (content(diagram) ?? STARTER) : "";

  useEffect(() => {
    register(instanceId);
    const view = new EditorView({
      state: viewState(instanceId).editor ?? editorState(source(instanceId)),
      parent: host.current!,
      dispatch: (transaction) => {
        view.update([transaction]);
        viewState(instanceId).editor = view.state;
        if (transaction.docChanged)
          files.setText(instanceId, view.state.doc.toString());
      },
    });
    live.set(instanceId, view);
    if (focused) view.focus();
    return () => {
      if (files.has(instanceId)) viewState(instanceId).editor = view.state;
      if (live.get(instanceId) === view) live.delete(instanceId);
      view.destroy();
    };
  }, [instanceId]);
  useEffect(() => {
    if (focused) live.get(instanceId)?.focus();
  }, [focused, instanceId]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setVertical(entry.contentRect.width < 520),
    );
    observer.observe(split.current!);
    return () => observer.disconnect();
  }, []);
  // Renders after typing pauses. A newer source always wins over a slower older render.
  const latest = useRef(0);
  useEffect(() => {
    const token = ++latest.current;
    setPreview((p) => ({ ...p, busy: true }));
    const timer = setTimeout(
      () => {
        renderDiagram(text).then(
          ({ svg }) => {
            if (latest.current === token)
              setPreview({ svg, error: null, busy: false });
          },
          (error) => {
            // The last good diagram stays visible, marked as outdated.
            if (latest.current === token)
              setPreview((p) => ({
                svg: p.svg,
                error: errorText(error) || "The diagram could not be drawn.",
                busy: false,
              }));
          },
        );
      },
      preview.svg === null && !preview.error ? 0 : RENDER_DELAY,
    );
    return () => clearTimeout(timer);
  }, [text]);

  if (!diagram) return null;
  const report = (error: unknown) => files.reportError(error);
  const save = (as: boolean) => void files.save(instanceId, as).catch(report);
  async function exportAs(format: "svg" | "png") {
    try {
      if (!preview.svg || preview.error)
        throw new Error("Fix the diagram before exporting it.");
      const blob =
        format === "svg" ? svgFile(preview.svg) : await pngFile(preview.svg);
      await drawingsBackend.export(
        blob,
        `${files.baseName(diagram!.name)}.${format}`,
        format,
      );
    } catch (error) {
      report(error);
    }
  }
  async function reload() {
    setConfirmReload(false);
    const path = files.get(instanceId).path;
    if (path) files.reload(instanceId, await drawingsBackend.read(path));
  }
  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const box = split.current!.getBoundingClientRect();
    const total = vertical ? box.height : box.width;
    const position = vertical
      ? event.clientY - box.top
      : event.clientX - box.left;
    setShare(position / total, total);
  }
  function setShare(value: number, total: number) {
    const min = Math.min(0.5, MIN_PANE / Math.max(total, 1));
    const next = Math.max(min, Math.min(1 - min, value));
    viewState(instanceId).ratio = next;
    setRatio(next);
  }
  const items: MenuItem[] = [
    {
      label: "Open…",
      shortcut: "Ctrl+O",
      action: () => files.requestOpen(null),
    },
    { label: "Save", shortcut: "Ctrl+S", action: () => save(false) },
    {
      label: "Save as…",
      shortcut: "Ctrl+Shift+S",
      action: () => save(true),
    },
    "separator",
    {
      label: "Export SVG…",
      disabled: !preview.svg || !!preview.error,
      action: () => void exportAs("svg"),
    },
    {
      label: "Export PNG…",
      disabled: !preview.svg || !!preview.error,
      action: () => void exportAs("png"),
    },
  ];
  commands.current = items;
  return (
    <div className="diagram">
      <div className="diagram-bar">
        <span className="diagram-status muted">
          {diagram.path
            ? diagram.saving
              ? "Saving…"
              : diagram.conflict || diagram.error
                ? "Not saved"
                : dirty(diagram)
                  ? "Modified"
                  : "Saved"
            : "Not saved yet · Ctrl+S to choose a file"}
        </span>
        <button
          aria-label="Diagram actions"
          title="Diagram actions"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu(menu ? null : { x: rect.right - 220, y: rect.bottom + 4 });
          }}
        >
          <MoreIcon />
        </button>
      </div>
      {diagram.conflict ? (
        <div className="drawing-alert" role="alert">
          <span>{diagram.conflict}</span>
          <button onClick={() => save(true)}>Save As</button>
          <button
            onClick={() =>
              dirty(files.get(instanceId))
                ? setConfirmReload(true)
                : void reload().catch(report)
            }
          >
            Reload
          </button>
        </div>
      ) : (
        diagram.error && (
          <div className="drawing-alert" role="alert">
            <span>Not saved: {diagram.error}</span>
            <button onClick={() => save(false)}>Retry</button>
            <button onClick={() => save(true)}>Save As</button>
          </div>
        )
      )}
      <div
        className={`diagram-split ${vertical ? "vertical" : ""}`}
        ref={split}
      >
        <div
          className="diagram-source"
          ref={host}
          style={{ flexBasis: `${ratio * 100}%` }}
        />
        <div
          className="diagram-splitter"
          role="separator"
          tabIndex={0}
          aria-label="Resize source and preview"
          aria-orientation={vertical ? "horizontal" : "vertical"}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={resize}
          onKeyDown={(e) => {
            const back = vertical ? "ArrowUp" : "ArrowLeft",
              forward = vertical ? "ArrowDown" : "ArrowRight";
            if (e.key !== back && e.key !== forward) return;
            e.preventDefault();
            const box = split.current!.getBoundingClientRect();
            setShare(
              ratio + (e.key === back ? -0.05 : 0.05),
              vertical ? box.height : box.width,
            );
          }}
        />
        <div className="diagram-preview" aria-label="Diagram preview">
          {preview.error && (
            <div className="diagram-error" role="alert">
              <strong>Syntax error</strong>
              <pre>{preview.error}</pre>
            </div>
          )}
          {preview.svg ? (
            <PanZoom
              size={svgSize(preview.svg)}
              memory={viewState(instanceId)}
              label="Diagram"
            >
              <div
                className={`diagram-svg ${preview.error ? "stale" : ""}`}
                // Mermaid's strict security level sanitizes the markup with DOMPurify.
                dangerouslySetInnerHTML={{ __html: preview.svg }}
              />
            </PanZoom>
          ) : (
            !preview.error && (
              <p className="muted diagram-empty">
                {preview.busy ? "Rendering…" : ""}
              </p>
            )
          )}
        </div>
      </div>
      {menu && (
        <Menu
          label="Diagram actions"
          items={items}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
      {confirmReload && (
        <Dialog title="Reload diagram" onCancel={() => setConfirmReload(false)}>
          <p>Discard your unsaved changes and load the version on disk?</p>
          <div className="dialog-actions">
            <button onClick={() => void reload().catch(report)}>Reload</button>
            <button onClick={() => setConfirmReload(false)}>Cancel</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
