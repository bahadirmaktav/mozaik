/** All geometry is in CSS pixels. No DOM, IPC, clocks or random IDs in this module. */
export type Axis = "x" | "y";
export type Edge = "left" | "right" | "top" | "bottom";
export type Rect = { x: number; y: number; width: number; height: number };
export type Tab = { id: string; plugin: string };
export type Panel = {
  kind: "panel";
  id: string;
  tabs: Tab[];
  active: string;
  /** A docked panel reduced to its bar (see `Dock`). */
  collapsed?: boolean;
};
export type Split = {
  kind: "split";
  id: string;
  axis: Axis;
  ratio: number;
  first: Node;
  second: Node;
  /**
   * Editor groups inside one Text Editor panel, as in Sublime Text: drawn as one panel
   * divided by a line. Other modules split around the outermost group, never inside it.
   */
  group?: boolean;
};
export type Node = Panel | Split;
/** A panel over the tiled layout, moved and resized freely; later ones are in front. */
export type Floating = { panel: Panel; rect: Rect };
export type Workspace = {
  root: Node | null;
  floating: Floating[];
  focused: string | null;
  maximized: string | null;
};
export type Minimum = { width: number; height: number };
/**
 * A docked tool panel, such as a sidebar or a status bar: always alone in its panel and
 * reducible to its bar, `size` pixels along `axis` of the split around it. A `fixed` one
 * always has that size.
 */
export type Dock = { axis: Axis; size: number; fixed?: boolean };
export type Limits = Record<string, Minimum & { dock?: Dock }>;
export const GAP = 6;
/** The line between editor groups. */
export const GROUP_GAP = 1;
export const gapOf = (node: Split) => (node.group ? GROUP_GAP : GAP);
export const emptyWorkspace = (): Workspace => ({
  root: null,
  floating: [],
  focused: null,
  maximized: null,
});

export function panels(root: Node | null): Panel[] {
  return !root
    ? []
    : root.kind === "panel"
      ? [root]
      : [...panels(root.first), ...panels(root.second)];
}
/** The tiled panels, then the floating ones from back to front. */
export function allPanels(state: Workspace): Panel[] {
  return [...panels(state.root), ...state.floating.map((f) => f.panel)];
}
export const isFloating = (state: Workspace, id: string) =>
  state.floating.some((f) => f.panel.id === id);
/** Replaces or (with null) removes a tiled or floating panel. */
function setPanel(state: Workspace, id: string, next: Panel | null): Workspace {
  if (isFloating(state, id))
    return {
      ...state,
      floating: next
        ? state.floating.map((f) =>
            f.panel.id === id ? { ...f, panel: next } : f,
          )
        : state.floating.filter((f) => f.panel.id !== id),
    };
  return { ...state, root: state.root && replace(state.root, id, next) };
}
export function replace(
  root: Node,
  id: string,
  next: Node | null,
): Node | null {
  if (root.id === id) return next;
  if (root.kind === "panel") return root;
  const first = replace(root.first, id, next),
    second = replace(root.second, id, next);
  return first && second ? { ...root, first, second } : (first ?? second);
}
/** The outermost editor group split holding `id`, if it is inside one. */
export function groupRoot(root: Node | null, id: string): Split | null {
  if (!root || root.kind === "panel") return null;
  if (root.group && contains(root, id)) return root;
  return groupRoot(root.first, id) ?? groupRoot(root.second, id);
}
export function contains(node: Node, id: string): boolean {
  return (
    node.id === id ||
    (node.kind === "split" &&
      (contains(node.first, id) || contains(node.second, id)))
  );
}
export function dockOf(panel: Panel, limits: Limits) {
  return panel.tabs.length === 1
    ? limits[panel.tabs[0].plugin]?.dock
    : undefined;
}
/** The dock of a panel shown as its bar only. */
export function collapsedDock(node: Node, limits: Limits) {
  if (node.kind !== "panel") return undefined;
  const dock = dockOf(node, limits);
  return dock && (dock.fixed || node.collapsed) ? dock : undefined;
}
export function minimum(node: Node, limits: Limits): Minimum {
  const bar = collapsedDock(node, limits);
  if (bar) {
    const own = limits[(node as Panel).tabs[0].plugin];
    return bar.axis === "x"
      ? { width: bar.size, height: own.height }
      : { width: own.width, height: bar.size };
  }
  if (node.kind === "panel")
    return node.tabs.reduce(
      (size, tab) => ({
        width: Math.max(size.width, limits[tab.plugin]?.width ?? 240),
        height: Math.max(size.height, limits[tab.plugin]?.height ?? 140),
      }),
      { width: 0, height: 0 },
    );
  const a = minimum(node.first, limits),
    b = minimum(node.second, limits),
    gap = gapOf(node);
  return node.axis === "x"
    ? { width: a.width + b.width + gap, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + gap };
}
/** Size of a split's first side: a collapsed docked side keeps its bar size. */
export function firstSize(node: Split, available: number, limits: Limits) {
  const a = collapsedDock(node.first, limits),
    b = collapsedDock(node.second, limits);
  return a?.axis === node.axis
    ? a.size
    : b?.axis === node.axis
      ? available - b.size
      : available * node.ratio;
}
export function geometry(
  root: Node | null,
  bounds: Rect,
  limits: Limits = {},
): Map<string, Rect> {
  const result = new Map<string, Rect>();
  function walk(node: Node, rect: Rect) {
    result.set(node.id, rect);
    if (node.kind === "panel") return;
    const gap = gapOf(node);
    if (node.axis === "x") {
      const width = firstSize(node, rect.width - gap, limits);
      walk(node.first, { ...rect, width });
      walk(node.second, {
        ...rect,
        x: rect.x + width + gap,
        width: rect.width - width - gap,
      });
    } else {
      const height = firstSize(node, rect.height - gap, limits);
      walk(node.first, { ...rect, height });
      walk(node.second, {
        ...rect,
        y: rect.y + height + gap,
        height: rect.height - height - gap,
      });
    }
  }
  if (root) walk(root, bounds);
  return result;
}

