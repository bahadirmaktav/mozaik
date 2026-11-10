import { useSyncExternalStore } from "react";
import {
  debugBackend,
  type Adapter,
  type AdapterEvent,
  type DebuggersInfo,
} from "../../services/debug";
import {
  activeProject,
  build,
  choices,
  cmakeInfo,
  refresh as refreshCMake,
  selectRunTarget,
} from "./cmake";
import {
  appendConsole,
  breakpointsIn,
  move,
  samePath,
  sourceBreakpoints,
  toggle,
  newBreakpoint,
  PAGE,
  type BreakpointEntry,
  type Capabilities,
  type ConsoleLine,
} from "./debugModel";
import { host, message, reveal } from "./editors";
import { baseName, pathKey, plainPath, within } from "./paths";
import { getProject, projectFor, setView } from "./projects";

/**
 * Debugging of a CMake run target over the Debug Adapter Protocol, after VS Code's Run and
 * Debug: one session at a time. Debug builds the target first (never configures); Rust
 * starts the adapter and builds the launch request. Breakpoints and watch expressions are
 * kept per project in Mozaik's app data.
 */
export interface Thread {
  id: number;
  name: string;
}
export interface Frame {
  id: number;
  name: string;
  path: string | null;
  line: number;
  column: number;
}
export interface Scope {
  name: string;
  variablesReference: number;
  expensive: boolean;
  namedVariables?: number;
  indexedVariables?: number;
}
export interface Variable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  indexedVariables?: number;
  namedVariables?: number;
  /** A child the adapter could not read; its value is the reason. */
  unreadable?: boolean;
}
export interface Children {
  items: Variable[];
  /** All the children the adapter announced, when it pages them. */
  total: number | null;
  loading: boolean;
  error: string | null;
}
export interface WatchValue {
  value: string;
  type?: string;
  variablesReference: number;
  error: boolean;
}
type Phase = "idle" | "checking" | "building" | "starting";
export interface Session {
  id: string;
  /** The IDE project (sidebar instance) it debugs. */
  project: string;
  root: string;
  target: string;
  /** A test's arguments (Testing view), replacing the target's; null for Debug. */
  args: string[] | null;
  adapter: Adapter;
  label: string;
  caps: Capabilities;
  state: "starting" | "running" | "stopped";
  /** Why the program is paused: a breakpoint, a step, an exception or a signal. */
  stop: { reason: string; text: string; threadId: number | null } | null;
  threads: Thread[];
  thread: number | null;
  frames: Frame[];
  frame: number | null;
  scopes: Scope[];
  /** The program's output not yet ended by a line break, by stream. */
  partial: { stdout: string; stderr: string };
  ending: boolean;
}
interface ProjectState {
  loaded: boolean;
  breakpoints: BreakpointEntry[];
  active: boolean;
  watches: string[];
}
interface Store {
  session: Session | null;
  /** Before a session exists: checking the debugger, building, starting. */
  phase: Phase;
  /** Why Debug could not start, shown in Run and Debug until the next try. */
  problem: string | null;
  debuggers: Map<string, DebuggersInfo>;
  states: Map<string, ProjectState>;
  /** Adapter answers for breakpoints, by uid; dropped when the session ends. */
  verified: Map<string, { verified: boolean; message: string }>;
  refused: Map<string, string>;
  children: Map<number, Children>;
  watchValues: Map<string, WatchValue>;
  /** Expanded rows of Variables and Watch, by their path of names; kept across stops. */
  expanded: Set<string>;
  console: ConsoleLine[];
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideDebug ?? {
  session: null,
  phase: "idle",
  problem: null,
  debuggers: new Map(),
  states: new Map(),
  verified: new Map(),
  refused: new Map(),
  children: new Map(),
  watchValues: new Map(),
  expanded: new Set(["Locals", "Arguments"]),
  console: [],
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideDebug = store;
const counter = { value: 0 };

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
export function useDebug() {
  useSyncExternalStore(subscribe, () => store.version);
  return store;
}
export const debugSession = () => store.session;

function log(kind: ConsoleLine["kind"], text: string) {
  store.console = appendConsole(store.console, [{ kind, text }], counter);
  emit();
}
export function clearConsole() {
  store.console = [];
  emit();
}

// --- Breakpoints and watch expressions, per project root -------------------------------

const rootOf = (path: string) => projectFor(path)?.root ?? null;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
function stateOf(root: string): ProjectState {
  const key = pathKey(root);
  let state = store.states.get(key);
  if (!state) {
    state = { loaded: false, breakpoints: [], active: true, watches: [] };
    store.states.set(key, state);
    void debugBackend
      .state(root)
      .then((saved) => {
        const current = store.states.get(key);
        if (!current || current.loaded) return;
        // Breakpoints set while loading stay; saved ones on other lines join them.
        let breakpoints = current.breakpoints;
        for (const bp of saved.breakpoints)
          if (
            !breakpoints.some(
              (b) => samePath(b.path, bp.path) && b.line === bp.line,
            )
          )
            breakpoints = [...breakpoints, { ...bp, uid: crypto.randomUUID() }];
        store.states.set(key, {
          loaded: true,
          breakpoints,
          active: saved.breakpointsActive,
          watches: saved.watches,
        });
        emit();
        if (current.breakpoints.length) persist(root);
        syncAll();
      })
      .catch(() => {
        // Without the desktop app (or with a damaged state file) nothing is loaded and,
        // having never loaded, nothing is written over it.
      });
  }
  return state;
}
/** Breakpoints and watches of the project containing `path` (loaded on first use). */
export function projectDebug(root: string | null) {
  return root ? stateOf(root) : null;
}
function persist(root: string) {
  const key = pathKey(root);
  clearTimeout(saveTimers.get(key));
  saveTimers.set(
    key,
    setTimeout(() => {
      const state = store.states.get(key);
      if (!state?.loaded) return;
      void debugBackend
        .setState(root, {
          breakpoints: state.breakpoints.map(({ uid: _, ...bp }) => bp),
          breakpointsActive: state.active,
          watches: state.watches,
        })
        .catch((e) => host().report(e));
    }, 400),
  );
}
function change(root: string, update: Partial<ProjectState>) {
  const key = pathKey(root);
  const before = stateOf(root);
  const next = { ...before, ...update };
  store.states.set(key, next);
  emit();
  persist(root);
  // The session's adapter follows, for every file whose breakpoints changed.
  if (update.breakpoints) {
    const files = new Map<string, string>();
    for (const bp of [...before.breakpoints, ...next.breakpoints])
      files.set(pathKey(bp.path), bp.path);
    const old = new Map(before.breakpoints.map((b) => [b.uid, b]));
    for (const [, path] of files) {
      const was = breakpointsIn(before.breakpoints, path);
      const now = breakpointsIn(next.breakpoints, path);
      if (was.length !== now.length || now.some((b) => old.get(b.uid) !== b))
        scheduleSync(path);
    }
  }
  if (update.active !== undefined) syncAll();
  if (update.watches) void evaluateWatches();
}
export function breakpointsAt(path: string | null) {
  const root = path && rootOf(path);
  return root ? breakpointsIn(stateOf(root).breakpoints, path) : [];
}
export function allBreakpoints() {
  return [...store.states.values()].flatMap((s) => s.breakpoints);
}
/** Adds or removes a line breakpoint; false outside a project (nowhere to keep it). */
export function toggleBreakpoint(path: string, line: number) {
  const root = rootOf(path);
  if (!root) {
    host().report("Breakpoints can be set in files of an open IDE project");
    return false;
  }
  change(root, { breakpoints: toggle(stateOf(root).breakpoints, path, line) });
  return true;
}
export function setBreakpoint(
  path: string,
  line: number,
  fields: Partial<BreakpointEntry>,
) {
  const root = rootOf(path);
  if (!root) return toggleBreakpoint(path, line);
  const list = stateOf(root).breakpoints;
  const found = list.find((b) => samePath(b.path, path) && b.line === line);
  change(root, {
    breakpoints: found
      ? list.map((b) => (b === found ? { ...b, ...fields } : b))
      : [...list, newBreakpoint(path, line, fields)],
  });
  return true;
}
export function updateBreakpoint(
  uid: string,
  fields: Partial<BreakpointEntry>,
) {
  for (const [, state] of store.states) {
    const found = state.breakpoints.find((b) => b.uid === uid);
    if (!found) continue;
    const root = rootOf(found.path);
    if (root)
      change(root, {
        breakpoints: state.breakpoints.map((b) =>
          b === found ? { ...b, ...fields } : b,
        ),
      });
    return;
  }
}
export function removeBreakpoint(uid: string) {
  for (const [, state] of store.states) {
    const found = state.breakpoints.find((b) => b.uid === uid);
    const root = found && rootOf(found.path);
    if (root)
      return change(root, {
        breakpoints: state.breakpoints.filter((b) => b !== found),
      });
  }
}
/** Lines after an edit in an open file, by uid. */
export function moveBreakpoints(path: string, lines: Map<string, number>) {
  const root = rootOf(path);
  if (!root) return;
  const list = stateOf(root).breakpoints;
  const moved = move(list, lines);
  if (moved.length !== list.length || moved.some((b, i) => b !== list[i]))
    change(root, { breakpoints: moved });
}
export function removeAllBreakpoints(root: string) {
  change(root, { breakpoints: [] });
}
export function enableAllBreakpoints(root: string, enabled: boolean) {
  change(root, {
    breakpoints: stateOf(root).breakpoints.map((b) =>
      b.enabled === enabled ? b : { ...b, enabled },
    ),
  });
}
/** VS Code's "Toggle Activate Breakpoints": none is set, all are kept. */
export function setBreakpointsActive(root: string, active: boolean) {
  change(root, { active });
}
export function addWatch(root: string, expression: string) {
  const text = expression.trim();
  if (text) change(root, { watches: [...stateOf(root).watches, text] });
}
export function editWatch(root: string, index: number, expression: string) {
  const watches = [...stateOf(root).watches];
  if (expression.trim()) watches[index] = expression.trim();
  else watches.splice(index, 1);
  change(root, { watches });
}
export function removeWatch(root: string, index: number) {
  change(root, {
    watches: stateOf(root).watches.filter((_, i) => i !== index),
  });
}

// --- The adapter connection -------------------------------------------------------------

interface Pending {
  resolve: (body: unknown) => void;
  reject: (error: Error) => void;
}
let seq = 1;
const pending = new Map<number, Pending>();
let initialized: (() => void) | null = null;
/** Adapter breakpoint IDs to Mozaik's uids, for `breakpoint` events. */
const breakpointIds = new Map<number, string>();
/** Files whose breakpoints were sent, so emptied ones are cleared at the adapter. */
const sentFiles = new Map<string, string>();

function expect(id: number) {
  return new Promise<unknown>((resolve, reject) =>
    pending.set(id, { resolve, reject }),
  );
}
function request<T = unknown>(command: string, args?: object): Promise<T> {
  const session = store.session;
  if (!session) return Promise.reject(new Error("No debug session is running"));
  const id = seq++;
  const answer = expect(id) as Promise<T>;
  void debugBackend
    .send(
      session.id,
      JSON.stringify({ seq: id, type: "request", command, arguments: args }),
    )
    .catch((e) => {
      pending.get(id)?.reject(new Error(message(e)));
      pending.delete(id);
    });
  return answer;
}
function withTimeout<T>(work: Promise<T>, ms: number) {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("The debugger did not answer")), ms),
    ),
  ]);
}

