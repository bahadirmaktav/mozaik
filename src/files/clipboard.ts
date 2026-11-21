import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fileSystem, type FileClipboard } from "../services/filesystem";

/**
 * Cut or copied files, shared by every File Manager and IDE Explorer of all windows: Rust keeps
 * them and tells this process's windows at once; another process's are read on focus.
 */
export type Clipboard = FileClipboard | null;
interface Store {
  clipboard: Clipboard;
  started: boolean;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.fileClipboard ?? {
  clipboard: null,
  started: false,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.fileClipboard = store;

function emit() {
  store.version++;
  store.listeners.forEach((fn) => fn());
}
/** Listens to clipboard changes; the first listener starts reading the shared clipboard. */
export function onClipboard(fn: () => void) {
  start();
  store.listeners.add(fn);
  return () => void store.listeners.delete(fn);
}
export const clipboardVersion = () => store.version;
export function setClipboard(clipboard: Clipboard) {
  store.clipboard = clipboard;
  emit();
  if (isTauri()) void fileSystem.setClipboard(clipboard).catch(() => {});
}
function start() {
  if (store.started || !isTauri()) return;
  store.started = true;
  const show = (clipboard: Clipboard) => {
    if (JSON.stringify(clipboard) === JSON.stringify(store.clipboard)) return;
    store.clipboard = clipboard;
    emit();
  };
  const read = () =>
    void fileSystem
      .getClipboard()
      .then(show)
      .catch(() => {});
  read();
  window.addEventListener("focus", read);
  void listen<Clipboard>("file-clipboard-changed", (event) =>
    show(event.payload),
  );
}
export const getClipboard = () => store.clipboard;
export function useClipboard() {
  useSyncExternalStore(onClipboard, clipboardVersion);
  return store.clipboard;
}
