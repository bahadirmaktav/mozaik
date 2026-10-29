import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { native } from "./native";

export interface Pin {
  id: string;
  path: string;
  kind: "file" | "directory";
  name: string;
  missing: boolean;
}
/** Native persistence; mutable so browser tests can substitute it. */
export const pinBackend = {
  list: () => native<Pin[]>("pins_list"),
  add: (path: string) => native<Pin[]>("pins_add", { path }),
  remove: (id: string) => native<Pin[]>("pins_remove", { id }),
  reorder: (ids: string[]) => native<Pin[]>("pins_reorder", { ids }),
};

// Shared, application-wide pins. Any module may consume this registry; it has no
// dependency on the File Manager. Pins change only through explicit user actions.
const state = {
  pins: [] as Pin[],
  error: null as string | null,
  version: 0,
  started: false,
};
const listeners = new Set<() => void>();
function set(pins: Pin[], error: string | null = null) {
  state.pins = pins;
  state.error = error;
  state.version++;
  listeners.forEach((fn) => fn());
}
async function apply(request: Promise<Pin[]>) {
  set(await request);
}
function start() {
  if (state.started) return;
  state.started = true;
  void pins.refresh();
  if (!isTauri()) return;
  // Other windows (and this one) announce changes; another process is seen on focus.
  void listen("pins-changed", () => void pins.refresh());
  window.addEventListener("focus", () => void pins.refresh());
}
export const pins = {
  list: () => state.pins,
  error: () => state.error,
  async refresh() {
    try {
      set(await pinBackend.list());
    } catch (error) {
      set(state.pins, String(error).replace(/^Error: /, ""));
    }
  },
  add: (path: string) => apply(pinBackend.add(path)),
  remove: (id: string) => apply(pinBackend.remove(id)),
  reorder: (ids: string[]) => apply(pinBackend.reorder(ids)),
  move(id: string, step: -1 | 1) {
    const ids = state.pins.map((p) => p.id),
      from = ids.indexOf(id),
      to = from + step;
    if (from < 0 || to < 0 || to >= ids.length) return Promise.resolve();
    [ids[from], ids[to]] = [ids[to], ids[from]];
    return pins.reorder(ids);
  },
  subscribe(fn: () => void) {
    start();
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
export function usePins() {
  useSyncExternalStore(pins.subscribe, () => state.version);
  return { pins: state.pins, error: state.error };
}