/** Throws before a mutation can commit. Shared by tests and import-free UI actions. */
export function validate(state: Workspace, bounds?: Rect, limits: Limits = {}) {
  const ids = new Set<string>(),
    tabs = new Set<string>();
  const rects = bounds ? geometry(state.root, bounds, limits) : null;
  function leaf(node: Panel, rect: Rect | undefined) {
    if (!node.tabs.length || !node.tabs.some((t) => t.id === node.active))
      throw new Error("Invalid active tab");
    if (node.tabs.length > 1 && node.tabs.some((t) => limits[t.plugin]?.dock))
      throw new Error("A docked tool cannot share its panel");
    for (const tab of node.tabs) {
      if (tabs.has(tab.id)) throw new Error("Duplicate tab");
      tabs.add(tab.id);
    }
    const min = minimum(node, limits);
    if (
      rect &&
      (rect.width + 0.1 < min.width || rect.height + 0.1 < min.height)
    )
      throw new Error(
        "Not enough space for this split. Enlarge the window or close a panel.",
      );
  }
  function walk(node: Node) {
    if (ids.has(node.id)) throw new Error("Duplicate layout ID");
    ids.add(node.id);
    if (node.kind === "split") {
      if (!Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1)
        throw new Error("Invalid split ratio");
      walk(node.first);
      walk(node.second);
    } else leaf(node, rects?.get(node.id));
  }
  if (state.root) walk(state.root);
  for (const { panel, rect } of state.floating) {
    if (ids.has(panel.id)) throw new Error("Duplicate layout ID");
    ids.add(panel.id);
    if (panel.tabs.some((t) => limits[t.plugin]?.dock))
      throw new Error("A docked tool cannot float");
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite))
      throw new Error("Invalid floating panel");
    leaf(panel, bounds && rect);
  }
  const leaves = allPanels(state);
  if (state.focused && !leaves.some((p) => p.id === state.focused))
    throw new Error("Invalid focus");
  if (state.maximized && !leaves.some((p) => p.id === state.maximized))
    throw new Error("Invalid maximized panel");
}

export type Action =
  | {
      type: "open";
      tab: Tab;
      panelId: string;
      splitId: string;
      /** `float` opens a floating panel over the layout. */
      mode: "tab" | "auto" | "float" | Axis;
      /** Share of the first (left or top) side of a new split (default half). */
      ratio?: number;
      /** Put the new panel before (left of or above) the focused one instead of after. */
      before?: boolean;
      /** A split makes an editor group of the focused panel (see `Split.group`). */
      group?: boolean;
    }
  | { type: "close"; tabId: string }
  /** Replaces the whole workspace, such as with a layout template. */
  | { type: "load"; workspace: Workspace }
  | { type: "activate"; panelId: string; tabId?: string }
  | { type: "maximize"; panelId: string }
  | { type: "collapse"; panelId: string; collapsed: boolean }
  | { type: "resize"; splitId: string; ratio: number }
  /** Floats a tiled panel, or moves and resizes a floating one to `rect`. */
  | { type: "float"; panelId: string; rect?: Rect }
  /** Puts a floating panel back into the layout, beside the largest tiled panel. */
  | { type: "dock"; panelId: string; splitId: string }
  | {
      type: "drop";
      sourcePanel: string;
      tabId?: string;
      targetPanel: string;
      edge?: Edge;
      index?: number;
      panelId: string;
      splitId: string;
      /** An edge drop makes an editor group of the target panel. */
      group?: boolean;
    };

