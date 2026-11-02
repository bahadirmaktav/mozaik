import { useSyncExternalStore } from "react";
import {
  analysisBackend,
  type AnalysisInfo,
  type FileResult,
  type FixEdit,
} from "../../services/analysis";
import {
  allDocuments,
  dirty,
  getDocument,
  subscribe as subscribeDocuments,
} from "../text-editor/documents";
import { appendOutput } from "./channels";
import { cmakeInfo, subscribe as subscribeCMake } from "./cmake";
import {
  current,
  host,
  message,
  setAnalysisProblems,
  type Diagnostic,
} from "./editors";
import { combineFixes, previewHunks, type Hunk } from "./analysisModel";
import { pathKey } from "./paths";
import { allProjects, getProject, projectFor } from "./projects";
import { enabled } from "./features";

/**
 * clang-tidy runs of IDE projects (see `docs/decisions/017-code-analysis.md`): one file or
 * the whole compilation database, only when the user asks (or after a save, when chosen in
 * settings). Findings go to Problems with their fixes; they turn stale when their text or
 * the project's build folder changes, and a project run replaces the project's findings.
 */
export type RunStatus = "running" | "done" | "cancelled" | "failed";
interface State {
  root: string;
  status: RunStatus | null;
  /** The scope of the latest run: a file, or null for the whole project. */
  scope: string | null;
  done: number;
  total: number;
  /** The build folder whose compile commands the findings used. */
  build: string | null;
  error: string | null;
  /** Results by the analyzed file (path key). */
  results: Map<string, FileResult>;
}
/** A fix waiting for the user's decision in the preview. */
export interface Preview {
  title: string;
  files: { path: string; hunks: Hunk[] }[];
  skipped: number;
  apply: () => Promise<void>;
}
interface Store {
  projects: Map<string, State>;
  info: AnalysisInfo | null;
  /** The text of each document as the findings saw it, by path key. */
  seen: Map<string, string>;
  preview: Preview | null;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideAnalysis ?? {
  projects: new Map(),
  info: null,
  seen: new Map(),
  preview: null,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideAnalysis = store;

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
export function useAnalysis(project: string | null) {
  useSyncExternalStore(subscribe, () => store.version);
  return project ? (store.projects.get(project) ?? null) : null;
}
/** What Rust found for clang-tidy, once read. */
export function useAnalysisInfo() {
  useSyncExternalStore(subscribe, () => store.version);
  return store.info;
}
export function usePreview() {
  useSyncExternalStore(subscribe, () => store.version);
  return store.preview;
}
export function closePreview() {
  store.preview = null;
  emit();
}

export async function loadInfo(refresh = false) {
  if (!store.info || refresh) {
    store.info = await analysisBackend.info();
    emit();
  }
  return store.info;
}
export function setInfo(info: AnalysisInfo) {
  store.info = info;
  emit();
}

const documentOf = (path: string) =>
  allDocuments().find((d) => d.path && pathKey(d.path) === pathKey(path));
/** Whether a finding in `path` still describes its text. */
function upToDate(path: string, build: string | null, project: string) {
  const info = cmakeInfo(project);
  if (build && info?.buildDir && pathKey(info.buildDir) !== pathKey(build))
    return false;
  const doc = documentOf(path);
  if (!doc) return true;
  const key = pathKey(path);
  // A document first seen after the run shows the file as it is on disk.
  if (!store.seen.has(key)) {
    if (dirty(doc)) return false;
    store.seen.set(key, doc.text);
  }
  return store.seen.get(key) === doc.text;
}
/** Hands a project's findings to Problems, marking the stale ones. */
function publish(project: string) {
  const state = store.projects.get(project);
  if (!state?.results.size) return setAnalysisProblems(pathKey(project), null);
  const files = new Map<string, Diagnostic[]>();
  const fresh = new Map<string, boolean>();
  for (const result of state.results.values())
    for (const finding of result.findings) {
      const key = pathKey(finding.path);
      if (!fresh.has(key))
        fresh.set(key, upToDate(finding.path, state.build, project));
      const position = finding.position;
      const list = files.get(finding.path) ?? [];
      list.push({
        range: { start: position, end: position },
        severity: finding.severity,
        message: finding.message,
        source: "clang-tidy-cli",
        code: finding.rule || undefined,
        fix: finding.fix.length ? finding.fix : undefined,
        stale: !fresh.get(key),
      });
      files.set(finding.path, list);
    }
  setAnalysisProblems(pathKey(project), files);
}
let scheduled = false;
function republish() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const id of store.projects.keys()) publish(id);
  });
}
// Typing, saves and new CMake choices change what is stale.
subscribeDocuments(republish);
subscribeCMake(republish);