interface DapMessage {
  type: "response" | "event" | "request";
  request_seq?: number;
  success?: boolean;
  message?: string;
  command?: string;
  event?: string;
  body?: any;
}
function receive(id: string, event: AdapterEvent) {
  if (store.session?.id !== id) return;
  if (event.kind === "exit") {
    if (!store.session.ending) {
      log(
        "error",
        `The debugger exited unexpectedly${event.code === null ? "" : ` (code ${event.code})`}.`,
      );
      if (event.log) log("error", event.log);
      host().report("The debugger exited unexpectedly; see the Debug Console");
    }
    finish();
    return;
  }
  let data: DapMessage;
  try {
    data = JSON.parse(event.data);
  } catch {
    return;
  }
  if (data.type === "response" && data.request_seq !== undefined) {
    const waiting = pending.get(data.request_seq);
    pending.delete(data.request_seq);
    if (!waiting) return;
    if (data.success) waiting.resolve(data.body);
    else
      waiting.reject(
        new Error(
          data.body?.error?.format ?? data.message ?? `${data.command} failed`,
        ),
      );
    return;
  }
  if (data.type === "event") onEvent(data.event ?? "", data.body ?? {});
}
function onEvent(name: string, body: any) {
  const session = store.session!;
  switch (name) {
    case "initialized":
      initialized?.();
      initialized = null;
      break;
    case "output": {
      const text = String(body.output ?? "");
      const category: string = body.category ?? "console";
      if (category === "telemetry") break;
      // The program's own output (GDB reports some of its messages there too), line by
      // line, as in VS Code's internal console.
      if (category === "stdout" || category === "stderr") {
        const lines = (session.partial[category] + text)
          .replace(/\r\n/g, "\n")
          .split("\n");
        session.partial[category] = lines.pop()!;
        for (const line of lines)
          log(category === "stderr" ? "error" : "program", line);
      } else
        log(
          category === "stderr" ? "error" : "output",
          text.replace(/\n$/, ""),
        );
      break;
    }
    case "stopped":
      session.state = "stopped";
      session.stop = {
        reason: body.reason ?? "pause",
        text: body.text ?? body.description ?? "",
        threadId: body.threadId ?? null,
      };
      if (body.reason === "exception" || body.reason === "signal")
        log(
          "error",
          `Paused on ${body.reason}${body.text || body.description ? `: ${body.text ?? body.description}` : ""}`,
        );
      emit();
      void loadStop(body.threadId ?? null).catch((e) =>
        log("error", message(e)),
      );
      break;
    case "continued":
      running();
      break;
    case "thread":
      if (body.reason === "exited") {
        session.threads = session.threads.filter((t) => t.id !== body.threadId);
        emit();
      }
      break;
    case "breakpoint": {
      const uid = breakpointIds.get(body.breakpoint?.id);
      if (uid) {
        store.verified.set(uid, {
          verified: !!body.breakpoint.verified,
          message: body.breakpoint.message ?? body.breakpoint.reason ?? "",
        });
        emit();
      }
      break;
    }
    case "exited":
      log("info", `The program exited with code ${body.exitCode}.`);
      break;
    case "terminated":
      void end(false);
      break;
  }
}

