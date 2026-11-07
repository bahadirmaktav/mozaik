import { useSyncExternalStore } from "react";
import {
  sonarBackend,
  type SonarFetched,
  type SonarInfo,
  type SonarIssue,
} from "../../services/sonar";
import { ideBackend } from "../../services/ide";
import {
  allDocuments,
  dirty,
  getDocument,
  subscribe as subscribeDocuments,
} from "../text-editor/documents";
import { appendOutput } from "./channels";
import {
  current,
  host,
  message,
  setAnalysisProblems,
  setEditorMarks,
  type Diagnostic,
} from "./editors";
import {
  compareRefreshes,
  placeFile,
  targetId,
  targetLabel,
  type FileState,
  type Placed,
} from "./sonarModel";
import { pathKey } from "./paths";
import {
  allProjects,
  getProject,
  projectFor,
  setView,
  subscribe as subscribeProjects,
} from "./projects";
import { enabled, onFeatures } from "./features";
// Draws the marks in editors without a language server too.
import "./lint";

/**
 * SonarQube in the IDE (`docs/decisions/028-sonarqube.md`): the issues and Quality Gate of
 * the analysis CI made for the local branch's merge request (else the branch, else the main
 * branch), read from the server only on Connect or Refresh. Each issue is matched to the
 * working tree through Git: as analyzed, moved by edits around it, changed where the user
 * edited its lines, or unmatched without the analyzed commit. Typing and Git changes place
 * them again without asking the server.
 */
interface State {
  info: SonarInfo | null;
  busy: "connecting" | "refreshing" | null;
  error: string | null;
  /** The main branch even when the local branch has its own analysis. */
  mainOnly: boolean;
  fetched: SonarFetched | null;
  fetchedAt: number | null;
  /** The analyzed commit is in the local repository. */
  revisionKnown: boolean;
  /** Path keys of the files that differ from the analyzed commit on disk. */
  changed: Set<string> | null;
  placed: Placed[];
  /** What the latest refresh says about the one before it (same target only). */
  summary: { fixed: number; added: number } | null;
  /** Issue keys that are new since the refresh before. */
  added: Set<string>;
  previous: { target: string; keys: Set<string> } | null;
}
interface Store {
  projects: Map<string, State>;
  /** Text of files at the analyzed commit, by revision and path key. */
  bases: Map<string, string | null>;
  /** Text of closed changed files on disk, by path key; cleared when Git's state changes. */
  disk: Map<string, string | null>;
  /** The Git state each project was placed against. */
  seenGit: Map<string, unknown>;
  listeners: Set<() => void>;
  version: number;
  generation: Map<string, number>;
}
const store: Store = import.meta.hot?.data.ideSonar ?? {
  projects: new Map(),
  bases: new Map(),
  disk: new Map(),
  seenGit: new Map(),
  listeners: new Set(),
  version: 0,
  generation: new Map(),
};
if (import.meta.hot) import.meta.hot.data.ideSonar = store;

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
const blank = (): State => ({
  info: null,
  busy: null,
  error: null,
  mainOnly: false,
  fetched: null,
  fetchedAt: null,
  revisionKnown: false,
  changed: null,
  placed: [],
  summary: null,
  added: new Set(),
  previous: null,
});
function stateOf(id: string) {
  let state = store.projects.get(id);
  if (!state) store.projects.set(id, (state = blank()));
  return state;
}
function update(id: string, change: Partial<State>) {
  store.projects.set(id, { ...stateOf(id), ...change });
  emit();
}
export function useSonar(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return store.projects.get(id) ?? blank();
}
const owner = (id: string) => `sonar:${id}`;
const log = (text: string) => appendOutput("SonarQube", `${text}\n`);

export async function loadInfo(id: string) {
  const root = getProject(id)?.root;
  if (!root) return;
  try {
    update(id, { info: await sonarBackend.info(root), error: null });
  } catch (e) {
    update(id, { error: message(e) });
  }
}

export async function connect(
  id: string,
  url: string,
  projectKey: string,
  token: string,
) {
  const root = getProject(id)?.root;
  if (!root) return;
  update(id, { busy: "connecting", error: null });
  log(`[sonarqube] Connecting ${root} to ${url.trim()} (${projectKey.trim()})`);
  try {
    const info = await sonarBackend.connect(
      root,
      url,
      projectKey,
      token.trim() || null,
    );
    update(id, { info, busy: null });
    log("[sonarqube] Connected");
    await refresh(id);
  } catch (e) {
    log(`[error] ${message(e)}`);
    update(id, { busy: null, error: message(e) });
  }
}

