import { baseName, join, pathKey, relative } from "./paths";

/**
 * The Coverage view's pure part: LCOV (`.info`: lcov, gcovr --lcov, llvm-cov export) and
 * Cobertura XML (gcovr --cobertura, OpenCppCoverage, …) read into hit counts per file and
 * line, totals, and the folder tree the view shows.
 */
export interface Count {
  covered: number;
  total: number;
}
export interface LineCoverage {
  hits: number;
  /** Branches taken out of all branches on the line, when the report has them. */
  branches?: Count;
}
export interface FunctionCoverage {
  name: string;
  line: number;
  hits: number;
}
export interface FileCoverage {
  /** As resolved against the project root (or the report's source folder). */
  path: string;
  lines: Map<number, LineCoverage>;
  functions: FunctionCoverage[];
}
export interface Totals {
  lines: Count;
  functions: Count;
  branches: Count;
}
export interface CoverageReport {
  format: "lcov" | "cobertura";
  files: FileCoverage[];
}

const absolute = (path: string) => /^([A-Za-z]:[\\/]|[\\/])/.test(path);
/** An absolute path for a report's file name: Windows separators, no `.` or `..` parts. */
function resolve(base: string, path: string) {
  const full = absolute(path) ? path : join(base, path);
  const windows = /^[A-Za-z]:/.test(full);
  const parts: string[] = [];
  for (const part of full.split(/[\\/]/))
    if (part === "..") parts.length > 1 && parts.pop();
    else if (part !== "." && (part || !parts.length)) parts.push(part);
  return parts.join(windows ? "\\" : "/");
}

/** Files of the report by path key; records of the same file add up. */
class Files {
  private files = new Map<string, FileCoverage>();
  file(path: string) {
    const key = pathKey(path);
    let file = this.files.get(key);
    if (!file)
      this.files.set(key, (file = { path, lines: new Map(), functions: [] }));
    return file;
  }
  line(file: FileCoverage, line: number, hits: number) {
    const current = file.lines.get(line);
    file.lines.set(line, { ...current, hits: (current?.hits ?? 0) + hits });
  }
  branches(file: FileCoverage, line: number, covered: number, total: number) {
    const current = file.lines.get(line) ?? { hits: 0 };
    const before = current.branches ?? { covered: 0, total: 0 };
    file.lines.set(line, {
      ...current,
      branches: {
        covered: before.covered + covered,
        total: before.total + total,
      },
    });
  }
  function(file: FileCoverage, name: string, line: number, hits: number) {
    const known = file.functions.find((f) => f.name === name);
    if (!known) file.functions.push({ name, line, hits });
    else {
      known.hits += hits;
      known.line ||= line;
    }
  }
  all() {
    return [...this.files.values()];
  }
}

