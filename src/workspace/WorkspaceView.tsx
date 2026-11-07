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
  collapsedDock,
  dockOf,
  gapOf,
  geometry,
  groupRoot,
  minimum,
  type Workspace,
  type Floating,
  type Node,
  type Panel,
  type Action,
  type Rect,
  type Edge,
  type Limits,
} from "./model";
import { PluginBoundary } from "../components/PluginBoundary";
import {
  CloseIcon,
  DockIcon,
  MaximizeIcon,
  PlusIcon,
} from "../components/Icons";
import { Menu, type MenuItem } from "../components/Menu";
import { InlineName } from "../components/InlineName";

const views = new Map([...registry].map(([id, p]) => [id, lazy(p.loadView)]));
type Props = {
  state: Workspace;
  bounds: Rect;
  control: boolean;
  limits: Limits;
  dispatch: (a: Action) => boolean;
  close: (ids: string[]) => void;
  /** Whether a tab, alone or not in its panel, offers to close; by default every one does. */
  closable?: (tabId: string, count: number) => boolean;
  /** The header's close button for a panel whose active tab is not `closable`, such as a
   * Text Editor's page, which closes the panel; without it the button is left out. */
  closePanel?: (panel: Panel) => (() => void) | null;
  /** Splits a tab into a new panel on that side; without it the tab menu has no Split. */
  split?: (tabId: string, axis: "x" | "y") => void;
  /** Whether `split` can act on a tab of a panel with `count` tabs. */
  splittable?: (tabId: string, count: number) => boolean;
  /** Adds a new tab to a panel whose active tab `canAdd` accepts (from its + or a double
   * click on its tab strip). */
  addTab?: (panelId: string) => void;
  /** The menu of such a panel's + (it may load first); without it the + adds a tab at once. */
  addItems?: (panelId: string) => MenuItem[] | Promise<MenuItem[]>;
  /** The name of a panel's + and its menu. */
  addLabel?: (panelId: string) => string;
  canAdd?: (tabId: string) => boolean;
  /** Shown at the left of a panel's content, such as a Text Editor panel's folder. */
  aside?: (panelId: string, tabId: string) => React.ReactNode;
  /** Buttons of a panel's header, before its own (the IDE's coding agents). */
  tools?: (panel: Panel) => React.ReactNode;
  /** Tabs left out of the tab strip (the IDE's empty code area). */
  hidden?: (tabId: string) => boolean;
};
type Drag = {
  panel: string;
  tab?: string;
  x: number;
  y: number;
  started: boolean;
};
type Target = { panel: string; edge?: Edge; index?: number };
/** A floating panel being moved (`dir` empty) or resized from the edges in `dir`. */
type Frame = {
  panel: Panel;
  dir: string;
  x: number;
  y: number;
  rect: Rect;
};
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
function targetAt(x: number, y: number): Target | null {
  const element = document.elementFromPoint(x, y);
  const panel = element?.closest<HTMLElement>("[data-panel]");
  if (!panel) return null;
  const rect = panel.getBoundingClientRect(),
    px = (x - rect.left) / rect.width,
    py = (y - rect.top) / rect.height;
  const tab = element?.closest<HTMLElement>("[data-tab-index]");
  // A floating panel takes tabs, but has no edges to split at.
  const edge =
    tab || panel.dataset.floating
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
  closable = () => true,
  closePanel = () => null,
  split,
  splittable = () => false,
  addTab,
  addItems,
  addLabel = () => "New File or Open File",
  canAdd = () => false,
  aside,
  tools,
  hidden = () => false,
}: Props) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubscribe = [...registry.values()].map((p) => p.subscribe(refresh));
    return () => unsubscribe.forEach((fn) => fn());
  }, []);
  const drag = useRef<Drag | null>(null),
    frame = useRef<Frame | null>(null);
  const [preview, setPreview] = useState<Target | null>(null);
  const [tabMenu, setTabMenu] = useState<{
    panel: Panel;
    tab: string;
    x: number;
    y: number;
  } | null>(null);
  const [addMenu, setAddMenu] = useState<{
    label: string;
    items: MenuItem[];
    x: number;
    y: number;
  } | null>(null);
  // A tab named in place (from its menu's Rename).
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The tab menu, as in VS Code: close this, the others or all, or split it off. */
  function tabItems(panel: Panel, tab: string): MenuItem[] {
    const count = panel.tabs.length;
    const others = panel.tabs
      .map((t) => t.id)
      .filter((id) => id !== tab && closable(id, count));
    const plugin = registry.get(
      panel.tabs.find((t) => t.id === tab)?.plugin ?? "",
    );
    const items: MenuItem[] = [
      ...(plugin?.rename
        ? ([
            { label: "Rename", action: () => setRenaming(tab) },
            "separator",
          ] as MenuItem[])
        : []),
      {
        label: "Close",
        disabled: !closable(tab, count),
        action: () => close([tab]),
      },
      {
        label: "Close Others",
        disabled: !others.length,
        action: () => close(others),
      },
      {
        label: "Close All",
        disabled: !others.length && !closable(tab, count),
        action: () =>
          close(
            panel.tabs.map((t) => t.id).filter((id) => closable(id, count)),
          ),
      },
    ];
    if (split)
      items.push(
        "separator",
        {
          label: "Split Right",
          disabled: !splittable(tab, count),
          action: () => split(tab, "x"),
        },
        {
          label: "Split Down",
          disabled: !splittable(tab, count),
          action: () => split(tab, "y"),
        },
      );
    return items;
  }
  const maximizedPanel =
    state.maximized &&
    (findPanel(state.root, state.maximized) ??
      state.floating.find((f) => f.panel.id === state.maximized)?.panel);
  // Editor groups maximize together: they are one Text Editor panel.
  const maximized =
    maximizedPanel &&
    (groupRoot(state.root, maximizedPanel.id) ?? maximizedPanel);
  const rects = geometry(
    maximized && maximized.kind === "split" ? maximized : state.root,
    bounds,
    limits,
  );
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
  function beginFrame(event: PointerEvent, floating: Floating, dir = "") {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    frame.current = {
      panel: floating.panel,
      dir,
      x: event.clientX,
      y: event.clientY,
      rect: shown(floating.rect),
    };
  }
  /** Keeps a floating panel's header reachable inside the workspace area. */
  function shown(rect: Rect): Rect {
    return {
      ...rect,
      x: Math.max(80 - rect.width, Math.min(bounds.width - 80, rect.x)),
      y: Math.max(0, Math.min(bounds.height - 30, rect.y)),
    };
  }
  function moveFrame(event: PointerEvent, f: Frame) {
    const dx = event.clientX - f.x,
      dy = event.clientY - f.y,
      min = minimum(f.panel, limits);
    let { x, y, width, height } = f.rect;
    if (!f.dir) {
      x += dx;
      y += dy;
    }
    if (f.dir.includes("e")) width = Math.max(min.width, width + dx);
    if (f.dir.includes("s")) height = Math.max(min.height, height + dy);
    if (f.dir.includes("w")) {
      width = Math.max(min.width, width - dx);
      x = f.rect.x + f.rect.width - width;
    }
    if (f.dir.includes("n")) {
      height = Math.max(min.height, height - dy);
      y = f.rect.y + f.rect.height - height;
    }
    dispatch({
      type: "float",
      panelId: f.panel.id,
      rect: shown({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      }),
    });
  }
  function move(event: PointerEvent) {
    if (frame.current) return moveFrame(event, frame.current);
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
    if (frame.current) {
      frame.current = null;
      return;
    }
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
  function render(node: Node, floating?: Floating, z = 0): React.ReactNode {
    if (node.kind === "panel") {
      const tab = node.tabs.find((t) => t.id === node.active)!,
        View = views.get(tab.plugin)!;
      // A docked tool draws its own bar; it moves from anywhere while Ctrl+Shift is held.
      const docked = !!dockOf(node, limits);
      const adds = !!addTab && canAdd(node.active);
      const closeHere = closePanel(node);
      return (
        <section
          key={node.id}
          data-panel={node.id}
          data-floating={floating ? "true" : undefined}
          data-plugin={tab.plugin}
          className={`panel ${state.focused === node.id ? "focused" : ""}${docked ? " docked" : ""}${node.collapsed ? " collapsed" : ""}${floating ? " floating" : ""}`}
          style={
            floating && {
              zIndex: z + 1,
              left: shown(floating.rect).x,
              top: shown(floating.rect).y,
              width: floating.rect.width,
              height: floating.rect.height,
            }
          }
          onPointerDownCapture={(e) => {
            if (state.focused !== node.id)
              dispatch({ type: "activate", panelId: node.id });
            if (docked && control) begin(e, node);
          }}
        >
          {!docked && (
            <header
              className="panel-header"
              // A floating panel moves by its header, like a window.
              onPointerDown={(e) => {
                if (
                  floating &&
                  (e.target === e.currentTarget ||
                    (e.target as Element).classList.contains("tabs"))
                )
                  beginFrame(e, floating);
              }}
              // A double click on the free part of the tab strip adds a tab, as in VS Code.
              onDoubleClick={(e) => {
                const target = e.target as Element;
                if (
                  adds &&
                  (target === e.currentTarget ||
                    target.classList.contains("tabs"))
                )
                  addTab!(node.id);
              }}
            >
              <button
                className="panel-grip"
                aria-label="Move panel"
                title={
                  floating
                    ? "Drag to move this floating panel"
                    : "Hold Ctrl+Shift to move this panel"
                }
                onPointerDown={(e) =>
                  floating ? beginFrame(e, floating) : begin(e, node)
                }
              >
                ⠿
              </button>
              <div className="tabs" role="tablist" aria-label="Panel tabs">
                {node.tabs.map((t, index) =>
                  hidden(t.id) ? null : (
                    <div
                      key={t.id}
                      role="presentation"
                      className={`tab${t.id === node.active ? " selected" : ""}`}
                      data-tab-index={index}
                      // The middle button closes a tab; its autoscroll never starts,
                      // and on Linux its release does not paste the primary selection
                      // into the focused editor.
                      onMouseDown={(e) => {
                        if (e.button === 1) e.preventDefault();
                      }}
                      onMouseUp={(e) => {
                        if (e.button === 1) e.preventDefault();
                      }}
                      onAuxClick={(e) => {
                        if (e.button !== 1) return;
                        e.preventDefault();
                        if (closable(t.id, node.tabs.length)) close([t.id]);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTabMenu({
                          panel: node,
                          tab: t.id,
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                    >
                      {renaming === t.id ? (
                        <InlineName
                          label="Tab name"
                          initial={registry.get(t.plugin)!.title(t.id)}
                          submit={async (name) => {
                            registry.get(t.plugin)!.rename?.(t.id, name);
                            return null;
                          }}
                          onDone={() => setRenaming(null)}
                        />
                      ) : (
                        <button
                          role="tab"
                          aria-selected={t.id === node.active}
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
                      )}
                      {closable(t.id, node.tabs.length) && (
                        <button
                          type="button"
                          className="tab-close"
                          tabIndex={-1}
                          aria-label={`Close ${registry.get(t.plugin)!.title(t.id)}`}
                          title="Close"
                          onClick={() => close([t.id])}
                        >
                          <CloseIcon />
                        </button>
                      )}
                    </div>
                  ),
                )}
              </div>
              <div className="panel-actions">
                {tools?.(node)}
                {adds && (
                  <button
                    title={addItems ? addLabel(node.id) : "New File"}
                    aria-label={addItems ? addLabel(node.id) : "New File"}
                    aria-haspopup={addItems ? "menu" : undefined}
                    onClick={(e) => {
                      if (!addItems) return addTab!(node.id);
                      const rect = e.currentTarget.getBoundingClientRect();
                      const label = addLabel(node.id);
                      void Promise.resolve(addItems(node.id)).then((items) =>
                        setAddMenu({
                          label,
                          items,
                          x: rect.left,
                          y: rect.bottom,
                        }),
                      );
                    }}
                  >
                    <PlusIcon />
                  </button>
                )}
                {floating && (
                  <button
                    title="Dock panel"
                    aria-label="Dock panel"
                    onClick={() =>
                      dispatch({
                        type: "dock",
                        panelId: node.id,
                        splitId: crypto.randomUUID(),
                      })
                    }
                  >
                    <DockIcon />
                  </button>
                )}
                <button
                  title="Maximize / restore panel"
                  aria-label="Maximize panel"
                  onClick={() =>
                    dispatch({ type: "maximize", panelId: node.id })
                  }
                >
                  <MaximizeIcon />
                </button>
                {closable(node.active, node.tabs.length) ? (
                  <button
                    title="Close active tab"
                    aria-label="Close tab"
                    onClick={() => close([node.active])}
                  >
                    <CloseIcon />
                  </button>
                ) : (
                  closeHere && (
                    <button
                      title="Close panel"
                      aria-label="Close panel"
                      onClick={closeHere}
                    >
                      <CloseIcon />
                    </button>
                  )
                )}
              </div>
            </header>
          )}
          {wrap(
            aside?.(node.id, tab.id),
            <div className="panel-content" data-plugin={tab.plugin}>
              <PluginBoundary key={tab.id}>
                <Suspense fallback={null}>
                  <View
                    instanceId={tab.id}
                    focused={state.focused === node.id}
                    {...(docked && {
                      collapsed: !!node.collapsed,
                      onCollapse: (collapsed: boolean) =>
                        dispatch({
                          type: "collapse",
                          panelId: node.id,
                          collapsed,
                        }),
                    })}
                  />
                </Suspense>
              </PluginBoundary>
            </div>,
          )}
          {preview?.panel === node.id && (
            <div className={`drop-preview ${preview.edge ?? "center"}`} />
          )}
          {floating &&
            EDGES.map((dir) => (
              <div
                key={dir}
                className={`float-resize ${dir}`}
                onPointerDown={(e) => beginFrame(e, floating, dir)}
              />
            ))}
        </section>
      );
    }
    const rect = rects.get(node.id)!,
      first = rects.get(node.first.id)!;
    const available =
      (node.axis === "x" ? rect.width : rect.height) - gapOf(node);
    // A side reduced to its bar has a fixed size: there is nothing to resize.
    const locked = [node.first, node.second].some(
      (n) => collapsedDock(n, limits)?.axis === node.axis,
    );
    return (
      <div
        key={node.id}
        className={`split ${node.axis}${node.group ? " group" : ""}`}
      >
        <div
          className="branch"
          style={{
            flex: `0 0 ${Math.max(0, node.axis === "x" ? first.width : first.height)}px`,
          }}
        >
          {render(node.first)}
        </div>
        {locked ? (
          <div className="splitter locked" />
        ) : (
          <div
            className="splitter"
            role="separator"
            tabIndex={0}
            aria-label={node.group ? "Resize editor groups" : "Resize panels"}
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
        )}
        <div className="branch" style={{ flex: 1 }}>
          {render(node.second)}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`layout ${control ? "control" : ""}`}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => {
        drag.current = null;
        frame.current = null;
        setPreview(null);
      }}
    >
      {maximized
        ? render(maximized)
        : [
            state.root && render(state.root),
            // In a stable order, so bringing one to the front moves no DOM node.
            ...[...state.floating]
              .sort((a, b) => (a.panel.id < b.panel.id ? -1 : 1))
              .map((f) => render(f.panel, f, state.floating.indexOf(f))),
          ]}
      {addMenu && (
        <Menu
          label={addMenu.label}
          items={addMenu.items}
          x={addMenu.x}
          y={addMenu.y}
          onClose={() => setAddMenu(null)}
        />
      )}
      {tabMenu && (
        <Menu
          label="Tab actions"
          items={tabItems(tabMenu.panel, tabMenu.tab)}
          x={tabMenu.x}
          y={tabMenu.y}
          onClose={() => setTabMenu(null)}
        />
      )}
    </div>
  );
}
/** A panel's content, with what `aside` shows at its left. */
function wrap(side: React.ReactNode, content: React.ReactNode) {
  if (!side) return content;
  return (
    <div className="panel-body">
      {side}
      {content}
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
