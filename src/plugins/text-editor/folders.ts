import { useSyncExternalStore } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fileSystem, isDirectory } from "../../services/filesystem";
import { fileBackend } from "../../services/native";
import { sortEntries, type Entry } from "../ide/model";
import { baseName, parent, pathKey, within } from "../ide/paths";

/**
 * The folder shown beside a Text Editor panel, as in Sublime Text's sidebar: one per
 * workspace panel, lazy and watched like the IDE explorer, without Git, search or file
 * operations. It lives only while its panel does; nothing is restored at startup.
 */
export interface Folder {
  root: string;
  name: string;
  /** Expanded folders by path key (the root always). */
  expanded: ReadonlyMap<string, string>;
  /** Loaded listings by folder path key. */
  children: ReadonlyMap<string, Entry[]>;
  errors: ReadonlyMap<string, string>;
  selected: string | null;
  width: number;
}
export const FOLDER_WIDTH = { min: 120, initial: 220, max: 480 };

const folders = new Map<string, Folder>();
const listeners = new Set<() => void>();
// Directory watches per panel, by folder path key.
const watches = new Map<string, Map<string, string>>();
const timers = new Map<string, number>();
let started = false;

function emit() {
  listeners.forEach((fn) => fn());
}
function update(panel: string, patch: Partial<Folder>) {
  const folder = folders.get(panel);
  if (!folder) return;
  folders.set(panel, { ...folder, ...patch });
  emit();
}
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
export const folderOf = (panel: string) => folders.get(panel) ?? null;
export function useFolder(panel: string) {
  return useSyncExternalStore(subscribe, () => folderOf(panel));
}

function watch(panel: string, directory: string, on: boolean) {
  const owners = watches.get(panel) ?? new Map<string, string>();
  watches.set(panel, owners);
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
function unwatchAll(panel: string) {
  for (const owner of watches.get(panel)?.values() ?? [])
    void fileSystem.watch(owner, null).catch(() => {});
  watches.delete(panel);
}
async function load(panel: string, directory: string) {
  const root = folders.get(panel)?.root;
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
    const folder = folders.get(panel);
    // The panel closed or opened another folder meanwhile.
    if (!folder || folder.root !== root) return;
    const errors = new Map(folder.errors);
    errors.delete(pathKey(directory));
    update(panel, {
      children: new Map(folder.children).set(pathKey(directory), entries),
      errors,
    });
  } catch (e) {
    const folder = folders.get(panel);
    if (!folder || folder.root !== root) return;
    update(panel, {
      errors: new Map(folder.errors).set(
        pathKey(directory),
        e instanceof Error ? e.message : String(e),
      ),
    });
  }
}
/** Reloads the loaded folders a disk change touched (all of them for an empty list). */
function changed(paths: string[]) {
  for (const [panel, folder] of folders) {
    const affected = new Set<string>();
    for (const path of paths) {
      if (!within(folder.root, path)) continue;
      if (folder.children.has(pathKey(parent(path))))
        affected.add(pathKey(parent(path)));
      if (folder.children.has(pathKey(path))) affected.add(pathKey(path));
    }
    if (!paths.length)
      for (const key of folder.children.keys()) affected.add(key);
    if (!affected.size) continue;
    clearTimeout(timers.get(panel));
    timers.set(
      panel,
      window.setTimeout(() => {
        const current = folders.get(panel);
        if (!current) return;
        for (const key of affected) {
          const directory = current.expanded.get(key);
          if (directory) void load(panel, directory);
        }
      }, 200),
    );
  }
}
function start() {
  if (started || !isTauri()) return;
  started = true;
  void listen<string[]>("disk-change", (event) => changed(event.payload));
}

/** Shows a folder beside the panel; without `path`, the one picked in the native dialog. */
export async function openFolder(panel: string, path?: string) {
  const root = path ?? (await fileBackend.chooseFolder());
  if (!root) return false;
  start();
  unwatchAll(panel);
  folders.set(panel, {
    root,
    name: baseName(root) || root,
    expanded: new Map([[pathKey(root), root]]),
    children: new Map(),
    errors: new Map(),
    selected: null,
    width: folders.get(panel)?.width ?? FOLDER_WIDTH.initial,
  });
  emit();
  watch(panel, root, true);
  await load(panel, root);
  return true;
}
export function closeFolder(panel: string) {
  if (!folders.has(panel)) return;
  unwatchAll(panel);
  clearTimeout(timers.get(panel));
  timers.delete(panel);
  folders.delete(panel);
  emit();
}
/** Drops the folders of panels that are gone (closed, or emptied by tab moves). */
export function keepFolders(panels: Set<string>) {
  for (const panel of [...folders.keys()])
    if (!panels.has(panel)) closeFolder(panel);
}
export async function toggle(panel: string, directory: string) {
  const folder = folders.get(panel);
  if (!folder) return;
  const expanded = new Map(folder.expanded);
  const key = pathKey(directory);
  const opening = !expanded.has(key);
  if (opening) expanded.set(key, directory);
  else expanded.delete(key);
  update(panel, { expanded, selected: directory });
  watch(panel, directory, opening);
  if (opening) await load(panel, directory);
}
export function select(panel: string, path: string | null) {
  update(panel, { selected: path });
}
export function setWidth(panel: string, width: number) {
  update(panel, {
    width: Math.round(
      Math.min(FOLDER_WIDTH.max, Math.max(FOLDER_WIDTH.min, width)),
    ),
  });
}
