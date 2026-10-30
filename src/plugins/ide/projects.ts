import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fileSystem, isDirectory } from "../../services/filesystem";
import {
  defaultSettings,
  ideBackend,
  type GitStatus,
  type ProjectSettings,
  type SearchQuery,
  type SearchResult,
} from "../../services/ide";
import { message } from "./editors";
import { sortEntries, type Entry } from "./model";
import { join, parent, pathKey, within } from "./paths";

export interface SearchState {
  query: SearchQuery;
  replacement: string;
  result: SearchResult | null;
  running: boolean;
  error: string | null;
}
export interface Project {
  id: string;
  root: string | null;
  name: string;
  settings: ProjectSettings;
  view: "explorer" | "search" | "scm" | "debug" | "todos" | "results";
  /** Expanded folders: path by path key. */
  expanded: Map<string, string>;
  /** Loaded folder contents by path key. */
  children: Map<string, Entry[]>;
  errors: Map<string, string>;
  selected: string | null;
  git: GitStatus | null;
  search: SearchState;
  /** The folded sections and section heights of each sidebar view, kept across views. */
  sections: Record<string, SectionLayout>;
  error: string | null;
}
export interface SectionLayout {
  closed: string[];
  /** Relative heights of the sections, by section ID. */
  sizes: Record<string, number>;
}
interface Store {
  projects: Map<string, Project>;
  /** Watch owner IDs per project and folder key. */
  watches: Map<string, Map<string, string>>;
  timers: Map<string, number>;
  listeners: Set<() => void>;
  version: number;
  started: boolean;
}
const store: Store = import.meta.hot?.data.ideProjects ?? {
  projects: new Map(),
  watches: new Map(),
  timers: new Map(),
  listeners: new Set(),
  version: 0,
  started: false,
};
if (import.meta.hot) import.meta.hot.data.ideProjects = store;
const { projects, listeners } = store;

