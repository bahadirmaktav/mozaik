import { useEffect, useState, useSyncExternalStore } from "react";
import { Lines } from "./buildOutput";

/**
 * Output channels, like VS Code's Output: text that tools print, independent of any panel
 * or terminal. IDE holds the IDE's own messages (a definition not found, a failed action)
 * instead of notices over the workspace; CMake its configure and build output.
 */
export const CHANNELS = ["IDE", "CMake"] as const;
export type ChannelName = (typeof CHANNELS)[number];
// Long builds keep the latest lines; the measured cost is in rendering, which is virtual.
const LIMIT = 20_000;
// How long the status bar repeats the latest IDE message.
const SHOWN_MS = 8000;

interface Store {
  channels: Map<ChannelName, Lines>;
  /** The latest IDE message, for the status bar. */
  latest: { text: string; time: number } | null;
  listeners: Set<() => void>;
  version: number;
  frame: number;
}
const store: Store = import.meta.hot?.data.ideChannels ?? {
  channels: new Map(CHANNELS.map((name) => [name, new Lines(LIMIT)])),
  latest: null,
  listeners: new Set(),
  version: 0,
  frame: 0,
};
if (import.meta.hot) import.meta.hot.data.ideChannels = store;

function emit() {
  store.version++;
  store.listeners.forEach((fn) => fn());
}
// Bursts of output re-render once per frame.
function schedule() {
  if (store.frame) return;
  store.frame = requestAnimationFrame(() => {
    store.frame = 0;
    emit();
  });
}
export function subscribe(fn: () => void) {
  store.listeners.add(fn);
  return () => {
    store.listeners.delete(fn);
  };
}
export function useOutput(channel: ChannelName) {
  const version = useSyncExternalStore(subscribe, () => store.version);
  const lines = store.channels.get(channel)!;
  return { lines: lines.all(), dropped: lines.dropped, version };
}
export function appendOutput(channel: ChannelName, text: string) {
  store.channels.get(channel)!.append(text);
  schedule();
}
export function clearOutput(channel: ChannelName) {
  store.channels.get(channel)!.clear();
  emit();
}
/** An IDE message: a timestamped line in the IDE channel, briefly in the status bar. */
export function logMessage(text: string) {
  const time = Date.now();
  const stamp = new Date(time).toLocaleTimeString([], { hour12: false });
  store.channels.get("IDE")!.append(`[${stamp}] ${text}\n`);
  store.latest = { text, time };
  emit();
}
/** The latest IDE message while it is recent; re-renders when it expires. */
export function useLatestMessage() {
  useSyncExternalStore(subscribe, () => store.version);
  const latest = store.latest;
  const left = latest ? latest.time + SHOWN_MS - Date.now() : 0;
  const [, expire] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => expire((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [latest, left > 0]);
  return left > 0 ? latest!.text : null;
}
export function dismissMessage() {
  store.latest = null;
  emit();
}
