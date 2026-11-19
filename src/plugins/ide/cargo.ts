import { useSyncExternalStore } from "react";
import {
  ANALYZER_SETTINGS,
  rustBackend,
  type RustSettings,
  type RustSettingsInfo,
} from "../../services/rust";
import { restartAll } from "./lsp";

/**
 * Rust projects with Cargo, after VS Code's rust-analyzer extension: the settings of
 * Workspace Settings → IDE → Rust. Nothing of Cargo runs unless the user asks.
 */
interface Store {
  settings: RustSettingsInfo | null;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideCargo ?? {
  settings: null,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideCargo = store;

function emit() {
  store.version++;
  store.listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => {
    store.listeners.delete(fn);
  };
}
export function useCargoStore() {
  useSyncExternalStore(subscribe, () => store.version);
  return store;
}

export async function loadRustSettings(refresh = false) {
  if (!store.settings || refresh) {
    store.settings = await rustBackend.settings();
    emit();
  }
  return store.settings;
}
/** Saves the settings; rust-analyzer starts again when one of its own changed. */
export async function saveRustSettings(settings: RustSettings) {
  const before = store.settings?.settings;
  store.settings = await rustBackend.setSettings(settings);
  emit();
  if (!before || ANALYZER_SETTINGS.some((key) => before[key] !== settings[key]))
    restartAll("rust-analyzer");
}
export async function chooseCargo(reset: boolean) {
  const info = await rustBackend.chooseCargo(reset);
  if (info) {
    store.settings = info;
    emit();
  }
}