function normalize(state: Workspace): Workspace {
  const leaves = allPanels(state);
  return {
    ...state,
    focused: leaves.some((p) => p.id === state.focused)
      ? state.focused
      : (leaves[0]?.id ?? null),
    maximized: leaves.some((p) => p.id === state.maximized)
      ? state.maximized
      : null,
  };
}
function withoutTab(state: Workspace, panel: Panel, tabId: string) {
  const tabs = panel.tabs.filter((t) => t.id !== tabId);
  const active =
    panel.active === tabId
      ? tabs[Math.max(0, panel.tabs.findIndex((t) => t.id === tabId) - 1)]?.id
      : panel.active;
  return setPanel(
    state,
    panel.id,
    tabs.length ? { ...panel, tabs, active } : null,
  );
}
function split(
  target: Node,
  added: Panel,
  id: string,
  edge: Edge,
  ratio = 0.5,
  group = false,
): Split {
  const before = edge === "left" || edge === "top";
  return {
    kind: "split",
    id,
    axis: edge === "left" || edge === "right" ? "x" : "y",
    ratio,
    first: before ? added : target,
    second: before ? target : added,
    ...(group && { group }),
  };
}
/**
 * Where a split at `target` goes: the panel itself for a new editor group, else the whole
 * group around it, so other panels never land inside a Text Editor.
 */
function splitTarget(root: Node | null, target: Node, group?: boolean): Node {
  return (
    (!group && target.kind === "panel" && groupRoot(root, target.id)) || target
  );
}
/** The largest tiled panel that is not a docked tool: where a panel goes back to. */
function largest(state: Workspace, bounds: Rect, limits: Limits) {
  const rects = geometry(state.root, bounds, limits);
  let best: Panel | undefined;
  for (const panel of panels(state.root)) {
    const r = rects.get(panel.id)!,
      b = best && rects.get(best.id)!;
    if (
      !dockOf(panel, limits) &&
      (!b || r.width * r.height > b.width * b.height)
    )
      best = panel;
  }
  return best ?? panels(state.root)[0];
}
/** A new floating panel: centered, half the area wide (or `size`), cascaded. */
function floatingRect(
  state: Workspace,
  panel: Panel,
  bounds: Rect,
  limits: Limits,
  size?: Rect,
): Rect {
  const min = minimum(panel, limits);
  const width = Math.round(
      Math.max(min.width, Math.min(size?.width ?? Infinity, bounds.width / 2)),
    ),
    height = Math.round(
      Math.max(
        min.height,
        Math.min(size?.height ?? Infinity, bounds.height * 0.6),
      ),
    );
  const offset = 24 * (state.floating.length % 6);
  return {
    x: Math.max(0, Math.round((bounds.width - width) / 2) + offset),
    y: Math.max(0, Math.round((bounds.height - height) / 2) + offset),
    width,
    height,
  };
}
/** Splits tiled `target` with `added`; without a layout, `added` becomes it. */
function splitAt(
  state: Workspace,
  panel: Panel | undefined,
  added: Panel,
  splitId: string,
  bounds: Rect,
  limits: Limits,
  axis: Axis | "auto",
  before = false,
  ratio?: number,
  group = false,
): Workspace {
  if (!panel || !state.root)
    return { ...state, root: added, focused: added.id, maximized: null };
  const target = splitTarget(state.root, panel, group);
  const rect = geometry(state.root, bounds, limits).get(target.id)!;
  const along =
    axis === "auto" ? (rect.width >= rect.height ? "x" : "y") : axis;
  const edge: Edge =
    along === "x" ? (before ? "left" : "right") : before ? "top" : "bottom";
  return {
    ...state,
    root: replace(
      state.root,
      target.id,
      split(target, added, splitId, edge, ratio, group),
    ),
    focused: added.id,
    maximized: null,
  };
}