function update(id: string, change: Partial<State>) {
  const state = store.projects.get(id);
  if (!state) return;
  store.projects.set(id, { ...state, ...change });
  emit();
}
/** The project a file belongs to, as `{ id, root }`. */
function projectOf(path: string) {
  const project = projectFor(path);
  return project?.root ? { id: project.id, root: project.root } : null;
}
export const running = (id: string) =>
  store.projects.get(id)?.status === "running";

/**
 * Runs clang-tidy on one file of a project, or with `file` null on all of them. A file run
 * replaces that file's findings, a project run all of the project's.
 */
export async function analyze(id: string, file: string | null) {
  const root = getProject(id)?.root;
  if (!root) return;
  if (running(id)) {
    host().report("An analysis is already running for this project");
    return;
  }
  const previous = store.projects.get(id);
  const results = new Map(file ? previous?.results : []);
  if (file) results.delete(pathKey(file));
  store.projects.set(id, {
    root,
    status: "running",
    scope: file,
    done: 0,
    total: 0,
    build: previous?.build ?? null,
    error: null,
    results,
  });
  emit();
  publish(id);
  appendOutput(
    "Analysis",
    `[analysis] ${file ? `clang-tidy on ${file}` : `clang-tidy on every file of ${root}`}\n`,
  );
  try {
    const summary = await analysisBackend.run(root, file, (event) => {
      const state = store.projects.get(id);
      if (!state) return;
      if (event.kind === "output") appendOutput("Analysis", event.text);
      else if (event.kind === "started") {
        // Findings from another build folder no longer belong with these.
        const changed =
          state.build !== null && pathKey(state.build) !== pathKey(event.build);
        update(id, {
          total: event.total,
          build: event.build,
          results: changed ? new Map() : state.results,
        });
      } else {
        const results = new Map(state.results);
        results.set(pathKey(event.result.path), event.result);
        // The findings describe the files as they are now.
        for (const path of Object.keys(event.result.hashes)) {
          const doc = documentOf(path);
          if (doc && !dirty(doc)) store.seen.set(pathKey(path), doc.text);
          else store.seen.delete(pathKey(path));
        }
        update(id, { results, done: state.done + 1 });
        publish(id);
      }
    });
    const state = store.projects.get(id);
    const count = [...(state?.results.values() ?? [])].reduce(
      (n, r) => n + r.findings.length,
      0,
    );
    appendOutput(
      "Analysis",
      summary.cancelled
        ? `[analysis] Cancelled after ${summary.files} file${summary.files === 1 ? "" : "s"}\n`
        : `[analysis] Finished: ${summary.files} file${summary.files === 1 ? "" : "s"}, ${count} finding${count === 1 ? "" : "s"}\n`,
    );
    update(id, { status: summary.cancelled ? "cancelled" : "done" });
  } catch (e) {
    appendOutput("Analysis", `[error] ${message(e)}\n`);
    update(id, { status: "failed", error: message(e) });
    host().report(e);
  }
  publish(id);
}
export function cancelAnalysis(id: string) {
  const root = getProject(id)?.root;
  if (root && running(id))
    void analysisBackend.cancel(root).catch((e) => host().report(e));
}
/** The current code file and its project, for the palette and the status bar. */
function currentFile() {
  const id = current();
  const path = id ? getDocument(id).path : null;
  const project = path ? projectOf(path) : null;
  return path && project ? { path, project } : null;
}
export function analyzeCurrentFile() {
  const file = currentFile();
  if (!file)
    return host().report("Open a C/C++ file of an IDE project to analyze it");
  return analyze(file.project.id, file.path);
}
/** The IDE project palette commands act on: the current file's, else the only one. */
function activeProjectId() {
  const file = currentFile();
  if (file) return file.project.id;
  const open = allProjects().filter((p) => p.root);
  return open.length === 1 ? open[0].id : null;
}
export function analyzeProject() {
  const id = activeProjectId();
  if (!id) return host().report("Open a file of the project to analyze first");
  return analyze(id, null);
}