/** LCOV tracefile records: `SF:`, `FN:`/`FNDA:`, `DA:`, `BRDA:`, `end_of_record`. */
export function parseLcov(text: string, root: string): CoverageReport {
  const files = new Files();
  let file: FileCoverage | null = null;
  // FN gives a function's line, FNDA its hits; either may come first.
  let starts = new Map<string, number>();
  let branchHits = new Map<number, Count>();
  const flush = () => {
    if (file)
      for (const [line, count] of branchHits)
        files.branches(file, line, count.covered, count.total);
    branchHits = new Map();
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const colon = line.indexOf(":");
    const tag = colon > 0 ? line.slice(0, colon) : line;
    const value = line.slice(colon + 1);
    if (tag === "SF") {
      flush();
      file = files.file(resolve(root, value));
      starts = new Map();
    } else if (tag === "end_of_record") {
      flush();
      file = null;
    } else if (!file) continue;
    else if (tag === "DA") {
      const [number, hits] = value.split(",");
      if (Number(number) > 0)
        files.line(file, Number(number), Number(hits) || 0);
    } else if (tag === "FN") {
      // `FN:<line>,<name>`, or `FN:<line>,<end line>,<name>`. Until FNDA it never ran.
      const parts = value.split(",");
      const name = (
        parts.length > 2 && /^\d+$/.test(parts[1])
          ? parts.slice(2)
          : parts.slice(1)
      ).join(",");
      starts.set(name, Number(parts[0]));
      files.function(file, name, Number(parts[0]), 0);
    } else if (tag === "FNDA") {
      const comma = value.indexOf(",");
      const name = value.slice(comma + 1);
      files.function(
        file,
        name,
        starts.get(name) ?? 0,
        Number(value.slice(0, comma)) || 0,
      );
    } else if (tag === "FNL") {
      // lcov 2: `FNL:<index>,<line>[,<end line>]` then `FNA:<index>,<hits>,<name>`.
      const [index, start] = value.split(",");
      starts.set(`#${index}`, Number(start));
    } else if (tag === "FNA") {
      const [index, hits, ...name] = value.split(",");
      files.function(
        file,
        name.join(","),
        starts.get(`#${index}`) ?? 0,
        Number(hits) || 0,
      );
    } else if (tag === "BRDA") {
      // `BRDA:<line>,<block>,<branch>,<taken>`; `-` means the block never ran.
      const parts = value.split(",");
      const number = Number(parts[0]);
      const taken = parts[parts.length - 1];
      const count = branchHits.get(number) ?? { covered: 0, total: 0 };
      count.total++;
      if (taken !== "-" && Number(taken) > 0) count.covered++;
      branchHits.set(number, count);
    }
  }
  flush();
  for (const file of files.all())
    file.functions.sort((a, b) => a.line - b.line);
  return { format: "lcov", files: files.all() };
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decode = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) =>
    name[0] === "#"
      ? String.fromCodePoint(
          name[1].toLowerCase() === "x"
            ? parseInt(name.slice(2), 16)
            : Number(name.slice(1)),
        )
      : (ENTITIES[name] ?? whole),
  );
function attributes(text: string) {
  const result: Record<string, string> = {};
  for (const [, name, value] of text.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g))
    result[name] = decode(value);
  return result;
}

/**
 * Cobertura XML: `<source>` folders, then `<class filename>` with `<line number hits
 * branch condition-coverage="50% (1/2)">`; a `<method>`'s hits are its first line's.
 */
export function parseCobertura(text: string, root: string): CoverageReport {
  const files = new Files();
  const sources = [...text.matchAll(/<source>([^<]*)<\/source>/g)].map((m) =>
    decode(m[1].trim()),
  );
  const base = sources.find(absolute) ?? root;
  let file: FileCoverage | null = null;
  let method: { name: string; line: number; hits: number } | null = null;
  for (const [, close, tag, rest] of text.matchAll(
    /<(\/?)([\w:-]+)([^>]*)>/g,
  )) {
    if (close) {
      if (tag === "class") file = null;
      else if (tag === "method" && file && method) {
        files.function(file, method.name, method.line, method.hits);
        method = null;
      }
      continue;
    }
    const attrs = attributes(rest);
    if (tag === "class" && attrs.filename) {
      file = files.file(resolve(base, attrs.filename));
      if (rest.trim().endsWith("/")) file = null;
    } else if (tag === "method" && file) {
      method = { name: attrs.name ?? "", line: 0, hits: 0 };
    } else if (tag === "line" && file) {
      const number = Number(attrs.number),
        hits = Number(attrs.hits) || 0;
      if (!(number > 0)) continue;
      if (method) {
        // A method's lines repeat the class's lines; only its first one is kept here.
        if (!method.line) {
          method.line = number;
          method.hits = hits;
        }
        continue;
      }
      files.line(file, number, hits);
      const branch = /\((\d+)\/(\d+)\)/.exec(attrs["condition-coverage"] ?? "");
      if (attrs.branch === "true" && branch)
        files.branches(file, number, Number(branch[1]), Number(branch[2]));
    }
  }
  return { format: "cobertura", files: files.all() };
}

/** Reads either format, chosen by its content. */
export function parseReport(text: string, root: string): CoverageReport {
  const start = text.trimStart();
  if (start.startsWith("<")) {
    if (!/<coverage[\s>]/.test(text))
      throw new Error("This XML file is not a Cobertura coverage report");
    return parseCobertura(text, root);
  }
  if (!/^(TN|SF):/m.test(text))
    throw new Error(
      "This is not an LCOV (.info) or Cobertura (.xml) coverage report",
    );
  return parseLcov(text, root);
}

