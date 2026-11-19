/**
 * A server's `workspace/inlayHint/refresh` and `workspace/semanticTokens/refresh`: what an
 * editor asked for before the server knew the project (rust-analyzer still loading Cargo's
 * metadata) is asked again, as VS Code does.
 */
export type Refresh = "inlayHints" | "semanticTokens";
const listeners = new Map<Refresh, Set<() => void>>();

export function onRefresh(kind: Refresh, listener: () => void) {
  const set = listeners.get(kind) ?? new Set();
  set.add(listener);
  listeners.set(kind, set);
  return () => void set.delete(listener);
}
export function refresh(kind: Refresh) {
  for (const listener of listeners.get(kind) ?? []) listener();
}
