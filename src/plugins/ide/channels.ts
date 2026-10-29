import { useSyncExternalStore } from "react";
import { Lines } from "./buildOutput";

/**
 * Output channels, like VS Code's Output: text that tools print, independent of any panel
 * or terminal. CMake is the first channel; others can be added by name.
 */
export const CHANNELS = ["CMake"] as const;
export type ChannelName = (typeof CHANNELS)[number];
// Long builds keep the latest lines; the measured cost is in rendering, which is virtual.
const LIMIT = 20_000;

interface Store {
  channels: Map<ChannelName, Lines>;
  listeners: Set<() => void>;
  version: number;
  frame: number;
}
const store: Store = import.meta.hot?.data.ideChannels ?? {
  channels: new Map(CHANNELS.map((name) => [name, new Lines(LIMIT)])),
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
