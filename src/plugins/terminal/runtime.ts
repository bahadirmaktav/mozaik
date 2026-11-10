import { Channel, isTauri } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { native } from "../../services/native";
import {
  getSession,
  hasSession,
  onDispose,
  takeOutput,
  updateSession,
} from "./sessions";
import { currentTerminalFont, onTerminalFont } from "../../workspace/fonts";
import { currentTheme, onTheme, type Theme } from "../../workspace/themes";
import { onIdeZoom } from "../../workspace/ideZoom";
import { onModuleZoom } from "../../workspace/moduleZoom";

type TerminalEvent =
  | { kind: "data"; data: string }
  | { kind: "exit"; code: number | null; signal: string | null };
interface Runtime {
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  /** The shown view's keys before the shell's: true when it took the key (its Find). */
  keys: ((event: KeyboardEvent) => boolean) | null;
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
// ANSI colors around the example prompt's (cyan path, violet venv, amber Git and prompt
// mark) so shell output matches it; a prompt's own hex colors pass through.
const PALETTE = {
  black: "#3b4048",
  red: "#e06c75",
  green: "#98c379",
  yellow: "#e8cc97",
  blue: "#61afef",
  magenta: "#9e7eff",
  cyan: "#56b6c2",
  white: "#abb2bf",
  brightBlack: "#5c6370",
  brightRed: "#ef8891",
  brightGreen: "#b0d991",
  brightYellow: "#ffe082",
  brightBlue: "#82c0f4",
  brightMagenta: "#b9a2ff",
  brightCyan: "#7fcbd5",
  brightWhite: "#dce0e6",
};
// The same hues, dark enough to read on the light themes.
const LIGHT_PALETTE = {
  black: "#2b2f36",
  red: "#c0392b",
  green: "#3d7a2e",
  yellow: "#94640f",
  blue: "#2c62b8",
  magenta: "#8a3fb8",
  cyan: "#17806f",
  white: "#6b7280",
  brightBlack: "#5d6571",
  brightRed: "#d0453a",
  brightGreen: "#4a8f36",
  brightYellow: "#a8730f",
  brightBlue: "#3b74cc",
  brightMagenta: "#9a52c8",
  brightCyan: "#1f9483",
  brightWhite: "#1f2329",
};
/** xterm.js colors of a theme; its tokens are already on the page. */
function colors(theme: Theme) {
  return {
    background: token("--editor"),
    foreground: token("--text"),
    cursor: token("--text"),
    cursorAccent: token("--editor"),
    selectionBackground: token("--selection"),
    ...(theme.dark ? PALETTE : LIGHT_PALETTE),
  };
}
function create(id: string): Runtime {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const term = new Terminal({
    fontFamily: currentTerminalFont(),
    fontSize: 13,
    scrollback: SCROLLBACK,
    cursorBlink: !reducedMotion,
    windowsPty: windows ? { backend: "conpty" } : undefined,
    theme: colors(currentTheme()),
    // The search addon's match highlights are decorations.
    allowProposedApi: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon();
  term.loadAddon(search);
  const element = document.createElement("div");
  element.className = "terminal-surface";
  const runtime: Runtime = {
    term,
    fit,
    search,
    keys: null,
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
    if (event.type === "keydown" && runtime.keys?.(event)) return false;
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
  // The workspace reads it: Ctrl+Shift+C copies a selection and otherwise closes the panel.
  term.onSelectionChange(() =>
    element.toggleAttribute("data-selection", term.hasSelection()),
  );
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
  if (hasSession(id) && getSession(id).output) return;
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
  if (getSession(id).output) {
    const write = (text: string) => runtime.term.write(text);
    write(takeOutput(id, write));
    return;
  }
  updateSession(id, { status: "starting", error: null });
  fitNow(runtime);
  // Outside the desktop app there is no IPC; native() reports that clearly below.
  const events = isTauri() ? new Channel<TerminalEvent>() : null;
  if (events) events.onmessage = (event) => receive(id, runtime, event);
  try {
    const started = await native<{
      shell: string;
      cwd: string;
      warning: string | null;
    }>("create_terminal", {
      id,
      shell,
      directory: getSession(id).directory,
      run: getSession(id).run,
      agent: getSession(id).agent,
      cols: runtime.term.cols,
      rows: runtime.term.rows,
      events,
    });
    // The tab may have closed while the shell was starting.
    if (!hasSession(id)) {
      void native("close_terminal", { id }).catch(() => {});
      return;
    }
    // The PowerShell prompt of the settings could not be loaded; the shell runs anyway.
    if (started.warning)
      runtime.term.write(`\x1b[33m[${started.warning}]\x1b[0m\r\n`);
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
// A font chosen in Workspace Settings applies to running terminals at once.
onTerminalFont((font) => {
  for (const runtime of runtimes.values()) {
    runtime.term.options.fontFamily = font;
    fitNow(runtime);
  }
});
// So does a theme, also while the palette previews it.
onTheme((theme) => {
  const next = colors(theme);
  for (const runtime of runtimes.values()) runtime.term.options.theme = next;
});
// And the font size: the IDE's to the terminals of its panels, the Terminal's to the others.
const refit = () => {
  for (const runtime of runtimes.values()) fitNow(runtime);
};
onIdeZoom(refit);
onModuleZoom(refit);
/** 13px, scaled by the zoom of the panel it is in (`--ide-zoom` in App.css). */
function fontSize(element: HTMLElement) {
  const zoom = parseFloat(
    getComputedStyle(element).getPropertyValue("--ide-zoom"),
  );
  return Math.round(13 * (zoom > 0 ? zoom : 1));
}
function fitNow(runtime: Runtime) {
  if (!runtime.element.isConnected) return;
  const size = fontSize(runtime.element);
  if (runtime.term.options.fontSize !== size)
    runtime.term.options.fontSize = size;
  if (!runtime.fit.proposeDimensions()) return;
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
/** The session's search, and where the view's keys go first (`null` gives them back). */
export function searchOf(id: string) {
  return runtimes.get(id)?.search ?? null;
}
export function selectionOf(id: string) {
  return runtimes.get(id)?.term.getSelection() ?? "";
}
export function setKeys(
  id: string,
  keys: ((event: KeyboardEvent) => boolean) | null,
) {
  const runtime = runtimes.get(id);
  if (runtime) runtime.keys = keys;
}
export function focus(id: string) {
  runtimes.get(id)?.term.focus();
}