/** While the program runs, nothing from the last pause is shown as current. */
function running() {
  const session = store.session;
  if (!session) return;
  session.state = "running";
  session.stop = null;
  session.frames = [];
  session.frame = null;
  session.scopes = [];
  store.children.clear();
  store.watchValues.clear();
  emit();
}
let epoch = 0;
async function loadStop(threadId: number | null) {
  const session = store.session;
  if (!session) return;
  const mine = ++epoch;
  const { threads } = await request<{ threads: Thread[] }>("threads");
  if (mine !== epoch || store.session !== session) return;
  session.threads = threads;
  const thread = threadId ?? session.thread ?? threads[0]?.id ?? null;
  emit();
  if (thread !== null) await selectThread(thread, mine);
}
export async function selectThread(thread: number, mine = ++epoch) {
  const session = store.session;
  if (!session || session.state !== "stopped") return;
  session.thread = thread;
  const trace = await request<{ stackFrames: any[] }>("stackTrace", {
    threadId: thread,
    startFrame: 0,
    levels: 200,
  });
  if (mine !== epoch || store.session !== session) return;
  session.frames = trace.stackFrames.map((f) => ({
    id: f.id,
    name: f.name,
    path: f.source?.path ?? null,
    line: f.line ?? 0,
    column: f.column ?? 0,
  }));
  emit();
  // The top frame with source code, as editors show it.
  const frame = session.frames.find((f) => f.path) ?? session.frames[0];
  if (frame) await selectFrame(frame.id, mine);
}
export async function selectFrame(id: number, mine = ++epoch) {
  const session = store.session;
  const frame = session?.frames.find((f) => f.id === id);
  if (!session || !frame) return;
  session.frame = id;
  session.scopes = [];
  store.children.clear();
  emit();
  if (frame.path)
    // The paused line has its own highlight.
    void reveal(
      frame.path,
      { line: frame.line, column: Math.max(frame.column - 1, 0) },
      { highlight: false },
    ).catch(() => {});
  const { scopes } = await request<{ scopes: Scope[] }>("scopes", {
    frameId: id,
  });
  if (mine !== epoch || store.session !== session) return;
  session.scopes = scopes;
  emit();
  await evaluateWatches();
}
/**
 * Children of a variable, scope or watch value, paged for large containers. `size` is how
 * many children the adapter announced in all: if it cannot answer for all of them at once,
 * they are read one at a time, so one unreadable child does not hide the others.
 */
