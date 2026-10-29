import { join } from "./paths";

/** Pure handling of CMake and compiler output: problems and a bounded line buffer. */

export interface BuildProblem {
  path: string;
  /** 1-based, as compilers print them. */
  line: number;
  column: number;
  severity: 1 | 2;
  message: string;
}

// GCC/Clang: `path:line:col: error: text` (column optional; Windows drive letters allowed).
const GNU =
  /^((?:[A-Za-z]:)?[^:*?"<>|\r\n]+):(\d+):(?:(\d+):)? (fatal error|error|warning): (.*)$/;
// MSVC and clang-cl: `path(line,col): error C2065: text`.
const MSVC =
  /^\s*(?:\d+>)?((?:[A-Za-z]:)?[^(:*?"<>|\r\n]+)\((\d+)(?:,(\d+))?\)\s?: (fatal error|error|warning) ([A-Z]+\d+: )?(.*)$/;
// CMake: `CMake Error at CMakeLists.txt:3 (add_executable):` and the indented message below.
const CMAKE = /^CMake (Error|Warning)(?: \(dev\))? at (.+?):(\d+) \(.*\):?$/;

const absolute = (path: string) => /^(?:[A-Za-z]:)?[\\/]/.test(path);
/** `relative` under `base`, with `.` and `..` folded so the path matches open files. */
function resolve(base: string, relative: string) {
  const joined = join(base, relative);
  const sep = joined.includes("\\") ? "\\" : "/";
  const parts: string[] = [];
  for (const part of joined.split(/[\\/]/)) {
    if (part === ".") continue;
    if (part === ".." && parts.length > 1) parts.pop();
    else parts.push(part);
  }
  return parts.join(sep);
}

/** A problem a line names, with relative paths resolved against `base`. */
export function problemIn(line: string, base: string): BuildProblem | null {
  const text = line.replace(/\x1b\[[0-9;]*m/g, "");
  const gnu = GNU.exec(text);
  const msvc = gnu ? null : MSVC.exec(text);
  const match = gnu ?? msvc;
  if (!match) return null;
  const [, file, row, column, kind] = match;
  const message = (gnu ? gnu[5] : `${msvc![5] ?? ""}${msvc![6]}`).trim();
  const path = file.trim();
  return {
    path: absolute(path) ? path : resolve(base, path),
    line: Number(row),
    column: Number(column || 1),
    severity: kind === "warning" ? 2 : 1,
    message,
  };
}

/** Problems in a whole step's output: compiler lines and CMake's own errors. */
export function problems(output: string, source: string, build: string) {
  const found: BuildProblem[] = [];
  const seen = new Set<string>();
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const cmake = CMAKE.exec(lines[i]);
    let problem: BuildProblem | null = null;
    if (cmake) {
      const body: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]))
        body.push(lines[++i].trim());
      problem = {
        path: absolute(cmake[2]) ? cmake[2] : resolve(source, cmake[2]),
        line: Number(cmake[3]),
        column: 1,
        severity: cmake[1] === "Error" ? 1 : 2,
        message: body.join(" ") || `CMake ${cmake[1]}`,
      };
    } else problem = problemIn(lines[i], build);
    if (!problem) continue;
    const key = `${problem.path}:${problem.line}:${problem.column}:${problem.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(problem);
  }
  return found;
}

/** Output lines, dropping the oldest past `limit`; a partial last line waits for its end. */
export class Lines {
  lines: string[] = [];
  partial = "";
  dropped = 0;
  constructor(readonly limit: number) {}
  append(text: string) {
    const parts = (this.partial + text).split(/\r?\n/);
    this.partial = parts.pop() ?? "";
    this.lines.push(...parts);
    const excess = this.lines.length - this.limit;
    if (excess > 0) {
      this.lines.splice(0, excess);
      this.dropped += excess;
    }
  }
  /** Every line, including an unfinished last one. */
  all() {
    return this.partial ? [...this.lines, this.partial] : this.lines;
  }
  clear() {
    this.lines = [];
    this.partial = "";
    this.dropped = 0;
  }
}