function emit() {
  store.version++;
  listeners.forEach((fn) => fn());
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function useProject(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return projects.get(id) ?? null;
}
export function useProjects() {
  useSyncExternalStore(subscribe, () => store.version);
  return [...projects.values()];
}
export const getProject = (id: string) => projects.get(id) ?? null;
export const allProjects = () => [...projects.values()];
function update(id: string, change: Partial<Project>) {
  const project = projects.get(id);
  if (!project) return;
  projects.set(id, { ...project, ...change });
  emit();
}
export function title(id: string) {
  return projects.get(id)?.name ?? "Project";
}
/** The open project containing a path (the innermost when roots nest). */
export function projectFor(path: string) {
  return (
    [...projects.values()]
      .filter((p) => p.root && within(p.root, path))
      .sort((a, b) => b.root!.length - a.root!.length)[0] ?? null
  );
}

export function createProject() {
  const id = crypto.randomUUID();
  projects.set(id, {
    id,
    root: null,
    name: "Project",
    settings: defaultSettings,
    view: "explorer",
    expanded: new Map(),
    children: new Map(),
    errors: new Map(),
    selected: null,
    git: null,
    search: {
      query: { text: "", regex: false, matchCase: false, wholeWord: false },
      replacement: "",
      result: null,
      running: false,
      error: null,
    },
    sections: {},
    error: null,
  });
  start();
  emit();
  return id;
}
export function disposeProject(id: string) {
  for (const owner of store.watches.get(id)?.values() ?? [])
    void fileSystem.watch(owner, null).catch(() => {});
  store.watches.delete(id);
  projects.delete(id);
  emit();
}

function watch(id: string, directory: string, on: boolean) {
  if (!isTauri()) return;
  const owners = store.watches.get(id) ?? new Map<string, string>();
  store.watches.set(id, owners);
  const key = pathKey(directory);
  const owner = owners.get(key);
  if (on && !owner) {
    const created = crypto.randomUUID();
    owners.set(key, created);
    void fileSystem.watch(created, directory).catch(() => owners.delete(key));
  } else if (!on && owner) {
    owners.delete(key);
    void fileSystem.watch(owner, null).catch(() => {});
  }
}
async function load(id: string, directory: string) {
  try {
    const listing = await fileSystem.list(directory);
    const entries = sortEntries(
      listing.entries
        .filter((e) => e.name !== ".git" && !e.unsupported)
        .map((e) => ({
          path: e.path,
          name: e.name,
          directory: isDirectory(e),
        })),
    );
    const project = projects.get(id);
    if (!project) return;
    const children = new Map(project.children).set(pathKey(directory), entries);
    const errors = new Map(project.errors);
    errors.delete(pathKey(directory));
    update(id, { children, errors });
  } catch (e) {
    const project = projects.get(id);
    if (!project) return;
    update(id, {
      errors: new Map(project.errors).set(pathKey(directory), message(e)),
    });
  }
}
export async function refreshGit(id: string) {
  const root = projects.get(id)?.root;
  if (!root) return;
  try {
    const git = await ideBackend.gitStatus(root);
    if (projects.get(id)?.root === root) update(id, { git });
  } catch {
    // Without Git the explorer simply shows no states.
    if (projects.get(id)?.root === root) update(id, { git: null });
  }
}
/** Reloads loaded folders affected by changed paths (all of them for an empty list). */
function changed(paths: string[]) {
  for (const project of projects.values()) {
    if (!project.root) continue;
    const affected = new Set<string>();
    for (const path of paths) {
      if (!within(project.root, path)) continue;
      if (project.children.has(pathKey(parent(path))))
        affected.add(pathKey(parent(path)));
      if (project.children.has(pathKey(path))) affected.add(pathKey(path));
    }
    if (!paths.length)
      for (const key of project.children.keys()) affected.add(key);
    const relevant =
      !paths.length || paths.some((p) => within(project.root!, p));
    if (!relevant) continue;
    clearTimeout(store.timers.get(project.id));
    store.timers.set(
      project.id,
      window.setTimeout(() => {
        const current = projects.get(project.id);
        if (!current?.root) return;
        for (const key of affected) {
          const directory = current.expanded.get(key);
          if (directory) void load(project.id, directory);
        }
        void refreshGit(project.id);
      }, 200),
    );
  }
}
function start() {
  if (store.started || !isTauri()) return;
  store.started = true;
  void listen<string[]>("disk-change", (event) => changed(event.payload));
  window.addEventListener("focus", () => {
    for (const project of projects.values()) void refreshGit(project.id);
  });
}

/** Binds the panel to a folder; `null` shows the folder picker. */
export async function openFolder(id: string, path: string | null = null) {
  const opened = await ideBackend.open(path);
  if (!opened || !projects.has(id)) return false;
  const previous = projects.get(id)!;
  for (const owner of store.watches.get(id)?.values() ?? [])
    void fileSystem.watch(owner, null).catch(() => {});
  store.watches.delete(id);
  update(id, {
    root: opened.root,
    name: opened.name,
    settings: opened.settings,
    expanded: new Map([[pathKey(opened.root), opened.root]]),
    children: new Map(),
    errors: new Map(),
    selected: null,
    git: null,
    search: { ...previous.search, result: null, error: null },
    error: null,
  });
  watch(id, opened.root, true);
  // `.git` changes (commits, checkouts) refresh the branch and states.
  watch(id, join(opened.root, ".git"), true);
  await Promise.all([load(id, opened.root), refreshGit(id)]);
  return true;
}
export async function toggle(id: string, directory: string) {
  const project = projects.get(id);
  if (!project) return;
  const expanded = new Map(project.expanded);
  const key = pathKey(directory);
  const opening = !expanded.has(key);
  if (opening) expanded.set(key, directory);
  else expanded.delete(key);
  update(id, { expanded, selected: directory });
  watch(id, directory, opening);
  if (opening) await load(id, directory);
}
/** Expands the folders above a file so it is visible, and selects it. */
export async function revealInTree(id: string, path: string) {
  const project = projects.get(id);
  if (!project?.root || !within(project.root, path)) return;
  const chain: string[] = [];
  for (
    let directory = parent(path);
    within(project.root, directory) &&
    pathKey(directory) !== pathKey(project.root);
    directory = parent(directory)
  )
    chain.unshift(directory);
  for (const directory of chain)
    if (!projects.get(id)?.expanded.has(pathKey(directory)))
      await toggle(id, directory);
  update(id, { selected: path });
}
export function select(id: string, path: string | null) {
  update(id, { selected: path });
}
export function setView(id: string, view: Project["view"]) {
  update(id, { view });
}
export async function reload(id: string) {
  const project = projects.get(id);
  if (!project?.root) return;
  await Promise.all([
    ...[...project.children.keys()].map((key) => {
      const directory = project.expanded.get(key);
      return directory ? load(id, directory) : undefined;
    }),
    refreshGit(id),
  ]);
}
export function setSections(id: string, view: string, layout: SectionLayout) {
  const project = projects.get(id);
  if (project)
    update(id, { sections: { ...project.sections, [view]: layout } });
}
export function setSearch(id: string, change: Partial<SearchState>) {
  const project = projects.get(id);
  if (project) update(id, { search: { ...project.search, ...change } });
}
export async function runSearch(id: string) {
  const project = projects.get(id);
  if (!project?.root) return;
  const query = project.search.query;
  setSearch(id, { running: true, error: null });
  try {
    const result = await ideBackend.search(project.root, query);
    if (projects.get(id)?.search.query === query)
      setSearch(id, { result, running: false });
  } catch (e) {
    setSearch(id, { running: false, error: message(e), result: null });
  }
}
export async function saveSettings(id: string, settings: ProjectSettings) {
  const project = projects.get(id);
  if (!project?.root) return;
  const saved = await ideBackend.setSettings(project.root, settings);
  update(id, { settings: saved });
}
export function settingsFor(path: string | null) {
  return (path && projectFor(path)?.settings) || defaultSettings;
}