export async function loadChildren(
  reference: number,
  more = false,
  announced: number | null = null,
  size: number | null = null,
) {
  const session = store.session;
  if (!session || session.state !== "stopped" || !reference) return;
  const known = store.children.get(reference);
  if (known?.loading || (known && !more)) return;
  const start = more ? (known?.items.length ?? 0) : 0;
  store.children.set(reference, {
    items: known?.items ?? [],
    total: announced ?? known?.total ?? null,
    loading: true,
    error: null,
  });
  emit();
  const mine = epoch;
  const paged = announced !== null && announced > PAGE;
  try {
    const variables = await request<{ variables: Variable[] }>(
      "variables",
      paged
        ? {
            variablesReference: reference,
            filter: "indexed",
            start,
            count: PAGE,
          }
        : { variablesReference: reference },
    )
      .then((answer) => answer.variables)
      .catch(async (e) => {
        // GDB answers for all children at once, and one value its pretty-printer cannot read
        // (such as a local not constructed yet, still holding junk) fails the whole answer.
        const end = Math.min(
          paged ? announced : (size ?? 0),
          start + (paged ? PAGE : ONE_BY_ONE),
        );
        if (end <= start) throw e;
        return oneByOne(reference, start, end);
      });
    if (mine !== epoch) return;
    store.children.set(reference, {
      items: [...(more ? (known?.items ?? []) : []), ...variables],
      total: paged ? announced : null,
      loading: false,
      error: null,
    });
  } catch (e) {
    if (mine !== epoch) return;
    store.children.set(reference, {
      items: known?.items ?? [],
      total: null,
      loading: false,
      error: message(e),
    });
  }
  emit();
}
/** At most this many children are read one at a time after the adapter failed on all of them. */
const ONE_BY_ONE = 200;
async function oneByOne(reference: number, start: number, end: number) {
  const items: Variable[] = [];
  for (let index = start; index < end; index++) {
    try {
      const { variables } = await request<{ variables: Variable[] }>(
        "variables",
        { variablesReference: reference, start: index, count: 1 },
      );
      items.push(...variables);
    } catch (e) {
      items.push({
        name: `#${index + 1}`,
        value: message(e),
        variablesReference: 0,
        unreadable: true,
      });
    }
  }
  return items;
}
export function setExpanded(path: string, open: boolean) {
  if (open) store.expanded.add(path);
  else store.expanded.delete(path);
  emit();
}
/** Set Value: the adapter checks and converts the text. */
export async function setVariable(
  parent: number,
  variable: Variable,
  value: string,
) {
  const session = store.session;
  if (!session?.caps.supportsSetVariable)
    throw new Error("This debugger cannot change values");
  const result = await request<{ value: string; type?: string }>(
    "setVariable",
    { variablesReference: parent, name: variable.name, value },
  );
  const children = store.children.get(parent);
  if (children)
    store.children.set(parent, {
      ...children,
      items: children.items.map((v) =>
        v === variable
          ? { ...v, value: result.value, type: result.type ?? v.type }
          : v,
      ),
    });
  emit();
  await evaluateWatches();
}
const frameId = () =>
  store.session?.state === "stopped" ? store.session.frame : null;
