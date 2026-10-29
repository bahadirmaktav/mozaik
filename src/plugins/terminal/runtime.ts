import { Channel, isTauri } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { native } from "../../services/native";
import { getSession, hasSession, onDispose, updateSession } from "./sessions";

type TerminalEvent =
  | { kind: "data"; data: string }
  | { kind: "exit"; code: number | null; signal: string | null };
interface Runtime {
  term: Terminal;
  fit: FitAddon;
  // Moved between views so emulator state and scrollback survive remounts.
  element: HTMLDivElement;
  opened: boolean;
  started: boolean;
  input: string;
  writing: boolean;
  unacked: number;
  frame: number;
  resizeTimer: ReturnType<typeof setTimeout> | undefined;
}
// Must stay below the native high-water mark so a blocked reader is always released.
const ACK_BATCH = 32 * 1024;
const SCROLLBACK = 5000;
// Windows terminals paste with Ctrl+V; on Linux Ctrl+V stays the shell's quoted insert.
const windows = navigator.userAgent.includes("Windows");
const runtimes: Map<string, Runtime> =
  import.meta.hot?.data.terminalRuntimes ?? new Map();
if (import.meta.hot) import.meta.hot.data.terminalRuntimes = runtimes;

function token(name: string) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}
function create(id: string): Runtime {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const term = new Terminal({
    fontFamily: 'Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace',
    fontSize: 13,
    scrollback: SCROLLBACK,
    cursorBlink: !reducedMotion,
    windowsPty: windows ? { backend: "conpty" } : undefined,
    theme: {
      background: token("--editor"),
      foreground: token("--text"),
      cursor: token("--text"),
      cursorAccent: token("--editor"),
      selectionBackground: "#37564f",
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const element = document.createElement("div");
  element.className = "terminal-surface";
  const runtime: Runtime = {
    term,
    fit,
    element,
    opened: false,
    started: false,
    input: "",
    writing: false,
    unacked: 0,
    frame: 0,
    resizeTimer: undefined,
  };
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown" || !event.ctrlKey || event.altKey) return true;
    const key = event.key.toLowerCase();
    // Ctrl+C copies only when text is selected; otherwise it reaches the shell as SIGINT.
    if (key === "c" && (event.shiftKey || term.hasSelection())) {
      if (term.hasSelection()) document.execCommand("copy");
      event.preventDefault();
      setTimeout(() => term.clearSelection());
      return false;
    }
    // Let the browser deliver a native paste event, which xterm.js handles (bracketed paste).
    if (key === "v" && (event.shiftKey || windows)) return false;
    return true;
  });
  term.onData((data) => send(id, data));
  term.onResize(({ cols, rows }) => {
    clearTimeout(runtime.resizeTimer);
    // Debounced: the PTY resize must not run on every frame of a split drag.
    runtime.resizeTimer = setTimeout(() => {
      if (getStatus(id) === "running")
        void native("resize_terminal", { id, cols, rows }).catch(() => {});
    }, 80);
  });
  runtimes.set(id, runtime);
  onDispose(id, () => {
    clearTimeout(runtime.resizeTimer);
    cancelAnimationFrame(runtime.frame);
    term.dispose();
    element.remove();
    runtimes.delete(id);
  });
  return runtime;
}
function getStatus(id: string) {
  return hasSession(id) ? getSession(id).status : null;
}
function send(id: string, data: string) {
  const runtime = runtimes.get(id);
  const status = getStatus(id);
  if (!runtime || (status !== "running" && status !== "starting")) return;
  runtime.input += data;
  if (status === "running") void flush(id, runtime);
}
// One write in flight per session keeps keystrokes ordered and batches fast input.
async function flush(id: string, runtime: Runtime) {
  if (runtime.writing) return;
  runtime.writing = true;
  try {
    while (runtime.input && getStatus(id) === "running") {
      const data = runtime.input;
      runtime.input = "";
      await native("write_terminal", { id, data });
    }
  } catch {
    // The shell has exited or the session closed; its state is reported separately.
  } finally {
    runtime.writing = false;
  }
}
function receive(id: string, runtime: Runtime, event: TerminalEvent) {
  if (!runtimes.has(id)) return;
  if (event.kind === "data") {
    runtime.term.write(event.data, () => {
      runtime.unacked += event.data.length;
      if (runtime.unacked >= ACK_BATCH && getStatus(id) === "running") {
        const size = runtime.unacked;
        runtime.unacked = 0;
        void native("ack_terminal", { id, size }).catch(() => {});
      }
    });
    return;
  }
  const detail =
    event.signal ?? (event.code === null ? "" : ` with code ${event.code}`);
  runtime.term.write(`\r\n\x1b[90m[Process exited${detail}]\x1b[0m\r\n`);
  updateSession(id, { status: "exited", exitCode: event.code });
}
export async function start(id: string, shell: string | null = null) {
  const runtime = runtimes.get(id);
  if (!runtime || runtime.started) return;
  runtime.started = true;
  updateSession(id, { status: "starting", error: null });
  fitNow(runtime);
  // Outside the desktop app there is no IPC; native() reports that clearly below.
  const events = isTauri() ? new Channel<TerminalEvent>() : null;
  if (events) events.onmessage = (event) => receive(id, runtime, event);
  try {
    const started = await native<{ shell: string; cwd: string }>(
      "create_terminal",
      {
        id,
        shell,
        directory: getSession(id).directory,
        cols: runtime.term.cols,
        rows: runtime.term.rows,
        events,
      },
    );
    // The tab may have closed while the shell was starting.
    if (!hasSession(id)) {
      void native("close_terminal", { id }).catch(() => {});
      return;
    }
    updateSession(id, {
      shell: started.shell,
      ...(getStatus(id) === "starting" && { status: "running" }),
    });
    void flush(id, runtime);
  } catch (error) {
    runtime.started = false;
    updateSession(id, {
      status: "failed",
      error: String(error).replace(/^Error: /, ""),
    });
  }
}
function fitNow(runtime: Runtime) {
  if (!runtime.element.isConnected || !runtime.fit.proposeDimensions()) return;
  runtime.fit.fit();
}
export function attach(id: string, host: HTMLElement) {
  const runtime = runtimes.get(id) ?? create(id);
  host.append(runtime.element);
  if (!runtime.opened) {
    runtime.term.open(runtime.element);
    runtime.opened = true;
  }
  fitNow(runtime);
  runtime.term.refresh(0, runtime.term.rows - 1);
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(runtime.frame);
    runtime.frame = requestAnimationFrame(() => fitNow(runtime));
  });
  observer.observe(host);
  return {
    runtime,
    detach() {
      observer.disconnect();
      cancelAnimationFrame(runtime.frame);
      // Only the DOM node leaves; the session and emulator keep running.
      if (runtime.element.parentElement === host) runtime.element.remove();
    },
  };
}
export function focus(id: string) {
  runtimes.get(id)?.term.focus();
}