export async function disconnect(id: string) {
  const state = stateOf(id);
  const root = getProject(id)?.root;
  if (!root || !state.info?.binding) return;
  const answer = await host().ask(
    "Disconnect from SonarQube",
    `Disconnect this project from ${state.info.binding.url}? The token is removed from the credential store when no other project uses this server.`,
    ["Disconnect", "Cancel"],
  );
  if (answer !== "Disconnect") return;
  try {
    const info = await sonarBackend.disconnect(root);
    store.projects.set(id, { ...blank(), info });
    emit();
    publish(id);
  } catch (e) {
    update(id, { error: message(e) });
  }
}

export function setMainOnly(id: string, mainOnly: boolean) {
  update(id, { mainOnly });
  void refresh(id);
}

/** Reads the analysis again from the server, then matches it to the working tree. */
export async function refresh(id: string) {
  const project = getProject(id);
  const root = project?.root;
  if (!root || stateOf(id).busy === "refreshing") return;
  update(id, { busy: "refreshing", error: null });
  const branch = project.git?.branch ?? null;
  try {
    const fetched = await sonarBackend.fetch(
      root,
      branch,
      stateOf(id).mainOnly,
    );
    for (const line of fetched.log) log(line);
    const target = targetId(fetched.target);
    const keys = new Set(fetched.issues.map((i) => i.key));
    const state = stateOf(id);
    const compared = compareRefreshes(state.previous, target, keys);
    const revisionKnown = fetched.revision
      ? await sonarBackend.hasCommit(root, fetched.revision).catch(() => false)
      : false;
    const changed = revisionKnown
      ? await changedFiles(root, fetched.revision!)
      : null;
    store.disk.clear();
    store.seenGit.set(id, project.git);
    update(id, {
      busy: null,
      fetched,
      fetchedAt: Date.now(),
      revisionKnown,
      changed,
      summary: compared
        ? { fixed: compared.fixed, added: compared.added.size }
        : null,
      added: compared?.added ?? new Set(),
      previous: { target, keys },
    });
    log(
      `[sonarqube] ${targetLabel(fetched.target)}: ${fetched.issues.length} open issue${fetched.issues.length === 1 ? "" : "s"}` +
        (fetched.truncated
          ? ` (of ${fetched.total}; the server returns at most 10 000)`
          : "") +
        (fetched.revision
          ? `, commit ${fetched.revision.slice(0, 10)}${revisionKnown ? "" : " (not in the local repository)"}`
          : ", no commit reported"),
    );
    await place(id);
  } catch (e) {
    log(`[error] ${message(e)}`);
    update(id, { busy: null, error: message(e) });
  }
}
async function changedFiles(root: string, revision: string) {
  try {
    return new Set(
      (await sonarBackend.changedSince(root, revision)).map(pathKey),
    );
  } catch {
    return null;
  }
}

const documentOf = (path: string) =>
  allDocuments().find((d) => d.path && pathKey(d.path) === pathKey(path));