async function evaluate(expression: string, context: "watch" | "hover") {
  const frame = frameId();
  return request<{ result: string; type?: string; variablesReference: number }>(
    "evaluate",
    { expression, context, ...(frame !== null && { frameId: frame }) },
  );
}
async function evaluateWatches() {
  const session = store.session;
  if (!session || session.state !== "stopped") return;
  const mine = epoch;
  const watches = stateOf(session.root).watches;
  const values = new Map<string, WatchValue>();
  for (const expression of new Set(watches)) {
    try {
      const result = await evaluate(expression, "watch");
      values.set(expression, {
        value: result.result,
        type: result.type,
        variablesReference: result.variablesReference,
        error: false,
      });
    } catch (e) {
      values.set(expression, {
        value: message(e),
        variablesReference: 0,
        error: true,
      });
    }
    if (mine !== epoch) return;
  }
  store.watchValues = values;
  emit();
}
/** Debug Hover: an expression's value in the selected frame, only while paused. */
export async function hoverValue(expression: string) {
  const session = store.session;
  if (!session || session.state !== "stopped") return null;
  const context = session.caps.supportsEvaluateForHovers ? "hover" : "watch";
  try {
    const result = await evaluate(expression, context);
    return {
      value: result.result,
      type: result.type,
      variablesReference: result.variablesReference,
    };
  } catch {
    return null;
  }
}
/** The Debug Console evaluates expressions in the selected frame (never debugger commands). */
export async function evaluateConsole(expression: string) {
  const text = expression.trim();
  if (!text) return;
  log("input", text);
  const session = store.session;
  if (!session) return log("error", "No debug session is running.");
  if (session.state !== "stopped")
    return log("error", "Pause the program to evaluate expressions.");
  try {
    const result = await evaluate(text, "watch");
    log("result", result.result);
  } catch (e) {
    log("error", message(e));
  }
}

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleSync(path: string) {
  if (!store.session) return;
  const key = pathKey(path);
  clearTimeout(syncTimers.get(key));
  syncTimers.set(
    key,
    setTimeout(
      () => void syncFile(path).catch((e) => log("error", message(e))),
      150,
    ),
  );
}
function syncAll() {
  const session = store.session;
  if (!session || session.state === "starting") return;
  for (const path of filesOf(session.root)) scheduleSync(path);
}
function filesOf(root: string) {
  const files = new Map<string, string>(sentFiles);
  for (const bp of stateOf(root).breakpoints)
    if (within(root, bp.path)) files.set(pathKey(bp.path), bp.path);
  return [...files.values()];
}
/** Sends a file's breakpoints (all of them: DAP replaces a file's list). */
async function syncFile(path: string) {
  const session = store.session;
  if (!session) return;
  const state = stateOf(session.root);
  const list = breakpointsIn(state.breakpoints, path);
  const { sent, refused } = state.active
    ? sourceBreakpoints(list, session.adapter, session.caps)
    : { sent: [], refused: new Map<string, string>() };
  for (const bp of list) {
    const reason = refused.get(bp.uid);
    if (reason) store.refused.set(bp.uid, reason);
    else store.refused.delete(bp.uid);
  }
  if (!sent.length && !sentFiles.has(pathKey(path))) return emit();
  const result = await request<{ breakpoints: any[] }>("setBreakpoints", {
    source: { path: plainPath(path), name: baseName(path) },
    breakpoints: sent.map((s) => s.breakpoint),
    lines: sent.map((s) => s.breakpoint.line),
  });
  if (store.session !== session) return;
  if (sent.length) sentFiles.set(pathKey(path), path);
  else sentFiles.delete(pathKey(path));
  result.breakpoints.forEach((answer, index) => {
    const uid = sent[index]?.uid;
    if (!uid) return;
    if (typeof answer.id === "number") breakpointIds.set(answer.id, uid);
    store.verified.set(uid, {
      verified: !!answer.verified,
      message: answer.message ?? answer.reason ?? "",
    });
  });
  emit();
}

