import { Channel, isTauri } from "@tauri-apps/api/core";
import { native } from "./native";

export type Adapter = "gdb" | "lldb";
export type Choice = "auto" | Adapter;
export interface AdapterInfo {
  adapter: Adapter;
  label: string;
  /** The program that would run, or null when none was found. */
  path: string | null;
  /** Chosen in a dialog rather than found. */
  chosen: boolean;
  /** Why it cannot be used. */
  problem: string | null;
}
export interface DebuggersInfo {
  choice: Choice;
  /** `GNU 15.2.0` from the last configure. */
  compiler: string | null;
  adapters: AdapterInfo[];
  /** What Debug starts, or `error` says why it cannot. */
  selected: Adapter | null;
  error: string | null;
}
export interface Breakpoint {
  path: string;
  /** 1-based. */
  line: number;
  enabled: boolean;
  condition: string;
  /** Stop from this hit on (a positive number); empty stops every time. */
  hitCondition: string;
  /** A logpoint's message, `{expression}` interpolated; empty for a breakpoint. */
  logMessage: string;
}
/** Breakpoints and watch expressions of a project, kept in Tessera's app data. */
export interface DebugState {
  breakpoints: Breakpoint[];
  breakpointsActive: boolean;
  watches: string[];
}
export interface TargetConfig {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}
export interface ConfigInfo {
  path: string;
  exists: boolean;
  file: { version: number; targets: Record<string, TargetConfig> } | null;
  /** The file does not parse; it is never rewritten then. */
  error: string | null;
}
export type AdapterEvent =
  | { kind: "message"; data: string }
  | { kind: "exit"; code: number | null; log: string };
export interface Started {
  adapter: Adapter;
  label: string;
  program: string;
}
export interface Launched {
  program: string;
  args: string[];
  cwd: string;
}

/** Typed adapter for the native debugging commands; replaceable in browser tests. */
export const debugBackend = {
  debuggers: (root: string) =>
    native<DebuggersInfo>("debug_debuggers", { root }),
  setChoice: (root: string, choice: Choice) =>
    native<DebuggersInfo>("debug_set_choice", { root, choice }),
  /** A native dialog; null when cancelled. */
  chooseDebugger: (root: string, adapter: Adapter) =>
    native<DebuggersInfo | null>("debug_choose_debugger", { root, adapter }),
  resetDebugger: (root: string, adapter: Adapter) =>
    native<DebuggersInfo>("debug_reset_debugger", { root, adapter }),
  state: (root: string) => native<DebugState>("debug_state", { root }),
  setState: (root: string, state: DebugState) =>
    native<void>("debug_set_state", { root, state }),
  config: (root: string) => native<ConfigInfo>("debug_config", { root }),
  setConfig: (root: string, target: string, config: TargetConfig) =>
    native<ConfigInfo>("debug_set_config", { root, target, config }),
  start(id: string, root: string, onEvent: (event: AdapterEvent) => void) {
    if (!isTauri()) return native<Started>("debug_start");
    const events = new Channel<AdapterEvent>();
    events.onmessage = onEvent;
    return native<Started>("debug_start", { id, root, events });
  },
  /** Sends the launch request `seq` for a run target; Rust builds it. `args` (a test's
   * filter) replace the target's arguments. */
  launch: (
    id: string,
    seq: number,
    root: string,
    target: string,
    args: string[] | null = null,
  ) => native<Launched>("debug_launch", { id, seq, root, target, args }),
  send: (id: string, message: string) =>
    native<void>("debug_send", { id, message }),
  stop: (id: string) => native<void>("debug_stop", { id }),
};
