/*
 * Pure parts of Cargo support: rustc's messages in a build's output, and target labels.
 */

export interface CargoProblem {
  /** As rustc printed it: relative to the workspace root, or absolute. */
  path: string;
  /** 1-based. */
  line: number;
  column: number;
  severity: 1 | 2;
  message: string;
  code?: string;
}

// `error[E0425]: cannot find value`, `warning: unused variable`, `error: aborting…`.
const HEADER = /^(error|warning)(?:\[([A-Za-z0-9_:-]+)\])?: (.+)$/;
// ` --> src/main.rs:2:20`, indented by the width of the line numbers.
const LOCATION = /^\s*--> (.+):(\d+):(\d+)$/;

/**
 * rustc's errors and warnings in Cargo's human-readable output: a header line, then the
 * place it points at. Summaries without a place ("could not compile", "generated 2
 * warnings") are left out, and a message counts once per place.
 */
export function cargoProblems(output: string): CargoProblem[] {
  const found: CargoProblem[] = [];
  const seen = new Set<string>();
  let header: {
    severity: 1 | 2;
    message: string;
    code?: string;
  } | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const top = HEADER.exec(line);
    if (top) {
      header = {
        severity: top[1] === "error" ? 1 : 2,
        message: top[3],
        ...(top[2] && { code: top[2] }),
      };
      continue;
    }
    const place = LOCATION.exec(line);
    if (place && header) {
      const problem: CargoProblem = {
        path: place[1],
        line: Number(place[2]),
        column: Number(place[3]),
        ...header,
      };
      const key = `${problem.path}:${problem.line}:${problem.column}:${problem.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push(problem);
      }
      // Further places of one message (notes, other spans) are not new problems.
      header = null;
      continue;
    }
    // Anything else but rustc's snippet lines ends the message.
    if (line && !/^\s*(\||=|\d+\s*\||\.\.\.)/.test(line)) header = null;
  }
  return found;
}

/** A run target's name for display: a Cargo target id's name, a CMake target as it is. */
export function targetLabel(target: string): string {
  const parts = target.split(":");
  return target.startsWith("cargo:") && parts.length === 4 ? parts[3] : target;
}