// --- Session lifecycle ------------------------------------------------------------------

/** The project's debuggers: what Debug would start, or why it cannot. */
export async function loadDebuggers(root: string) {
  const info = await debugBackend.debuggers(root);
  store.debuggers.set(pathKey(root), info);
  emit();
  return info;
}
function setPhase(phase: Phase) {
  store.phase = phase;
  emit();
}
const busy = () => !!store.session || store.phase !== "idle";

/**
 * Debug: builds the run target (configure stays the user's), then starts its debugger.
 * One session at a time. `test` debugs a test of the Testing view instead: its program
 * with the arguments that run only that test.
 */
export async function startDebugging(
  projectId = activeProject()?.id,
  test: { target: string; args: string[] } | null = null,
) {
  if (busy())
    return host().report("A debug session is already running. Stop it first.");
  const project = projectId ? getProject(projectId) : null;
  const root = project?.root;
  if (!project || !root)
    return host().report("Open a CMake project to debug it");
  store.problem = null;
  setPhase("checking");
  try {
    if (!cmakeInfo(project.id)) await refreshCMake(project.id);
    if (!cmakeInfo(project.id)?.cmake)
      throw new Error(
        "This project has no CMakeLists.txt (see Project Settings)",
      );
    const target =
      test?.target ??
      choices(project.id).runTarget ??
      (await selectRunTarget(project.id));
    if (!target) return;
    const known = cmakeInfo(project.id)?.targets?.find(
      (t) => t.name === target,
    );
    if (known && known.kind !== "EXECUTABLE")
      throw new Error(
        `${target} is not an executable target, so it cannot be debugged`,
      );
    const debuggers = await loadDebuggers(root);
    if (!debuggers.selected)
      throw new Error(debuggers.error ?? "No debugger is available");
    setPhase("building");
    if (!(await build(project.id, target)))
      throw new Error(
        "The build did not succeed, so debugging did not start (Output → CMake)",
      );
    setPhase("starting");
    await launch(project.id, root, target, test?.args ?? null);
  } catch (e) {
    store.problem = message(e);
    host().report(e);
    if (store.session) finish();
  } finally {
    setPhase("idle");
  }
}
async function launch(
  project: string,
  root: string,
  target: string,
  args: string[] | null,
) {
  const id = crypto.randomUUID();
  store.console = [];
  store.verified.clear();
  store.refused.clear();
  breakpointIds.clear();
  sentFiles.clear();
  host().showPanel(root, "debug");
  store.session = {
    id,
    project,
    root,
    target,
    args,
    adapter: "gdb",
    label: "Debugger",
    caps: {},
    state: "starting",
    stop: null,
    threads: [],
    thread: null,
    frames: [],
    frame: null,
    scopes: [],
    partial: { stdout: "", stderr: "" },
    ending: false,
  };
  emit();
  const started = await debugBackend.start(id, root, (event) =>
    receive(id, event),
  );
  const session = store.session;
  if (session?.id !== id) return;
  session.adapter = started.adapter;
  session.label = started.label;
  log("info", `Starting ${started.label} (${started.program})…`);
  session.caps =
    (await withTimeout(
      request<Capabilities>("initialize", {
        clientID: "mozaik",
        clientName: "Mozaik",
        adapterID: started.adapter,
        locale: "en",
        pathFormat: "path",
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsVariableType: true,
        supportsVariablePaging: true,
        supportsRunInTerminalRequest: false,
      }),
      30000,
    )) ?? {};
  const ready = new Promise<void>((resolve) => (initialized = resolve));
  // Rust builds the launch request; its answer may only come after configurationDone.
  const launchSeq = seq++;
  const launched = expect(launchSeq);
  const plan = await debugBackend.launch(id, launchSeq, root, target, args);
  log(
    "info",
    `Debugging ${plan.program}${plan.args.length ? ` ${plan.args.join(" ")}` : ""} in ${plan.cwd}`,
  );
  await withTimeout(ready, 30000);
  stateOf(root);
  await Promise.all(filesOf(root).map((path) => syncFile(path)));
  if (session.caps.supportsConfigurationDoneRequest !== false)
    await request("configurationDone");
  await withTimeout(launched, 60000);
  if (store.session === session && session.state === "starting") {
    session.state = "running";
    emit();
  }
}
/** Ends the session: the program is terminated, the adapter stopped. */
export async function stopDebugging() {
  await end(true);
}
async function end(terminate: boolean) {
  const session = store.session;
  if (!session || session.ending) return;
  session.ending = true;
  emit();
  try {
    await withTimeout(
      request("disconnect", { terminateDebuggee: terminate, restart: false }),
      3000,
    );
  } catch {
    // The adapter is stopped below either way.
  }
  if (store.session === session) finish();
}
function finish() {
  const session = store.session;
  if (!session) return;
  void debugBackend.stop(session.id).catch(() => {});
  for (const [, waiting] of pending)
    waiting.reject(new Error("The debug session ended"));
  pending.clear();
  initialized = null;
  for (const stream of ["stdout", "stderr"] as const)
    if (session.partial[stream])
      log(stream === "stderr" ? "error" : "program", session.partial[stream]);
  store.session = null;
  store.verified.clear();
  store.children.clear();
  store.watchValues.clear();
  breakpointIds.clear();
  sentFiles.clear();
  epoch++;
  log("info", "The debug session ended.");
}
/** Restart stops the session and debugs again, building first like Debug. */
export async function restartDebugging() {
  const session = store.session;
  await stopDebugging();
  if (session)
    await startDebugging(
      session.project,
      session.args && { target: session.target, args: session.args },
    );
}
type Step = "continue" | "next" | "stepIn" | "stepOut";
function control(command: Step) {
  const session = store.session;
  if (!session || session.state !== "stopped") return;
  const threadId = session.thread ?? session.threads[0]?.id ?? 1;
  running();
  void request(command, { threadId }).catch((e) => host().report(e));
}
export const continueDebugging = () => control("continue");
export const stepOver = () => control("next");
export const stepInto = () => control("stepIn");
export const stepOut = () => control("stepOut");
export function pauseDebugging() {
  const session = store.session;
  if (!session || session.state !== "running") return;
  const threadId = session.thread ?? session.threads[0]?.id ?? 1;
  void request("pause", { threadId }).catch((e) => host().report(e));
}
/** Closing an IDE ends its session. */
export function closeProject(project: string) {
  if (store.session?.project === project) void stopDebugging();
}
/** Where the selected frame is paused, for the editors: file, line, top of the stack. */
export function pausedAt() {
  const session = store.session;
  if (!session || session.state !== "stopped") return null;
  const index = session.frames.findIndex((f) => f.id === session.frame);
  const frame = session.frames[index];
  return frame?.path
    ? { path: frame.path, line: frame.line, top: index === 0 }
    : null;
}
export const verification = (uid: string) => store.verified.get(uid) ?? null;
export const refusal = (uid: string) => store.refused.get(uid) ?? null;
export const isDebugging = () => !!store.session;
export const debugPhase = () => store.phase;

