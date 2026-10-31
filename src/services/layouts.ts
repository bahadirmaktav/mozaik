import { isTauri } from "@tauri-apps/api/core";
import { native } from "./native";

/** A panel's modules (plugin IDs, in tab order) or a split of two parts. */
export type LayoutNode =
  | { kind: "panel"; tabs: string[] }
  | {
      kind: "split";
      axis: "x" | "y";
      ratio: number;
      /** Editor groups of one Text Editor. */
      group?: boolean;
      first: LayoutNode;
      second: LayoutNode;
    };
/** A saved arrangement of modules: the layout only, no documents or sessions. */
export interface Template {
  name: string;
  root: LayoutNode | null;
  /** Floating panels; `rect` is x, y, width, height relative to the workspace area. */
  floating: { tabs: string[]; rect: [number, number, number, number] }[];
}

// Outside the desktop app templates last for the page, so the commands stay usable.
let memory: Template[] = [];
const byName = (a: Template, b: Template) =>
  a.name.toLowerCase().localeCompare(b.name.toLowerCase());
/** Typed adapter for the native layout template commands (`layouts.rs`). */
export const layoutsBackend = {
  list: () =>
    isTauri()
      ? native<Template[]>("layouts_list")
      : Promise.resolve([...memory]),
  /** Fails when the name exists, unless `replace`. */
  save: (template: Template, replace: boolean) => {
    if (isTauri())
      return native<Template[]>("layouts_save", { template, replace });
    const name = template.name.trim();
    const same = memory.find(
      (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
    if (same && !replace)
      return Promise.reject(new Error(`A template named “${name}” exists`));
    memory = [...memory.filter((t) => t !== same), { ...template, name }].sort(
      byName,
    );
    return Promise.resolve([...memory]);
  },
  delete: (name: string) =>
    isTauri()
      ? native<Template[]>("layouts_delete", { name })
      : Promise.resolve((memory = memory.filter((t) => t.name !== name))),
};
