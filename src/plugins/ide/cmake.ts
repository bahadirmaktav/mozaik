import { useSyncExternalStore } from "react";
import {
  cmakeBackend,
  defaultCMake,
  VARIANTS,
  type CMakeProjectInfo,
  type CMakeSettingsInfo,
  type Kit,
  type ProjectCMake,
  type Step,
} from "../../services/cmake";
import { problems } from "./buildOutput";
import { host, message, setBuildProblems, type Diagnostic } from "./editors";
import { restart } from "./lsp";
import { appendOutput } from "./channels";
import { startRun } from "./panels";
import { pathKey } from "./paths";
import { allProjects, getProject, saveSettings } from "./projects";

/**
 * CMake for IDE projects, after VS Code's CMake Tools: kit or preset choices, manual
 * configure, build/clean of File API targets and run. Nothing runs unless the user asks.
 */
interface State {
  /** What Rust found for the project's source folder; null before it is known. */
  info: CMakeProjectInfo | null;
  root: string | null;
  task: { step: Step; target: string | null } | null;
}
interface Store {
  projects: Map<string, State>;
  kits: Kit[] | null;
  settings: CMakeSettingsInfo | null;
  /** The IDE project used last, for palette commands. */
  last: string | null;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideCMake ?? {
  projects: new Map(),
  kits: null,
  settings: null,
  last: null,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideCMake = store;

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
const empty: State = { info: null, root: null, task: null };
export function useCMake(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return store.projects.get(id) ?? empty;
}
export function useCMakeStore() {
  useSyncExternalStore(subscribe, () => store.version);
  return store;
}
function update(id: string, change: Partial<State>) {
  store.projects.set(id, { ...(store.projects.get(id) ?? empty), ...change });
  emit();
}
export const choices = (id: string): ProjectCMake => ({
  ...defaultCMake,
  ...getProject(id)?.settings.cmake,
});
export const variantOf = (cmake: ProjectCMake) => cmake.variant || "Debug";

/** Reads what the project's source folder holds; runs no process. */
export async function refresh(id: string) {
  const root = getProject(id)?.root ?? null;
  if (!root) return update(id, { info: null, root: null });
  try {
    const info = await cmakeBackend.project(root);
    if (getProject(id)?.root === root) update(id, { info, root });
  } catch {
    // Without the desktop app (or a readable folder) the project is simply not CMake.
    if (getProject(id)?.root === root) update(id, { info: null, root });
  }
}
export function noteProject(id: string | null) {
  if (id && store.last !== id) {
    store.last = id;
    emit();
  }
}
/** The IDE project palette commands act on: the one used last, else the first CMake one. */
export function activeProject() {
  const projects = allProjects().filter((p) => p.root);
  return (
    projects.find((p) => p.id === store.last) ??
    projects.find((p) => store.projects.get(p.id)?.info?.cmake) ??
    null
  );
}

export async function loadSettings(refresh = false) {
  if (!store.settings || refresh) {
    store.settings = await cmakeBackend.settings();
    emit();
  }
  return store.settings;
}
export async function saveCMakeSettings(
  settings: CMakeSettingsInfo["settings"],
) {
  store.settings = await cmakeBackend.setSettings(settings);
  emit();
  refreshAll();
}
export async function chooseProgram(reset: boolean) {
  const info = await cmakeBackend.chooseProgram(reset);
  if (info) {
    store.settings = info;
    emit();
  }
}
export async function loadKits(rescan = false) {
  if (!store.kits || rescan) {
    store.kits = await cmakeBackend.kits(rescan);
    emit();
  }
  return store.kits;
}
function refreshAll() {
  for (const id of store.projects.keys()) void refresh(id);
}

/** Saves a project's CMake choices; the language server follows the new build folder. */
export async function setChoice(id: string, change: Partial<ProjectCMake>) {
  const project = getProject(id);
  if (!project?.root) return;
  await saveSettings(id, {
    ...project.settings,
    cmake: { ...choices(id), ...change },
  });
  await refresh(id);
  if (
    ["kit", "variant", "configurePreset", "sourceDirectory"].some(
      (key) => key in change,
    )
  )
    restart(project.root);
}

const KINDS: Record<string, string> = {
  EXECUTABLE: "Executable",
  STATIC_LIBRARY: "Static library",
  SHARED_LIBRARY: "Shared library",
  MODULE_LIBRARY: "Module library",
  OBJECT_LIBRARY: "Object library",
  INTERFACE_LIBRARY: "Interface library",
  UTILITY: "Utility",
};
const SCAN = "\0scan";
const ALL = "\0all";

export async function selectKit(id: string) {
  const kits = await loadKits();
  const picked = await host().pick("Select a kit", [
    ...kits.map((k) => ({ id: k.id, label: k.name, detail: k.cxx })),
    {
      id: "unspecified",
      label: "[Unspecified]",
      detail: "Let CMake choose the compiler",
    },
    { id: SCAN, label: "Scan for kits", detail: "Search this system again" },
  ]);
  if (picked === SCAN) {
    await loadKits(true);
    return selectKit(id);
  }
  if (picked) await setChoice(id, { kit: picked });
  return picked;
}
export async function selectVariant(id: string) {
  const picked = await host().pick(
    "Select a variant",
    VARIANTS.map((v) => ({ id: v, label: v })),
  );
  if (picked) await setChoice(id, { variant: picked });
}
export async function selectConfigurePreset(id: string) {
  const presets = store.projects.get(id)?.info?.configurePresets ?? [];
  if (!presets.length)
    return host().report("This project has no configure presets");
  const picked = await host().pick(
    "Select a configure preset",
    presets.map((p) => ({ id: p.name, label: p.display, detail: p.name })),
  );
  if (picked)
    await setChoice(id, { configurePreset: picked, buildPreset: null });
}
export async function selectBuildPreset(id: string) {
  const info = store.projects.get(id)?.info;
  const configure =
    choices(id).configurePreset ?? info?.configurePresets[0]?.name;
  const presets = (info?.buildPresets ?? []).filter(
    (p) => p.configure === configure,
  );
  if (!presets.length)
    return host().report(
      `No build preset uses the configure preset ${configure}`,
    );
  const picked = await host().pick("Select a build preset", [
    {
      id: ALL,
      label: "[Default]",
      detail: "Build the configure preset's folder",
    },
    ...presets.map((p) => ({ id: p.name, label: p.display, detail: p.name })),
  ]);
  if (picked)
    await setChoice(id, { buildPreset: picked === ALL ? null : picked });
}
function targetsOf(id: string) {
  const targets = store.projects.get(id)?.info?.targets;
  if (!targets) {
    host().report("Configure the project first to list its targets");
    return null;
  }
  return targets.filter((t) => t.kind !== "INTERFACE_LIBRARY");
}
export async function selectBuildTarget(id: string) {
  const targets = targetsOf(id);
  if (!targets) return;
  const picked = await host().pick("Select a build target", [
    { id: ALL, label: "all", detail: "Every default target" },
    ...targets.map((t) => ({
      id: t.name,
      label: t.name,
      detail: KINDS[t.kind] ?? t.kind,
    })),
  ]);
  if (picked)
    await setChoice(id, { buildTarget: picked === ALL ? null : picked });
}
export async function selectRunTarget(id: string) {
  const targets = targetsOf(id)?.filter((t) => t.kind === "EXECUTABLE");
  if (!targets) return null;
  if (!targets.length) {
    host().report("The project has no executable targets");
    return null;
  }
  const picked = await host().pick(
    "Select a run target",
    targets.map((t) => ({
      id: t.name,
      label: t.name,
      detail: t.artifact ?? "",
    })),
  );
  if (picked) await setChoice(id, { runTarget: picked });
  return picked;
}

function problemsOf(output: string, info: CMakeProjectInfo) {
  const files = new Map<string, Diagnostic[]>();
  for (const p of problems(output, info.source, info.buildDir ?? info.source)) {
    const position = { line: p.line - 1, character: p.column - 1 };
    const list = files.get(p.path) ?? [];
    list.push({
      range: { start: position, end: position },
      severity: p.severity,
      message: p.message,
      source: "build",
    });
    files.set(p.path, list);
  }
  return files;
}

/** Runs one step, showing its output; `true` when it succeeded. */
async function runStep(id: string, step: Step, target: string | null = null) {
  const project = getProject(id);
  const root = project?.root;
  if (!root) return false;
  const state = store.projects.get(id);
  if (state?.task) {
    host().report("A CMake task is already running for this project");
    return false;
  }
  if (!state?.info) await refresh(id);
  if (!store.projects.get(id)?.info?.cmake) {
    host().report("This project has no CMakeLists.txt (see Project Settings)");
    return false;
  }
  const info = store.projects.get(id)!.info!;
  if (!info.presets && !choices(id).kit && step !== "clean") {
    if (!(await selectKit(id))) return false;
  }
  noteProject(id);
  update(id, { task: { step, target } });
  host().showPanel(root, "output");
  let output = "";
  try {
    const result = await cmakeBackend.run(root, step, target, (text) => {
      output += text;
      appendOutput("CMake", text);
    });
    update(id, { info: result.info, task: null });
    setBuildProblems(pathKey(root), problemsOf(output, result.info));
    const ok = result.finished.code === 0 && !result.finished.cancelled;
    // clangd reads the new compilation database.
    if (ok && (step === "configure" || step === "reconfigure")) restart(root);
    return ok;
  } catch (e) {
    update(id, { task: null });
    appendOutput("CMake", `[error] ${message(e)}\n`);
    host().report(e);
    return false;
  }
}

export const configure = (id: string, fresh = false) =>
  runStep(id, fresh ? "reconfigure" : "configure");
export const build = (id: string, target = choices(id).buildTarget) =>
  runStep(id, "build", target);
export const buildAll = (id: string) => runStep(id, "build", null);
export const clean = (id: string) => runStep(id, "clean");
export const cleanRebuild = (id: string) =>
  runStep(id, "cleanRebuild", choices(id).buildTarget);
export function cancel(id: string) {
  const root = getProject(id)?.root;
  if (root) void cmakeBackend.cancel(root).catch((e) => host().report(e));
}

/** Builds the run target first (a setting), then starts it in the bottom panel's Run view. */
export async function run(id: string) {
  const root = getProject(id)?.root;
  if (!root) return;
  if (!store.projects.get(id)?.info) await refresh(id);
  const target = choices(id).runTarget ?? (await selectRunTarget(id));
  if (!target) return;
  const settings = await loadSettings().catch(() => null);
  if (settings?.settings.buildBeforeRun !== false && !(await build(id, target)))
    return;
  const panel = host().showPanel(root, "run");
  if (!panel) return host().report("There is no room for the IDE panel here");
  startRun(panel, root, target);
}

/** The palette's CMake commands for the active project. */
export function commands() {
  const project = activeProject();
  const info = project && store.projects.get(project.id)?.info;
  if (!project || !info?.cmake) return [];
  const id = project.id;
  const report = (work: Promise<unknown>) =>
    void work.catch((e) => host().report(e));
  const list: { id: string; label: string; run: () => void }[] = [];
  const add = (
    key: string,
    label: string,
    run: () => Promise<unknown> | void,
  ) =>
    list.push({
      id: `cmake.${key}`,
      label: `CMake: ${label}`,
      run: () => report(Promise.resolve(run())),
    });
  if (info.presets) {
    add("configurePreset", "Select Configure Preset", () =>
      selectConfigurePreset(id),
    );
    add("buildPreset", "Select Build Preset", () => selectBuildPreset(id));
  } else {
    add("kit", "Select Kit", () => selectKit(id));
    add("variant", "Select Variant", () => selectVariant(id));
    add("scan", "Scan for Kits", () => loadKits(true));
  }
  add("buildTarget", "Select Build Target", () => selectBuildTarget(id));
  add("runTarget", "Select Run Target", () => selectRunTarget(id));
  add("configure", "Configure", () => configure(id));
  add("reconfigure", "Delete Cache and Reconfigure", () => configure(id, true));
  add("build", "Build", () => build(id));
  add("buildAll", "Build All", () => buildAll(id));
  add("clean", "Clean", () => clean(id));
  add("cleanRebuild", "Clean Rebuild", () => cleanRebuild(id));
  add("run", "Run", () => run(id));
  if (store.projects.get(id)?.task) add("cancel", "Cancel", () => cancel(id));
  return list;
}