const CHOOSE = "\0choose:";
const RESET = "\0reset:";
/** Debug: Select Debugger: automatic, a found adapter, or a program chosen in a dialog. */
export async function selectDebugger(projectId = activeProject()?.id) {
  const root = projectId ? getProject(projectId)?.root : null;
  if (!root) return host().report("Open a CMake project first");
  const info = await loadDebuggers(root);
  const auto = info.adapters.find((a) => a.adapter === info.selected);
  const picked = await host().pick("Select a debugger", [
    {
      id: "auto",
      label: `Automatic${info.choice === "auto" ? " (current)" : ""}`,
      detail: info.compiler
        ? `For ${info.compiler}: ${auto && info.choice === "auto" ? auto.label : (info.error ?? "GDB or LLDB")}`
        : "GDB for GCC, LLDB for Clang",
    },
    ...info.adapters.map((a) => ({
      id: a.adapter,
      label: `${a.label}${info.choice === a.adapter ? " (current)" : ""}`,
      detail: a.problem ?? a.path ?? "",
    })),
    ...info.adapters.map((a) => ({
      id: CHOOSE + a.adapter,
      label: `Choose the ${a.adapter === "gdb" ? "GDB" : "lldb-dap"} program…`,
      detail: "A native file dialog; remembered for this project",
    })),
    ...info.adapters
      .filter((a) => a.chosen)
      .map((a) => ({
        id: RESET + a.adapter,
        label: `Forget the chosen ${a.label} program`,
        detail: a.path ?? "",
      })),
  ]);
  if (!picked) return;
  let next: DebuggersInfo | null;
  if (picked.startsWith(CHOOSE))
    next = await debugBackend.chooseDebugger(
      root,
      picked.slice(CHOOSE.length) as Adapter,
    );
  else if (picked.startsWith(RESET))
    next = await debugBackend.resetDebugger(
      root,
      picked.slice(RESET.length) as Adapter,
    );
  else next = await debugBackend.setChoice(root, picked as "auto" | Adapter);
  if (!next) return;
  store.debuggers.set(pathKey(root), next);
  if (next.selected) store.problem = null;
  emit();
  if (next.error) host().report(next.error);
}

