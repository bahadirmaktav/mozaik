/** Layout templates to and from workspace state. Pure: no DOM, IPC or random IDs. */
import type { LayoutNode, Template } from "../services/layouts";
import type { Node, Rect, Tab, Workspace } from "./model";

/**
 * The layout of `state`: each tab becomes the module `keep` returns for it (null leaves it
 * out, as do repeats where `single` says one is enough). Panels left without modules go,
 * and their splits with them.
 */
export function templateOf(
  name: string,
  state: Workspace,
  bounds: Rect,
  keep: (tab: Tab) => string | null,
  single: (plugin: string) => boolean = () => false,
): Template {
  const tabsOf = (tabs: Tab[]) => {
    const plugins: string[] = [];
    for (const tab of tabs) {
      const plugin = keep(tab);
      if (plugin && !(single(plugin) && plugins.includes(plugin)))
        plugins.push(plugin);
    }
    return plugins;
  };
  function nodeOf(node: Node): LayoutNode | null {
    if (node.kind === "panel") {
      const tabs = tabsOf(node.tabs);
      return tabs.length ? { kind: "panel", tabs } : null;
    }
    const first = nodeOf(node.first),
      second = nodeOf(node.second);
    if (!first || !second) return first ?? second;
    return {
      kind: "split",
      axis: node.axis,
      ratio: node.ratio,
      ...(node.group && { group: true }),
      first,
      second,
    };
  }
  const share = (value: number, total: number) =>
    Math.max(0, Math.min(1, total > 0 ? value / total : 0));
  return {
    name,
    root: state.root && nodeOf(state.root),
    floating: state.floating.flatMap(({ panel, rect }) => {
      const tabs = tabsOf(panel.tabs);
      return tabs.length
        ? [
            {
              tabs,
              rect: [
                share(rect.x, bounds.width),
                share(rect.y, bounds.height),
                share(rect.width, bounds.width),
                share(rect.height, bounds.height),
              ] as [number, number, number, number],
            },
          ]
        : [];
    }),
  };
}

/**
 * A workspace laid out as `template`. `make` creates a tab of a module, or null when it
 * cannot (unknown, or a single panel open elsewhere); panels without tabs are left out.
 * `id` gives fresh panel and split IDs.
 */
export function workspaceOf(
  template: Template,
  bounds: Rect,
  make: (plugin: string) => Tab | null,
  id: () => string,
): Workspace {
  const panelOf = (plugins: string[]) => {
    const tabs = plugins.map(make).filter((t): t is Tab => !!t);
    return tabs.length
      ? { kind: "panel" as const, id: id(), tabs, active: tabs[0].id }
      : null;
  };
  function nodeOf(node: LayoutNode): Node | null {
    if (node.kind === "panel") return panelOf(node.tabs);
    const first = nodeOf(node.first),
      second = nodeOf(node.second);
    if (!first || !second) return first ?? second;
    return {
      kind: "split",
      id: id(),
      axis: node.axis,
      ratio: node.ratio,
      ...(node.group && { group: true }),
      first,
      second,
    };
  }
  const root = template.root && nodeOf(template.root);
  const floating = template.floating.flatMap(({ tabs, rect }) => {
    const panel = panelOf(tabs);
    return panel
      ? [
          {
            panel,
            rect: {
              x: Math.round(rect[0] * bounds.width),
              y: Math.round(rect[1] * bounds.height),
              width: Math.round(rect[2] * bounds.width),
              height: Math.round(rect[3] * bounds.height),
            },
          },
        ]
      : [];
  });
  const first = root ?? floating[0]?.panel ?? null;
  const focus = (node: Node | null): string | null =>
    !node ? null : node.kind === "panel" ? node.id : focus(node.first);
  return { root, floating, focused: focus(first), maximized: null };
}