/** The edits of fixes, checked against the text they were made for, after a preview. */
export async function previewFixes(title: string, fixes: FixEdit[][]) {
  const { files, skipped } = combineFixes(fixes);
  if (!files.size)
    return host().report("These fixes overlap; none was applied");
  for (const path of files.keys()) {
    const doc = documentOf(path);
    if (doc && dirty(doc))
      return host().report(
        `Save ${doc.name} first: the fix was made for the saved file`,
      );
  }
  const hashes: Record<string, string> = {};
  for (const state of store.projects.values())
    for (const result of state.results.values())
      for (const [path, hash] of Object.entries(result.hashes))
        if (files.has(path)) hashes[path] = hash;
  const changed = await analysisBackend.changed(hashes);
  const missing = [...files.keys()].filter((p) => !(p in hashes));
  if (changed.length || missing.length)
    return host().report(
      `${[...changed, ...missing].join(", ")} changed since the analysis. Run it again.`,
    );
  const { ideBackend } = await import("../../services/ide");
  const shown = await Promise.all(
    [...files].map(async ([path, edits]) => {
      const doc = documentOf(path);
      const text = doc ? doc.text : (await ideBackend.read(path)).text;
      return { path, hunks: previewHunks(text, edits) };
    }),
  );
  store.preview = {
    title,
    files: shown,
    skipped,
    async apply() {
      const { applyWorkspaceEdit } = await import("./lsp");
      const { toUri } = await import("./paths");
      const { textEdits } = await import("./analysisModel");
      await applyWorkspaceEdit(
        {
          changes: Object.fromEntries(
            [...files].map(([path, edits]) => [toUri(path), textEdits(edits)]),
          ),
        },
        title,
      );
    },
  };
  emit();
}
/** Every fix of the current file's findings, after a preview. */
export function fixCurrentFile() {
  const file = currentFile();
  if (!file) return host().report("Open a file with clang-tidy findings");
  const state = store.projects.get(file.project.id);
  const fixes = [...(state?.results.values() ?? [])]
    .flatMap((r) => r.findings)
    .filter((f) => pathKey(f.path) === pathKey(file.path) && f.fix.length)
    .map((f) => f.fix);
  if (!fixes.length)
    return host().report("No clang-tidy finding of this file has a fix");
  return previewFixes("Apply clang-tidy fixes", fixes);
}

/** Analysis on save, when chosen in settings: the saved C/C++ file of a project. */
export function analyzeAfterSave(id: string) {
  const path = getDocument(id).path;
  if (
    !path ||
    !enabled("analysis") ||
    store.info?.settings.autoAnalysis !== "onSave" ||
    !store.info.settings.clangTidyEnabled ||
    !/\.(c|cc|cpp|cxx|c\+\+|m|mm)$/i.test(path)
  )
    return;
  const project = projectOf(path);
  if (project && !running(project.id))
    void analyze(project.id, path).catch(() => {});
}

/** A project closed: its findings go. */
export function disposeAnalysis(id: string) {
  cancelAnalysis(id);
  if (store.projects.delete(id)) emit();
  setAnalysisProblems(pathKey(id), null);
}

/** The palette's Analysis commands. */
export function commands() {
  if (store.info && !store.info.settings.clangTidyEnabled) return [];
  const report = (work: Promise<unknown> | void) =>
    void Promise.resolve(work).catch((e) => host().report(e));
  const file = currentFile();
  const project = activeProjectId();
  const list = [
    {
      id: "analysis.problems",
      label: "Analysis: Show Problems",
      run: () => host().showProblems(file?.path ?? null),
    },
  ];
  if (file)
    list.push(
      {
        id: "analysis.file",
        label: "Analysis: Run Current File",
        run: () => report(analyzeCurrentFile()),
      },
      {
        id: "analysis.fix",
        label: "Analysis: Apply Fixes in Current File",
        run: () => report(fixCurrentFile()),
      },
    );
  if (project)
    list.push({
      id: "analysis.project",
      label: "Analysis: Run Entire Project",
      run: () => report(analyzeProject()),
    });
  if ([...store.projects.keys()].some(running))
    list.push({
      id: "analysis.cancel",
      label: "Analysis: Cancel",
      run: () => {
        for (const id of store.projects.keys()) cancelAnalysis(id);
      },
    });
  return list;
}
