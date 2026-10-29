/** All geometry is in CSS pixels. No DOM, IPC, clocks or random IDs in this module. */
export type Axis = "x" | "y";
export type Edge = "left" | "right" | "top" | "bottom";
export type Rect = { x: number; y: number; width: number; height: number };
export type Tab = { id: string; plugin: string };
export type Panel = { kind: "panel"; id: string; tabs: Tab[]; active: string };
export type Split = {
  kind: "split";
  id: string;
  axis: Axis;
  ratio: number;
  first: Node;
  second: Node;
};
export type Node = Panel | Split;
export type Workspace = {
  root: Node | null;
  focused: string | null;
  maximized: string | null;
};
export type Minimum = { width: number; height: number };
export type Limits = Record<string, Minimum>;
export const GAP = 6;
export const emptyWorkspace = (): Workspace => ({
  root: null,
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
export function minimum(node: Node, limits: Limits): Minimum {
  if (node.kind === "panel")
    return node.tabs.reduce(
      (size, tab) => ({
        width: Math.max(size.width, limits[tab.plugin]?.width ?? 240),
        height: Math.max(size.height, limits[tab.plugin]?.height ?? 140),
      }),
      { width: 0, height: 0 },
    );
  const a = minimum(node.first, limits),
    b = minimum(node.second, limits);
  return node.axis === "x"
    ? { width: a.width + b.width + GAP, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + GAP };
}
export function geometry(root: Node | null, bounds: Rect): Map<string, Rect> {
  const result = new Map<string, Rect>();
  function walk(node: Node, rect: Rect) {
    result.set(node.id, rect);
    if (node.kind === "panel") return;
    if (node.axis === "x") {
      const width = (rect.width - GAP) * node.ratio;
      walk(node.first, { ...rect, width });
      walk(node.second, {
        ...rect,
        x: rect.x + width + GAP,
        width: rect.width - width - GAP,
      });
    } else {
      const height = (rect.height - GAP) * node.ratio;
      walk(node.first, { ...rect, height });
      walk(node.second, {
        ...rect,
        y: rect.y + height + GAP,
        height: rect.height - height - GAP,
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
  const rects = bounds ? geometry(state.root, bounds) : null;
  function walk(node: Node) {
    if (ids.has(node.id)) throw new Error("Duplicate layout ID");
    ids.add(node.id);
    if (node.kind === "split") {
      if (!Number.isFinite(node.ratio) || node.ratio <= 0 || node.ratio >= 1)
        throw new Error("Invalid split ratio");
      walk(node.first);
      walk(node.second);
    } else {
      if (!node.tabs.length || !node.tabs.some((t) => t.id === node.active))
        throw new Error("Invalid active tab");
      for (const tab of node.tabs) {
        if (tabs.has(tab.id)) throw new Error("Duplicate tab");
        tabs.add(tab.id);
      }
      const rect = rects?.get(node.id),
        min = minimum(node, limits);
      if (
        rect &&
        (rect.width + 0.1 < min.width || rect.height + 0.1 < min.height)
      )
        throw new Error(
          "Not enough space for this split. Enlarge the window or close a panel.",
        );
    }
  }
  if (state.root) walk(state.root);
  const leaves = panels(state.root);
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
      mode: "tab" | "auto" | Axis;
      /** Share of the space kept by the existing side of a new split (default half). */
      ratio?: number;
      /** Split around the whole layout instead of the focused panel (`mode` is the axis). */
      around?: "root";
    }
  | { type: "close"; tabId: string }
  | { type: "activate"; panelId: string; tabId?: string }
  | { type: "maximize"; panelId: string }
  | { type: "resize"; splitId: string; ratio: number }
  | {
      type: "drop";
      sourcePanel: string;
      tabId?: string;
      targetPanel: string;
      edge?: Edge;
      index?: number;
      panelId: string;
      splitId: string;
    };

function normalize(state: Workspace): Workspace {
  const leaves = panels(state.root);
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
function withoutTab(root: Node, panel: Panel, tabId: string) {
  const tabs = panel.tabs.filter((t) => t.id !== tabId);
  const active =
    panel.active === tabId
      ? tabs[Math.max(0, panel.tabs.findIndex((t) => t.id === tabId) - 1)]?.id
      : panel.active;
  return replace(
    root,
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
): Split {
  const before = edge === "left" || edge === "top";
  return {
    kind: "split",
    id,
    axis: edge === "left" || edge === "right" ? "x" : "y",
    ratio,
    first: before ? added : target,
    second: before ? target : added,
  };
}

export function apply(
  state: Workspace,
  action: Action,
  bounds: Rect,
  limits: Limits = {},
): Workspace {
  let next = state;
  const leaves = panels(state.root);
  if (action.type === "open") {
    const added: Panel = {
      kind: "panel",
      id: action.panelId,
      tabs: [action.tab],
      active: action.tab.id,
    };
    const target = leaves.find((p) => p.id === state.focused) ?? leaves[0];
    if (!target || !state.root)
      next = { root: added, focused: added.id, maximized: null };
    else if (action.around === "root")
      next = {
        root: split(
          state.root,
          added,
          action.splitId,
          action.mode === "y" ? "bottom" : "right",
          action.ratio,
        ),
        focused: added.id,
        maximized: null,
      };
    else if (action.mode === "tab")
      next = {
        ...state,
        root: replace(state.root, target.id, {
          ...target,
          tabs: [...target.tabs, action.tab],
          active: action.tab.id,
        }),
      };
    else {
      const rect = geometry(state.root, bounds).get(target.id)!;
      const axis =
        action.mode === "auto"
          ? rect.width >= rect.height
            ? "x"
            : "y"
          : action.mode;
      next = {
        root: replace(
          state.root,
          target.id,
          split(
            target,
            added,
            action.splitId,
            axis === "x" ? "right" : "bottom",
            action.ratio,
          ),
        ),
        focused: added.id,
        maximized: null,
      };
    }
  } else if (action.type === "close") {
    const source = leaves.find((p) =>
      p.tabs.some((t) => t.id === action.tabId),
    );
    if (source && state.root)
      next = normalize({
        ...state,
        root: withoutTab(state.root, source, action.tabId),
      });
  } else if (action.type === "activate") {
    const panel = leaves.find((p) => p.id === action.panelId);
    if (panel && state.root)
      next = {
        ...state,
        focused: panel.id,
        maximized: state.maximized ? panel.id : null,
        root: replace(state.root, panel.id, {
          ...panel,
          active: action.tabId ?? panel.active,
        }),
      };
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
  } else if (action.type === "drop" && state.root) {
    const source = leaves.find((p) => p.id === action.sourcePanel),
      target = leaves.find((p) => p.id === action.targetPanel);
    if (!source || !target) return state;
    if (source === target) {
      if (!action.tabId) return state;
      const tab = source.tabs.find((t) => t.id === action.tabId);
      if (!tab) return state;
      const tabs = source.tabs.filter((t) => t.id !== tab.id);
      if (action.edge) {
        if (!tabs.length) return state;
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
        next = {
          root: replace(
            state.root,
            source.id,
            split(remaining, added, action.splitId, action.edge),
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
        next = {
          ...state,
          root: replace(state.root, source.id, { ...source, tabs }),
        };
      }
    } else if (!action.tabId && !action.edge) {
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
      const root = tab
        ? withoutTab(state.root, source, tab.id)
        : replace(state.root, source.id, null);
      if (!root) return state;
      const added: Panel = tab
        ? { kind: "panel", id: action.panelId, tabs: [tab], active: tab.id }
        : source;
      const replacement = action.edge
        ? split(target, added, action.splitId, action.edge)
        : {
            ...target,
            tabs: [...target.tabs, ...added.tabs],
            active: added.active,
          };
      next = normalize({
        root: replace(root, target.id, replacement),
        focused: action.edge ? added.id : target.id,
        maximized: null,
      });
    }
  }
  // Closing/focus must remain possible after the native window shrinks below layout minimum.
  validate(
    next,
    ["open", "drop", "resize"].includes(action.type) ? bounds : undefined,
    limits,
  );
  return next;
}

export function neighbor(
  state: Workspace,
  bounds: Rect,
  direction: Edge,
): string | null {
  const rects = geometry(state.root, bounds),
    current = state.focused && rects.get(state.focused);
  if (!current) return null;
  const cx = current.x + current.width / 2,
    cy = current.y + current.height / 2;
  let best: string | null = null,
    score = Infinity;
  for (const panel of panels(state.root)) {
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
