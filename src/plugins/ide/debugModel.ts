import type { Adapter, Breakpoint } from "../../services/debug";
import { pathKey } from "./paths";

/** A breakpoint in memory: `uid` follows it across edits and adapter answers. */
export interface BreakpointEntry extends Breakpoint {
  uid: string;
}
export type BreakpointKind = "line" | "conditional" | "hitCount" | "logpoint";
export const KIND_LABELS: Record<BreakpointKind, string> = {
  line: "Breakpoint",
  conditional: "Conditional breakpoint",
  hitCount: "Hit count breakpoint",
  logpoint: "Logpoint",
};
export function kindOf(bp: Breakpoint): BreakpointKind {
  if (bp.logMessage) return "logpoint";
  if (bp.condition) return "conditional";
  if (bp.hitCondition) return "hitCount";
  return "line";
}
export const newBreakpoint = (
  path: string,
  line: number,
  change: Partial<Breakpoint> = {},
): BreakpointEntry => ({
  uid: crypto.randomUUID(),
  path,
  line,
  enabled: true,
  condition: "",
  hitCondition: "",
  logMessage: "",
  ...change,
});
export const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);
export const breakpointsIn = (list: BreakpointEntry[], path: string) =>
  list.filter((b) => samePath(b.path, path));

/** Adds a breakpoint on the line, or removes the one there. */
export function toggle(list: BreakpointEntry[], path: string, line: number) {
  const found = list.find((b) => samePath(b.path, path) && b.line === line);
  return found
    ? list.filter((b) => b !== found)
    : [...list, newBreakpoint(path, line)];
}
/**
 * Moves breakpoints after an edit (`lines` by uid); two that land on one line become one,
 * as in VS Code.
 */
export function move(list: BreakpointEntry[], lines: Map<string, number>) {
  const taken = new Set<string>();
  const result: BreakpointEntry[] = [];
  for (const bp of list) {
    const line = lines.get(bp.uid) ?? bp.line;
    const key = `${pathKey(bp.path)}\0${line}`;
    if (taken.has(key)) continue;
    taken.add(key);
    result.push(line === bp.line ? bp : { ...bp, line });
  }
  return result;
}

/** A hit count is a positive whole number: "stop from the Nth hit on". */
export function validHitCount(text: string) {
  return /^\s*[1-9]\d{0,8}\s*$/.test(text);
}
/**
 * The adapter's hit condition for "stop from the Nth hit": GDB's DAP sets it as the
 * breakpoint's ignore count, lldb-dap ignores N - 1 hits.
 */
export function hitCondition(adapter: Adapter, text: string) {
  const hits = Number(text.trim());
  return String(adapter === "gdb" ? hits - 1 : hits);
}
export interface Capabilities {
  supportsConditionalBreakpoints?: boolean;
  supportsHitConditionalBreakpoints?: boolean;
  supportsLogPoints?: boolean;
  supportsSetVariable?: boolean;
  supportsEvaluateForHovers?: boolean;
  supportsTerminateRequest?: boolean;
  supportsConfigurationDoneRequest?: boolean;
}
export interface SourceBreakpoint {
  line: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}
/**
 * A file's `setBreakpoints` list: enabled breakpoints the adapter can set as asked. One
 * needing an ability the adapter lacks is not set (never set as a plain breakpoint), and
 * `refused` says why.
 */
export function sourceBreakpoints(
  list: BreakpointEntry[],
  adapter: Adapter,
  caps: Capabilities,
) {
  const sent: { uid: string; breakpoint: SourceBreakpoint }[] = [];
  const refused = new Map<string, string>();
  for (const bp of list) {
    if (!bp.enabled) continue;
    const breakpoint: SourceBreakpoint = { line: bp.line };
    if (bp.condition) {
      if (!caps.supportsConditionalBreakpoints) {
        refused.set(bp.uid, "This debugger does not support conditions");
        continue;
      }
      breakpoint.condition = bp.condition;
    }
    if (bp.hitCondition) {
      if (!caps.supportsHitConditionalBreakpoints) {
        refused.set(bp.uid, "This debugger does not support hit counts");
        continue;
      }
      if (!validHitCount(bp.hitCondition)) {
        refused.set(bp.uid, "A hit count must be a positive number");
        continue;
      }
      breakpoint.hitCondition = hitCondition(adapter, bp.hitCondition);
    }
    if (bp.logMessage) {
      if (!caps.supportsLogPoints) {
        refused.set(bp.uid, "This debugger does not support logpoints");
        continue;
      }
      breakpoint.logMessage = bp.logMessage;
    }
    sent.push({ uid: bp.uid, breakpoint });
  }
  return { sent, refused };
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
/**
 * The expression under the pointer for Debug Hover: the identifier there with the member
 * accesses before it (`a.b`, `p->next->value`, `ns::name`), as C/C++ debuggers evaluate them.
 */
export function expressionAt(line: string, column: number) {
  let start = column,
    end = column;
  const word = (c: string | undefined) => !!c && /[\w$]/.test(c);
  if (!word(line[column]) && word(line[column - 1])) start = end = column - 1;
  if (!word(line[start])) return null;
  while (start > 0 && word(line[start - 1])) start--;
  while (end < line.length && word(line[end])) end++;
  IDENTIFIER.lastIndex = start;
  if (!IDENTIFIER.test(line)) return null;
  // Walk back over `.`, `->` and `::` chains.
  for (;;) {
    const before = line.slice(0, start);
    const access = /(\.|->|::)\s*$/.exec(before);
    if (!access) break;
    const head = /([A-Za-z_$][\w$]*)\s*$/.exec(before.slice(0, access.index));
    if (!head) break;
    start = head.index;
  }
  const text = line.slice(start, end);
  return /^\d/.test(text) ? null : { text, from: start, to: end };
}

/** Lines kept in the Debug Console; older ones go first. */
export const CONSOLE_LIMIT = 5000;
export interface ConsoleLine {
  id: number;
  /** `program` is the debugged program's own output. */
  kind: "output" | "program" | "error" | "info" | "input" | "result";
  text: string;
}
export function appendConsole(
  lines: ConsoleLine[],
  next: Omit<ConsoleLine, "id">[],
  counter: { value: number },
) {
  const added = next.map((line) => ({ ...line, id: counter.value++ }));
  const all = [...lines, ...added];
  return all.length > CONSOLE_LIMIT ? all.slice(-CONSOLE_LIMIT) : all;
}

/** How many children a variables request asks for at once. */
export const PAGE = 100;