async function baseText(path: string, revision: string) {
  const key = `${revision}\u0000${pathKey(path)}`;
  if (!store.bases.has(key))
    store.bases.set(
      key,
      await sonarBackend.revisionText(path, revision).catch(() => null),
    );
  return store.bases.get(key) ?? null;
}
async function diskText(path: string) {
  const key = pathKey(path);
  if (!store.disk.has(key))
    store.disk.set(
      key,
      await ideBackend
        .read(path)
        .then((f) => f.text)
        .catch(() => null),
    );
  return store.disk.get(key) ?? null;
}
/** How a file compares with the analyzed commit now. */
async function fileState(path: string, state: State): Promise<FileState> {
  const revision = state.fetched?.revision;
  if (!state.revisionKnown || !revision) return { kind: "unmatched" };
  const doc = documentOf(path);
  const changedOnDisk = state.changed?.has(pathKey(path)) ?? true;
  if (!changedOnDisk && !(doc && dirty(doc))) return { kind: "same" };
  const base = await baseText(path, revision);
  const now = doc ? doc.text : await diskText(path);
  if (base === null || now === null) return { kind: "unmatched" };
  return { kind: "texts", base, current: now };
}
/** At most a few Git reads at a time. */
async function inTurn<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}
/** Places the fetched issues in the current texts; the newest call wins. */
async function place(id: string) {
  const state = store.projects.get(id);
  if (!state?.fetched) return publish(id);
  const generation = (store.generation.get(id) ?? 0) + 1;
  store.generation.set(id, generation);
  const byFile = new Map<string, SonarIssue[]>();
  const placed: Placed[] = [];
  for (const issue of state.fetched.issues) {
    if (!issue.path) {
      placed.push(...placeFile([issue], { kind: "unmatched" }));
      continue;
    }
    byFile.set(issue.path, [...(byFile.get(issue.path) ?? []), issue]);
  }
  await inTurn([...byFile], async ([path, issues]) => {
    placed.push(...placeFile(issues, await fileState(path, state)));
  });
  if (store.generation.get(id) !== generation) return;
  update(id, { placed });
  publish(id);
}
/** Hands the placed issues to Problems (all) and to the editor (those still in place). */
function publish(id: string) {
  const state = store.projects.get(id);
  if (!state?.fetched || !enabled("sonarqube")) {
    setAnalysisProblems(owner(id), null);
    setEditorMarks(owner(id), null);
    return;
  }
  const problems = new Map<string, Diagnostic[]>();
  const marks = new Map<string, Diagnostic[]>();
  for (const { issue, track, range } of state.placed) {
    if (!issue.path) continue;
    const item: Diagnostic = {
      range,
      severity: issue.severity,
      message: issue.message,
      source: "sonarqube",
      code: issue.rule,
      stale: track !== "open",
    };
    problems.set(issue.path, [...(problems.get(issue.path) ?? []), item]);
    if (track === "open")
      marks.set(issue.path, [...(marks.get(issue.path) ?? []), item]);
  }
  setAnalysisProblems(owner(id), problems);
  setEditorMarks(owner(id), marks);
}

// Turned off in Settings → IDE → Features, the issues leave Problems and the editor.
onFeatures(() => {
  for (const id of store.projects.keys()) publish(id);
});
// Typing moves issues or marks them changed; this needs no server, only the texts.
let typing = 0;
subscribeDocuments(() => {
  clearTimeout(typing);
  typing = window.setTimeout(() => {
    for (const [id, state] of store.projects) if (state.fetched) void place(id);
  }, 300);
});
// A commit, checkout or save on disk changes what differs from the analyzed commit.
let gitChange = 0;
subscribeProjects(() => {
  clearTimeout(gitChange);
  gitChange = window.setTimeout(() => {
    for (const [id, state] of store.projects) {
      const project = getProject(id);
      if (!project?.root || !state.fetched?.revision || !state.revisionKnown)
        continue;
      if (store.seenGit.get(id) === project.git) continue;
      store.seenGit.set(id, project.git);
      const { root } = project;
      const revision = state.fetched.revision;
      void (async () => {
        store.disk.clear();
        update(id, { changed: await changedFiles(root, revision) });
        await place(id);
      })();
    }
  }, 500);
});

/** A project closed: its issues go. */
export function disposeSonar(id: string) {
  store.projects.delete(id);
  store.seenGit.delete(id);
  setAnalysisProblems(owner(id), null);
  setEditorMarks(owner(id), null);
  emit();
}

/** The project palette commands act on: the current file's, else the only open one. */
function activeProjectId() {
  const id = current();
  const path = id ? getDocument(id).path : null;
  const project = path ? projectFor(path) : null;
  if (project?.root) return project.id;
  const open = allProjects().filter((p) => p.root);
  return open.length === 1 ? open[0].id : null;
}
/** The palette's SonarQube commands. */
export function commands() {
  const id = activeProjectId();
  if (!id) return [];
  const list = [
    {
      id: "sonar.show",
      label: "SonarQube: Show Issues",
      run: () => setView(id, "sonar"),
    },
  ];
  if (store.projects.get(id)?.info?.binding)
    list.push({
      id: "sonar.refresh",
      label: "SonarQube: Refresh Results",
      run: () => void refresh(id),
    });
  return list;
}
