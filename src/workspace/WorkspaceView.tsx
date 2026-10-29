import {
  lazy,
  Suspense,
  useEffect,
  useReducer,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { registry } from "../plugins/registry";
import {
  apply,
  geometry,
  minimum,
  GAP,
  type Workspace,
  type Node,
  type Panel,
  type Action,
  type Rect,
  type Edge,
  type Limits,
} from "./model";
import { PluginBoundary } from "../components/PluginBoundary";
import { CloseIcon, MaximizeIcon } from "../components/Icons";

const views = new Map([...registry].map(([id, p]) => [id, lazy(p.loadView)]));
type Props = {
  state: Workspace;
  bounds: Rect;
  control: boolean;
  limits: Limits;
  dispatch: (a: Action) => boolean;
  close: (ids: string[]) => void;
};
type Drag = {
  panel: string;
  tab?: string;
  x: number;
  y: number;
  started: boolean;
};
type Target = { panel: string; edge?: Edge; index?: number };
function targetAt(x: number, y: number): Target | null {
  const element = document.elementFromPoint(x, y);
  const panel = element?.closest<HTMLElement>("[data-panel]");
  if (!panel) return null;
  const rect = panel.getBoundingClientRect(),
    px = (x - rect.left) / rect.width,
    py = (y - rect.top) / rect.height;
  const tab = element?.closest<HTMLElement>("[data-tab-index]");
  const edge = tab
    ? undefined
    : px < 0.2
      ? "left"
      : px > 0.8
        ? "right"
        : py < 0.2
          ? "top"
          : py > 0.8
            ? "bottom"
            : undefined;
  return {
    panel: panel.dataset.panel!,
    edge,
    index: tab ? Number(tab.dataset.tabIndex) : undefined,
  };
}
export function WorkspaceView({
  state,
  bounds,
  control,
  limits,
  dispatch,
  close,
}: Props) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubscribe = [...registry.values()].map((p) => p.subscribe(refresh));
    return () => unsubscribe.forEach((fn) => fn());
  }, []);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<Target | null>(null);
  const rects = geometry(state.root, bounds);
  function begin(event: PointerEvent, panel: Panel, tab?: string) {
    if (event.button !== 0 || (!tab && !control)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      panel: panel.id,
      tab,
      x: event.clientX,
      y: event.clientY,
      started: false,
    };
  }
  function move(event: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    d.started ||= Math.hypot(event.clientX - d.x, event.clientY - d.y) > 5;
    if (d.started) {
      const target = targetAt(event.clientX, event.clientY);
      if (!target) {
        setPreview(null);
        return;
      }
      try {
        const next = apply(
          state,
          {
            type: "drop",
            sourcePanel: d.panel,
            tabId: d.tab,
            targetPanel: target.panel,
            edge: target.edge,
            index: target.index,
            panelId: "__preview-panel",
            splitId: "__preview-split",
          },
          bounds,
          limits,
        );
        setPreview(next === state ? null : target);
      } catch {
        setPreview(null);
      }
    }
  }
  function end(event: PointerEvent) {
    const d = drag.current,
      target = targetAt(event.clientX, event.clientY);
    if (d?.started && target)
      dispatch({
        type: "drop",
        sourcePanel: d.panel,
        tabId: d.tab,
        targetPanel: target.panel,
        edge: target.edge,
        index: target.index,
        panelId: crypto.randomUUID(),
        splitId: crypto.randomUUID(),
      });
    drag.current = null;
    setPreview(null);
  }
  function render(node: Node): React.ReactNode {
    if (node.kind === "panel") {
      const tab = node.tabs.find((t) => t.id === node.active)!,
        View = views.get(tab.plugin)!;
      return (
        <section
          key={node.id}
          data-panel={node.id}
          className={`panel ${state.focused === node.id ? "focused" : ""}`}
          onPointerDownCapture={() => {
            if (state.focused !== node.id)
              dispatch({ type: "activate", panelId: node.id });
          }}
        >
          <header className="panel-header">
            <button
              className="panel-grip"
              aria-label="Move panel"
              title="Hold the workspace modifier to move this panel"
              onPointerDown={(e) => begin(e, node)}
            >
              ⠿
            </button>
            <div className="tabs" role="tablist" aria-label="Panel tabs">
              {node.tabs.map((t, index) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={t.id === node.active}
                  data-tab-index={index}
                  onPointerDown={(e) => begin(e, node, t.id)}
                  onClick={() =>
                    dispatch({
                      type: "activate",
                      panelId: node.id,
                      tabId: t.id,
                    })
                  }
                >
                  {registry.get(t.plugin)!.title(t.id)}
                  {registry.get(t.plugin)!.modified(t.id) ? " •" : ""}
                </button>
              ))}
            </div>
            <div className="panel-actions">
              <button
                title="Maximize / restore panel"
                aria-label="Maximize panel"
                onClick={() => dispatch({ type: "maximize", panelId: node.id })}
              >
                <MaximizeIcon />
              </button>
              <button
                title="Close active tab"
                aria-label="Close tab"
                onClick={() => close([node.active])}
              >
                <CloseIcon />
              </button>
            </div>
          </header>
          <div className="panel-content">
            <PluginBoundary key={tab.id}>
              <Suspense fallback={<p className="muted">Opening…</p>}>
                <View instanceId={tab.id} focused={state.focused === node.id} />
              </Suspense>
            </PluginBoundary>
          </div>
          {preview?.panel === node.id && (
            <div className={`drop-preview ${preview.edge ?? "center"}`} />
          )}
        </section>
      );
    }
    const rect = rects.get(node.id)!;
    const available = (node.axis === "x" ? rect.width : rect.height) - GAP;
    return (
      <div key={node.id} className={`split ${node.axis}`}>
        <div
          className="branch"
          style={{ flex: `0 0 ${Math.max(0, available * node.ratio)}px` }}
        >
          {render(node.first)}
        </div>
        <div
          className="splitter"
          role="separator"
          tabIndex={0}
          aria-label="Resize panels"
          aria-orientation={node.axis === "x" ? "vertical" : "horizontal"}
          aria-valuenow={Math.round(node.ratio * 100)}
          aria-valuemin={1}
          aria-valuemax={99}
          onKeyDown={(e) => {
            if (
              ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              dispatch({
                type: "resize",
                splitId: node.id,
                ratio:
                  node.ratio +
                  (["ArrowLeft", "ArrowUp"].includes(e.key) ? -0.02 : 0.02),
              });
            }
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const parent =
              e.currentTarget.parentElement!.getBoundingClientRect();
            const pos =
              node.axis === "x"
                ? e.clientX - parent.left
                : e.clientY - parent.top;
            const minA = minimum(node.first, limits),
              minB = minimum(node.second, limits);
            const lower =
              (node.axis === "x" ? minA.width : minA.height) / available;
            const upper =
              1 - (node.axis === "x" ? minB.width : minB.height) / available;
            if (lower <= upper)
              dispatch({
                type: "resize",
                splitId: node.id,
                ratio: Math.max(lower, Math.min(upper, pos / available)),
              });
          }}
        />
        <div className="branch" style={{ flex: 1 }}>
          {render(node.second)}
        </div>
      </div>
    );
  }
  const maximized = state.maximized && findPanel(state.root, state.maximized);
  return (
    <div
      className={`layout ${control ? "control" : ""}`}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
    >
      {state.root && render(maximized || state.root)}
    </div>
  );
}
function findPanel(root: Node | null, id: string): Panel | null {
  if (!root) return null;
  return root.kind === "panel"
    ? root.id === id
      ? root
      : null
    : (findPanel(root.first, id) ?? findPanel(root.second, id));
}
