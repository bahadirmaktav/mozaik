import { useEffect, useRef } from "react";
import type { MenuItem } from "../components/Menu";

/**
 * Actions a module view offers to the command palette, listed as `Module: Label`. A view
 * registers its own menu items while it is mounted, so the palette shows the commands of the
 * modules in the workspace and runs them on that view. Of several views of one module the
 * focused one, else the one focused last, gives the commands.
 *
 * The view sets the returned ref's `current` to its items on every render (after any early
 * return), so the palette reads the view's current state.
 */
type Source = { module: string; items: () => MenuItem[]; focusedAt: number };
const sources = new Map<string, Source>();
let clock = 0;

export function useCommands(
  module: string,
  instanceId: string,
  focused: boolean,
) {
  const items = useRef<MenuItem[]>([]);
  useEffect(() => {
    const source: Source = {
      module,
      items: () => items.current,
      focusedAt: 0,
    };
    sources.set(instanceId, source);
    return () => {
      if (sources.get(instanceId) === source) sources.delete(instanceId);
    };
  }, [module, instanceId]);
  useEffect(() => {
    const source = sources.get(instanceId);
    if (focused && source) source.focusedAt = ++clock;
  }, [focused, instanceId]);
  return items;
}

export interface ModuleCommand {
  id: string;
  label: string;
  shortcut?: string;
  detail?: string;
  run: () => void;
}
/** The registered commands, the focused module's first; disabled items are left out. */
export function moduleCommands(): ModuleCommand[] {
  const chosen = new Map<string, [string, Source]>();
  for (const [id, source] of sources) {
    const other = chosen.get(source.module);
    if (!other || source.focusedAt > other[1].focusedAt)
      chosen.set(source.module, [id, source]);
  }
  return [...chosen.values()]
    .sort(([, a], [, b]) => b.focusedAt - a.focusedAt)
    .flatMap(([id, source]) =>
      source.items().flatMap((item) =>
        item === "separator" || item.disabled
          ? []
          : [
              {
                id: `${source.module}:${id}:${item.label}`,
                label: `${source.module}: ${item.label}`,
                shortcut: item.shortcut,
                detail:
                  item.checked === undefined
                    ? undefined
                    : item.checked
                      ? "On"
                      : "Off",
                run: item.action,
              },
            ],
      ),
    );
}
