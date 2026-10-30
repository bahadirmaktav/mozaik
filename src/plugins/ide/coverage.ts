import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { coverageBackend, type ReportFile } from "../../services/coverage";
import { fileSystem } from "../../services/filesystem";
import { activeProject } from "./cmake";
import { host, message } from "./editors";
import {
  parseReport,
  totals,
  type FileCoverage,
  type Totals,
} from "./coverageModel";
import { getProject } from "./projects";
import { baseName, parent, pathKey } from "./paths";

/**
 * The Coverage view's state: per project, the LCOV or Cobertura report the user chose (Rust
 * remembers its path), read again when the view opens and whenever the file changes, as a
 * coverage build target rewrites it. Mozaik runs no coverage tool itself.
 */
export interface Report {
  path: string;
  modified: number | null;
  format: "lcov" | "cobertura";
  files: FileCoverage[];
  totals: Totals;
}
interface State {
  report: Report | null;
  /** Path keys of report files changed after the report was written. */
  stale: Set<string>;
  busy: boolean;
  error: string | null;
  /** Rust was asked for the chosen report once. */
  loaded: boolean;
}
/** A coverage tab: one file of a project's report, read only, among the code editors. */
interface Tab {
  project: string;
  path: string;
}
interface Store {
  projects: Map<string, State>;
  tabs: Map<string, Tab>;
  /** The report folder each project watches. */
  watched: Map<string, string>;
  timers: Map<string, number>;
  listening: boolean;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideCoverage ?? {
  projects: new Map(),
  tabs: new Map(),
  watched: new Map(),
  timers: new Map(),
  listening: false,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideCoverage = store;

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
export const version = () => store.version;
const empty: State = {
  report: null,
  stale: new Set(),
  busy: false,
  error: null,
  loaded: false,
};
const stateOf = (id: string) => store.projects.get(id) ?? empty;
export function useCoverage(id: string) {
  useSyncExternalStore(subscribe, version);
  return stateOf(id);
}
function update(id: string, change: Partial<State>) {
  store.projects.set(id, { ...stateOf(id), ...change });
  emit();
}
const owner = (id: string) => `coverage-${id}`;

/** Reads a report file into the project's state; `null` clears it. */
async function apply(id: string, file: ReportFile | null) {
  const root = getProject(id)?.root;
  if (!root) return;
  if (!file) {
    unwatch(id);
    return update(id, { report: null, stale: new Set(), busy: false });
  }
  const parsed = parseReport(file.text, root);
  const report: Report = {
    path: file.path,
    modified: file.modified,
    format: parsed.format,
    files: parsed.files,
    totals: totals(parsed.files),
  };
  update(id, { report, busy: false, error: null });
  watch(id, file.path);
  await checkStale(id);
}
/** Marks the files changed after the report: their lines may have moved. */
async function checkStale(id: string) {
  const report = stateOf(id).report;
  if (!report?.modified) return;
  const times = await coverageBackend
    .modified(report.files.map((f) => f.path))
    .catch(() => null);
  if (!times || stateOf(id).report !== report) return;
  const stale = new Set(
    report.files
      .filter((_, i) => (times[i] ?? 0) > report.modified!)
      .map((f) => pathKey(f.path)),
  );
  update(id, { stale });
}

/** `keep` leaves the current report, as a cancelled dialog does. */
async function run(
  id: string,
  work: (root: string) => Promise<ReportFile | null | "keep">,
) {
  const root = getProject(id)?.root;
  if (!root || stateOf(id).busy) return;
  update(id, { busy: true, error: null, loaded: true });
  try {
    const file = await work(root);
    if (file === "keep") update(id, { busy: false });
    else await apply(id, file);
  } catch (e) {
    update(id, { busy: false, error: message(e) });
  }
}
/** The project's chosen report, read again (the view calls it when it first shows). */
export const loadCoverage = (id: string) =>
  run(id, (root) => coverageBackend.report(root));
/** Picks a report in a native dialog; it becomes the project's report. */
export const chooseCoverage = (id: string) =>
  run(id, async (root) => (await coverageBackend.choose(root)) ?? "keep");
/** Forgets the project's report (the file stays) and closes its coverage tabs' data. */
export async function clearCoverage(id: string) {
  const root = getProject(id)?.root;
  if (!root) return;
  await coverageBackend.forget(root).catch((e) => host().report(e));
  unwatch(id);
  update(id, { report: null, stale: new Set(), error: null });
}

function watch(id: string, report: string) {
  const folder = parent(report);
  if (store.watched.get(id) === pathKey(folder)) return;
  store.watched.set(id, pathKey(folder));
  void fileSystem.watch(owner(id), folder).catch(() => {});
  if (store.listening || !isTauri()) return;
  store.listening = true;
  void listen<string[]>("disk-change", (event) => changed(event.payload));
}
function unwatch(id: string) {
  if (!store.watched.delete(id)) return;
  void fileSystem.watch(owner(id), null).catch(() => {});
}
/** A rewritten report is read again; a changed source file may make the report stale. */
function changed(paths: string[]) {
  const keys = new Set(paths.map(pathKey));
  for (const [id, state] of store.projects) {
    const report = state.report;
    if (!report) continue;
    const again = keys.has(pathKey(report.path));
    if (!again && !report.files.some((f) => keys.has(pathKey(f.path))))
      continue;
    window.clearTimeout(store.timers.get(id));
    store.timers.set(
      id,
      window.setTimeout(() => {
        store.timers.delete(id);
        void (again ? loadCoverage(id) : checkStale(id));
      }, 300),
    );
  }
}
export function disposeCoverage(id: string) {
  unwatch(id);
  window.clearTimeout(store.timers.get(id));
  store.timers.delete(id);
  store.projects.delete(id);
  emit();
}

/** A file's coverage in the project's report. */
export function fileCoverage(project: string, path: string) {
  const key = pathKey(path);
  return (
    stateOf(project).report?.files.find((f) => pathKey(f.path) === key) ?? null
  );
}
export const isStale = (project: string, path: string) =>
  stateOf(project).stale.has(pathKey(path));

export function createCoverageTab(project = "", path = "") {
  const id = crypto.randomUUID();
  store.tabs.set(id, { project, path });
  emit();
  return id;
}
export const coverageTab = (id: string) => store.tabs.get(id) ?? null;
export const coverageTabFor = (path: string) =>
  [...store.tabs].find(
    ([, t]) => t.path && pathKey(t.path) === pathKey(path),
  )?.[0] ?? null;
export const coverageTitle = (id: string) =>
  `${baseName(store.tabs.get(id)?.path || "Coverage")} (coverage)`;
export function disposeCoverageTab(id: string) {
  store.tabs.delete(id);
  emit();
}

/** The palette's coverage commands for the active project. */
export function commands() {
  const project = activeProject();
  if (!project) return [];
  const id = project.id;
  const list = [
    {
      id: "coverage.open",
      label: "Coverage: Open Report…",
      run: () => void chooseCoverage(id),
    },
  ];
  if (stateOf(id).report)
    list.push(
      {
        id: "coverage.reload",
        label: "Coverage: Reload Report",
        run: () => void loadCoverage(id),
      },
      {
        id: "coverage.clear",
        label: "Coverage: Close Report",
        run: () => void clearCoverage(id),
      },
    );
  return list;
}