export function apply(
  state: Workspace,
  action: Action,
  bounds: Rect,
  limits: Limits = {},
): Workspace {
  let next = state;
  const leaves = allPanels(state);
  if (action.type === "open") {
    const added: Panel = {
      kind: "panel",
      id: action.panelId,
      tabs: [action.tab],
      active: action.tab.id,
    };
    const focused = leaves.find((p) => p.id === state.focused);
    const target = focused ?? leaves[0];
    const docked = !!limits[action.tab.plugin]?.dock;
    // A docked tool never shares a panel or floats: a tab next to one becomes a split.
    const mode =
      (action.mode === "tab" && target && (docked || dockOf(target, limits))) ||
      (action.mode === "float" && docked)
        ? "auto"
        : action.mode;
    if (mode === "float")
      next = {
        ...state,
        floating: [
          ...state.floating,
          { panel: added, rect: floatingRect(state, added, bounds, limits) },
        ],
        focused: added.id,
        maximized: null,
      };
    else if (mode === "tab" && target)
      next = setPanel(state, target.id, {
        ...target,
        tabs: [...target.tabs, action.tab],
        active: action.tab.id,
      });
    else
      next = splitAt(
        state,
        // A floating panel is not split: the new panel goes into the layout.
        focused && !isFloating(state, focused.id)
          ? focused
          : largest(state, bounds, limits),
        added,
        action.splitId,
        bounds,
        limits,
        mode === "tab" ? "auto" : mode,
        action.before,
        action.ratio,
        action.group,
      );
  } else if (action.type === "load") {
    next = normalize(action.workspace);
  } else if (action.type === "close") {
    const source = leaves.find((p) =>
      p.tabs.some((t) => t.id === action.tabId),
    );
    if (source) next = normalize(withoutTab(state, source, action.tabId));
  } else if (action.type === "activate") {
    const panel = leaves.find((p) => p.id === action.panelId);
    if (panel) {
      next = {
        ...setPanel(state, panel.id, {
          ...panel,
          active: action.tabId ?? panel.active,
        }),
        focused: panel.id,
        maximized: state.maximized ? panel.id : null,
      };
      // A floating panel comes to the front.
      const index = next.floating.findIndex((f) => f.panel.id === panel.id);
      if (index >= 0 && index < next.floating.length - 1)
        next = {
          ...next,
          floating: [
            ...next.floating.filter((_, i) => i !== index),
            next.floating[index],
          ],
        };
    }
  } else if (action.type === "collapse") {
    const panel = leaves.find((p) => p.id === action.panelId);
    if (panel && dockOf(panel, limits))
      next = setPanel(state, panel.id, {
        ...panel,
        collapsed: action.collapsed,
      });
  } else if (action.type === "maximize") {
    next = {
      ...state,
      focused: action.panelId,
      maximized: state.maximized === action.panelId ? null : action.panelId,
    };
  } else if (action.type === "resize" && state.root) {
    const { splitId, ratio } = action;
    function resize(node: Node): Node {
      if (node.kind === "panel") return node;
      return node.id === splitId
        ? { ...node, ratio }
        : { ...node, first: resize(node.first), second: resize(node.second) };
    }
    next = { ...state, root: resize(state.root) };
  } else if (action.type === "float") {
    const panel = leaves.find((p) => p.id === action.panelId);
    if (!panel) return state;
    if (isFloating(state, panel.id)) {
      const rect = action.rect;
      if (!rect) return state;
      next = {
        ...state,
        floating: state.floating.map((f) =>
          f.panel.id === panel.id ? { ...f, rect } : f,
        ),
      };
    } else {
      if (dockOf(panel, limits)) throw new Error("A docked tool cannot float");
      const size = geometry(state.root, bounds, limits).get(panel.id);
      const rest = setPanel(state, panel.id, null);
      next = normalize({
        ...rest,
        floating: [
          ...rest.floating,
          {
            panel,
            rect:
              action.rect ?? floatingRect(state, panel, bounds, limits, size),
          },
        ],
        focused: panel.id,
        maximized: null,
      });
    }
  } else if (action.type === "dock") {
    const panel = state.floating.find(
      (f) => f.panel.id === action.panelId,
    )?.panel;
    if (!panel) return state;
    const rest = setPanel(state, panel.id, null);
    next = splitAt(
      rest,
      largest(rest, bounds, limits),
      panel,
      action.splitId,
      bounds,
      limits,
      "auto",
    );
  } else if (action.type === "drop") {
    const source = leaves.find((p) => p.id === action.sourcePanel),
      target = leaves.find((p) => p.id === action.targetPanel);
    if (!source || !target) return state;
    // A floating panel has no edges to split at: a drop there joins its tabs.
    const edge = isFloating(state, target.id) ? undefined : action.edge;
    if (source === target) {
      if (!action.tabId) return state;
      const tab = source.tabs.find((t) => t.id === action.tabId);
      if (!tab) return state;
      const tabs = source.tabs.filter((t) => t.id !== tab.id);
      if (edge) {
        if (!tabs.length || !state.root) return state;
        const remaining: Panel = {
          ...source,
          tabs,
          active: source.active === tab.id ? tabs[0].id : source.active,
        };
        const added: Panel = {
          kind: "panel",
          id: action.panelId,
          tabs: [tab],
          active: tab.id,
        };
        const around = splitTarget(state.root, source, action.group);
        next = {
          ...state,
          root: replace(
            state.root,
            around.id,
            split(
              around === source
                ? remaining
                : replace(around, source.id, remaining)!,
              added,
              action.splitId,
              edge,
              0.5,
              action.group,
            ),
          ),
          focused: added.id,
          maximized: null,
        };
      } else {
        tabs.splice(
          Math.max(0, Math.min(action.index ?? tabs.length, tabs.length)),
          0,
          tab,
        );
        next = setPanel(state, source.id, { ...source, tabs });
      }
    } else if (
      !action.tabId &&
      !edge &&
      state.root &&
      !isFloating(state, source.id) &&
      !isFloating(state, target.id)
    ) {
      function swap(node: Node): Node {
        if (node.id === source!.id) return target!;
        if (node.id === target!.id) return source!;
        return node.kind === "panel"
          ? node
          : { ...node, first: swap(node.first), second: swap(node.second) };
      }
      next = {
        ...state,
        root: swap(state.root),
        focused: source.id,
        maximized: null,
      };
    } else {
      const tab = action.tabId
        ? source.tabs.find((t) => t.id === action.tabId)
        : undefined;
      if (action.tabId && !tab) return state;
      // Nothing merges into or out of a docked tool's panel.
      if (
        !edge &&
        (dockOf(target, limits) ||
          (tab ? limits[tab.plugin]?.dock : dockOf(source, limits)))
      )
        return state;
      const rest = tab
        ? withoutTab(state, source, tab.id)
        : setPanel(state, source.id, null);
      if (edge && !rest.root) return state;
      const added: Panel = tab
        ? { kind: "panel", id: action.panelId, tabs: [tab], active: tab.id }
        : source;
      const fresh = panels(rest.root).find((p) => p.id === target.id);
      const around = fresh && splitTarget(rest.root, fresh, action.group);
      const placed = edge
        ? {
            ...rest,
            root: replace(
              rest.root!,
              (around ?? target).id,
              split(
                around ?? target,
                added,
                action.splitId,
                edge,
                0.5,
                action.group,
              ),
            ),
          }
        : setPanel(rest, target.id, {
            ...target,
            tabs: [...target.tabs, ...added.tabs],
            active: added.active,
          });
      next = normalize({
        ...placed,
        focused: edge ? added.id : target.id,
        maximized: null,
      });
    }
  }
  // Closing/focus must remain possible after the native window shrinks below layout minimum.
  validate(
    next,
    ["open", "drop", "resize", "collapse", "float", "dock", "load"].includes(
      action.type,
    )
      ? bounds
      : undefined,
    limits,
  );
  return next;
}

/** The panel beside the focused one in `direction`, floating panels included. */
export function neighbor(
  state: Workspace,
  bounds: Rect,
  direction: Edge,
  limits: Limits = {},
): string | null {
  const rects = geometry(state.root, bounds, limits);
  for (const { panel, rect } of state.floating) rects.set(panel.id, rect);
  const current = state.focused && rects.get(state.focused);
  if (!current) return null;
  const cx = current.x + current.width / 2,
    cy = current.y + current.height / 2;
  let best: string | null = null,
    score = Infinity;
  for (const panel of allPanels(state)) {
    if (panel.id === state.focused) continue;
    const r = rects.get(panel.id)!,
      dx = r.x + r.width / 2 - cx,
      dy = r.y + r.height / 2 - cy;
    const primary =
      direction === "left"
        ? -dx
        : direction === "right"
          ? dx
          : direction === "top"
            ? -dy
            : dy;
    const secondary =
      direction === "left" || direction === "right"
        ? Math.abs(dy)
        : Math.abs(dx);
    if (primary > 0 && primary + secondary * 2 < score) {
      score = primary + secondary * 2;
      best = panel.id;
    }
  }
  return best;
}