/** The palette's Debug commands, as in VS Code (no default shortcuts). */
export function commands(current: { path: string; line: number } | null) {
  const project = activeProject();
  const root = project?.root ?? null;
  const session = store.session;
  const list: { id: string; label: string; run: () => void }[] = [];
  const report = (work: unknown) =>
    void Promise.resolve(work).catch((e) => host().report(e));
  const add = (key: string, label: string, run: () => unknown) =>
    list.push({
      id: `debug.${key}`,
      label: `Debug: ${label}`,
      run: () => report(run()),
    });
  if (!session && project && cmakeInfo(project.id)?.cmake)
    add("start", "Start Debugging", () => startDebugging(project.id));
  if (session) {
    if (session.state === "stopped") {
      add("continue", "Continue", continueDebugging);
      add("stepOver", "Step Over", stepOver);
      add("stepInto", "Step Into", stepInto);
      add("stepOut", "Step Out", stepOut);
    } else add("pause", "Pause", pauseDebugging);
    add("restart", "Restart", restartDebugging);
    add("stop", "Stop", stopDebugging);
  }
  if (project && cmakeInfo(project.id)?.cmake)
    add("debugger", "Select Debugger", () => selectDebugger(project.id));
  if (current && projectFor(current.path))
    add("toggle", "Toggle Breakpoint", () =>
      toggleBreakpoint(current.path, current.line),
    );
  if (root && stateOf(root).breakpoints.length) {
    add("enableAll", "Enable All Breakpoints", () =>
      enableAllBreakpoints(root, true),
    );
    add("disableAll", "Disable All Breakpoints", () =>
      enableAllBreakpoints(root, false),
    );
    add("removeAll", "Remove All Breakpoints", () =>
      removeAllBreakpoints(root),
    );
    add("activate", "Toggle Activate Breakpoints", () =>
      setBreakpointsActive(root, !stateOf(root).active),
    );
  }
  if (project)
    add("view", "Show Run and Debug", () => setView(project.id, "debug"));
  add("console", "Focus on Debug Console", () =>
    host().showPanel(root, "debug"),
  );
  return list;
}

/**
 * What a debug key does now, after VS Code: F5 continues a paused program or starts
 * debugging the active project, the steps act while paused, Pause while running, Stop and
 * Restart while a session lasts, F9 toggles a breakpoint at the code editor's line. `null`
 * when the key does nothing now, so it stays with the focused module.
 */
export function debugShortcut(
  id: string,
  current: { path: string; line: number } | null,
): (() => unknown) | null {
  const session = store.session;
  const paused = session?.state === "stopped";
  switch (id) {
    case "debug.continue": {
      if (session) return paused ? continueDebugging : null;
      const project = activeProject();
      return project && cmakeInfo(project.id)?.cmake
        ? () => startDebugging(project.id)
        : null;
    }
    case "debug.pause":
      return session?.state === "running" ? pauseDebugging : null;
    case "debug.stepOver":
      return paused ? stepOver : null;
    case "debug.stepInto":
      return paused ? stepInto : null;
    case "debug.stepOut":
      return paused ? stepOut : null;
    case "debug.stop":
      return session ? stopDebugging : null;
    case "debug.restart":
      return session ? restartDebugging : null;
    case "debug.breakpoint":
      return current && projectFor(current.path)
        ? () => toggleBreakpoint(current.path, current.line)
        : null;
  }
  return null;
}