export function totals(files: FileCoverage[]): Totals {
  const result: Totals = {
    lines: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  };
  for (const file of files) {
    for (const line of file.lines.values()) {
      result.lines.total++;
      if (line.hits > 0) result.lines.covered++;
      if (line.branches) {
        result.branches.total += line.branches.total;
        result.branches.covered += line.branches.covered;
      }
    }
    result.functions.total += file.functions.length;
    result.functions.covered += file.functions.filter((f) => f.hits > 0).length;
  }
  return result;
}
/** `82.4%`, or an empty string when there is nothing to count. */
export function percent(count: Count) {
  if (!count.total) return "";
  const value = (count.covered / count.total) * 100;
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
export type LineState = "covered" | "partial" | "uncovered";
/** Uncovered lines never ran; partial lines ran but left some branches untaken. */
export function lineState(line: LineCoverage): LineState {
  if (line.hits <= 0) return "uncovered";
  if (line.branches && line.branches.covered < line.branches.total)
    return "partial";
  return "covered";
}

export interface CoverageFolder {
  kind: "folder";
  /** Project-relative with `/`, or the absolute folder for files outside the project. */
  id: string;
  name: string;
  children: CoverageNode[];
  totals: Totals;
}
export interface CoverageLeaf {
  kind: "file";
  id: string;
  name: string;
  file: FileCoverage;
  totals: Totals;
}
export type CoverageNode = CoverageFolder | CoverageLeaf;

/**
 * The project's files as a folder tree (single-child folders joined, as VS Code compacts
 * them), folders first and by name; files outside the project sit in one folder each.
 */
export function coverageTree(files: FileCoverage[], root: string) {
  const top: CoverageFolder = {
    kind: "folder",
    id: "",
    name: "",
    children: [],
    totals: totals(files),
  };
  const folders = new Map<string, CoverageFolder>([["", top]]);
  const folder = (id: string, name: string, parent: CoverageFolder) => {
    let found = folders.get(id);
    if (!found) {
      found = { kind: "folder", id, name, children: [], totals: totals([]) };
      folders.set(id, found);
      parent.children.push(found);
    }
    return found;
  };
  const members = new Map<CoverageFolder, FileCoverage[]>();
  for (const file of files) {
    const inside = relative(root, file.path);
    const parts = inside === null ? null : inside.split("/");
    let parent = top;
    const chain = [top];
    if (parts === null) {
      const outside = file.path.slice(
        0,
        file.path.length - baseName(file.path).length - 1,
      );
      parent = folder(`outside:${pathKey(outside)}`, outside, top);
      chain.push(parent);
    } else
      for (let i = 0; i < parts.length - 1; i++) {
        parent = folder(parts.slice(0, i + 1).join("/"), parts[i], parent);
        chain.push(parent);
      }
    parent.children.push({
      kind: "file",
      id: pathKey(file.path),
      name: baseName(file.path),
      file,
      totals: totals([file]),
    });
    for (const f of chain.slice(1))
      members.set(f, [...(members.get(f) ?? []), file]);
  }
  for (const [f, list] of members) f.totals = totals(list);
  const tidy = (node: CoverageFolder): CoverageFolder => {
    node.children = node.children.map((child) =>
      child.kind === "folder" ? tidy(child) : child,
    );
    // `src/inventory` instead of `src` holding only `inventory`.
    while (
      node !== top &&
      node.children.length === 1 &&
      node.children[0].kind === "folder" &&
      !node.id.startsWith("outside:")
    ) {
      const only = node.children[0];
      node = { ...only, name: `${node.name}/${only.name}` };
    }
    node.children.sort((a, b) =>
      a.kind !== b.kind
        ? a.kind === "folder"
          ? -1
          : 1
        : a.name.localeCompare(b.name),
    );
    return node;
  };
  return tidy(top).children;
}
