import { baseName, pathKey } from "./paths";

/** Files that are not text, one tab each among the code editors (`FileTab.tsx`). */
const tabs = new Map<string, string>();
const listeners = new Set<() => void>();
export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function createFileTab(path: string) {
  const id = crypto.randomUUID();
  tabs.set(id, path);
  listeners.forEach((fn) => fn());
  return id;
}
export const fileTabPath = (id: string) => tabs.get(id) ?? "";
export const fileTabFor = (path: string) =>
  [...tabs].find(([, p]) => pathKey(p) === pathKey(path))?.[0] ?? null;
export const fileTabTitle = (id: string) => baseName(fileTabPath(id) || "File");
export function disposeFileTab(id: string) {
  tabs.delete(id);
  listeners.forEach((fn) => fn());
}
