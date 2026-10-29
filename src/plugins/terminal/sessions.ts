import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { native } from "../../services/native";

export type TerminalStatus = "starting" | "running" | "exited" | "failed";
export interface TerminalSession {
  id: string;
  status: TerminalStatus;
  shell: string;
  error: string | null;
  exitCode: number | null;
  /** Working directory to start in; null is the home directory. */
  directory: string | null;
  /** A CMake target to run instead of a shell (Rust finds its program). */
  run: { root: string; target: string } | null;
  /** A detected shell to start instead of the default one. */
  request: string | null;
}
interface Store {
  sessions: Map<string, TerminalSession>;
  listeners: Set<() => void>;
  // Emulator resources owned by the lazily loaded view runtime.
  disposers: Map<string, () => void>;
  version: number;
}
// Sessions outlive views: a tab move or hidden tab must not restart the shell.
const store: Store = import.meta.hot?.data.terminalStore ?? {
  sessions: new Map(),
  listeners: new Set(),
  disposers: new Map(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.terminalStore = store;
const { sessions, listeners } = store;
function emit() {
  store.version++;
  listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export const hasSession = (id: string) => sessions.has(id);
export function getSession(id: string) {
  const session = sessions.get(id);
  if (!session) throw new Error("Terminal was closed");
  return session;
}
export function createSession(
  directory: string | null = null,
  run: TerminalSession["run"] = null,
  request: string | null = null,
) {
  const id = crypto.randomUUID();
  sessions.set(id, {
    id,
    status: "starting",
    shell: "Terminal",
    error: null,
    exitCode: null,
    directory,
    run,
    request,
  });
  emit();
  return id;
}
export function updateSession(id: string, change: Partial<TerminalSession>) {
  const session = sessions.get(id);
  if (!session) return;
  sessions.set(id, { ...session, ...change });
  emit();
}
export function onDispose(id: string, dispose: () => void) {
  store.disposers.set(id, dispose);
}
export function sessionTitle(id: string) {
  const session = getSession(id);
  return session.status === "exited"
    ? `${session.shell} (exited)`
    : session.status === "failed"
      ? `${session.shell} (failed)`
      : session.shell;
}
// Closing a tab ends its shell; the native close is idempotent.
export function disposeSession(id: string) {
  if (!sessions.has(id)) return;
  if (isTauri()) void native("close_terminal", { id }).catch(() => {});
  store.disposers.get(id)?.();
  store.disposers.delete(id);
  sessions.delete(id);
  emit();
}
export function useTerminalSession(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return sessions.get(id);
}
