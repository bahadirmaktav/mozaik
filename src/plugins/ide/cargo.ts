import { useSyncExternalStore } from "react";
import {
  ANALYZER_SETTINGS,
  cargoBackend,
  defaultCargo,
  rustBackend,
  type CargoStep,
  type CargoTarget,
  type ProjectCargo,
  type RustSettings,
  type RustSettingsInfo,
} from "../../services/rust";
import { cargoProblems, targetLabel } from "./cargoModel";
import { host, message, setBuildProblems, type Diagnostic } from "./editors";
import { restartAll } from "./lsp";
import { appendOutput } from "./channels";
import { startRun } from "./panels";
import { pathKey } from "../../lib/paths";
import { allProjects, getProject, saveSettings } from "./projects";
import { activeProject } from "./cmake";

/**
 * Rust projects with Cargo, after VS Code's rust-analyzer extension: the settings of
 * Workspace Settings → IDE → Rust, and per project the profile, targets, build steps and
 * run. Nothing of Cargo runs unless the user asks; the target list (cargo metadata) is read
 * when a choice or a run needs it.
 */
interface State {
  /** The project folder has a Cargo.toml; null before it is known. */
  cargo: boolean | null;
  root: string | null;
  targets: CargoTarget[] | null;
  task: { step: CargoStep; target: string | null } | null;
}
interface Store {
  projects: Map<string, State>;
  settings: RustSettingsInfo | null;
  listeners: Set<() => void>;
  version: number;
}
const store: Store = import.meta.hot?.data.ideCargo ?? {
  projects: new Map(),
  settings: null,
  listeners: new Set(),
  version: 0,
};
if (import.meta.hot) import.meta.hot.data.ideCargo = store;

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
export function useCargoStore() {
  useSyncExternalStore(subscribe, () => store.version);
  return store;
}
const empty: State = { cargo: null, root: null, targets: null, task: null };
export function useCargo(id: string) {
  useSyncExternalStore(subscribe, () => store.version);
  return store.projects.get(id) ?? empty;
}
/** Whether a project is a Cargo project, outside React (null before it is known). */
export const isCargo = (id: string) => store.projects.get(id)?.cargo ?? null;
function update(id: string, change: Partial<State>) {
  store.projects.set(id, { ...(store.projects.get(id) ?? empty), ...change });
  emit();
}

export async function loadRustSettings(refresh = false) {
  if (!store.settings || refresh) {
    store.settings = await rustBackend.settings();
    emit();
  }
  return store.settings;
}
/** Saves the settings; rust-analyzer starts again when one of its own changed. */
export async function saveRustSettings(settings: RustSettings) {
  const before = store.settings?.settings;
  store.settings = await rustBackend.setSettings(settings);
  emit();
  if (!before || ANALYZER_SETTINGS.some((key) => before[key] !== settings[key]))
    restartAll("rust-analyzer");
}
export async function chooseCargo(reset: boolean) {
  const info = await rustBackend.chooseCargo(reset);
  if (info) {
    store.settings = info;
    emit();
  }
}

export const cargoChoices = (id: string): ProjectCargo => ({
  ...defaultCargo,
  ...getProject(id)?.settings.cargo,
});
export const profileOf = (cargo: ProjectCargo) => cargo.profile || "dev";

/** Reads whether the project folder has a Cargo.toml; runs no process. */
export async function refreshCargo(id: string) {
  const root = getProject(id)?.root ?? null;
  if (!root) return update(id, { cargo: null, root: null, targets: null });
  try {
    const { cargo } = await cargoBackend.project(root);
    if (getProject(id)?.root !== root) return;
    const known = store.projects.get(id);
    update(id, {
      cargo,
      root,
      targets: known?.root === root ? known.targets : null,
    });
  } catch {
    if (getProject(id)?.root === root) update(id, { cargo: false, root });
  }
}
/** The workspace's targets, from cargo metadata the first time (or `force`). */
export async function loadTargets(id: string, force = false) {
  const root = getProject(id)?.root;
  if (!root) return [];
  const known = store.projects.get(id)?.targets;
  if (known && !force) return known;
  const targets = await cargoBackend.targets(root);
  if (getProject(id)?.root === root) update(id, { targets });
  return targets;
}
/** The project Cargo's palette commands act on: the IDE project used last, else the first
 * Cargo one. */
export function activeCargoProject() {
  const last = activeProject();
  if (last && store.projects.get(last.id)?.cargo) return last;
  return (
    allProjects().find((p) => p.root && store.projects.get(p.id)?.cargo) ?? null
  );
}

async function setChoice(id: string, change: Partial<ProjectCargo>) {
  const project = getProject(id);
  if (!project?.root) return;
  await saveSettings(id, {
    ...project.settings,
    cargo: { ...cargoChoices(id), ...change },
  });
  emit();
}
const KINDS: Record<CargoTarget["kind"], string> = {
  lib: "Library",
  bin: "Binary",
  example: "Example",
  test: "Integration test",
  bench: "Benchmark",
};
const detailOf = (target: CargoTarget, targets: CargoTarget[]) => {
  const packages = new Set(targets.map((t) => t.package));
  return `${KINDS[target.kind]}${packages.size > 1 ? ` · ${target.package}` : ""}`;
};
const DEFAULT = "\0default";

export async function selectProfile(id: string) {
  const picked = await host().pick(
    "Select a Cargo profile",
    [
      {
        id: "dev",
        label: "dev",
        detail: "Unoptimized, with debug information",
      },
      { id: "release", label: "release", detail: "Optimized (--release)" },
    ],
    { selected: profileOf(cargoChoices(id)) },
  );
  if (picked) await setChoice(id, { profile: picked === "dev" ? "" : picked });
}
export async function selectBuildTarget(id: string) {
  const targets = await loadTargets(id, true);
  const picked = await host().pick("Select a build target", [
    {
      id: DEFAULT,
      label: "[default]",
      detail: "The workspace's default members",
    },
    ...targets.map((t) => ({
      id: t.id,
      label: t.name,
      detail: detailOf(t, targets),
    })),
  ]);
  if (picked)
    await setChoice(id, { buildTarget: picked === DEFAULT ? null : picked });
}
export async function selectRunTarget(id: string) {
  const targets = (await loadTargets(id, true)).filter(
    (t) => t.kind === "bin" || t.kind === "example",
  );
  if (!targets.length) {
    host().report("The workspace has no binaries or examples to run");
    return null;
  }
  const picked = await host().pick(
    "Select a run target",
    targets.map((t) => ({
      id: t.id,
      label: t.name,
      detail: detailOf(t, targets),
    })),
  );
  if (picked) await setChoice(id, { runTarget: picked });
  return picked;
}

function problemsOf(output: string, root: string) {
  const files = new Map<string, Diagnostic[]>();
  const separator = root.includes("\\") ? "\\" : "/";
  for (const p of cargoProblems(output)) {
    const absolute = /^([a-z]:[\\/]|[\\/])/i.test(p.path);
    const path = absolute
      ? p.path
      : `${root.replace(/[\\/]$/, "")}${separator}${p.path.replace(/[\\/]/g, separator)}`;
    const position = { line: p.line - 1, character: p.column - 1 };
    const list = files.get(path) ?? [];
    list.push({
      range: { start: position, end: position },
      severity: p.severity,
      message: p.message,
      source: "build",
      ...(p.code && { code: p.code }),
    });
    files.set(path, list);
  }
  return files;
}
const STEP_NAMES: Record<CargoStep, string> = {
  build: "Build",
  check: "Check",
  clippy: "Clippy",
  clean: "Clean",
};

/** Runs one Cargo step, showing its output; `true` when it succeeded. */
async function runStep(
  id: string,
  step: CargoStep,
  target: string | null = null,
) {
  const root = getProject(id)?.root;
  if (!root) return false;
  const state = store.projects.get(id);
  if (state?.task) {
    host().report("A Cargo task is already running for this project");
    return false;
  }
  if (state?.cargo == null) await refreshCargo(id);
  if (!store.projects.get(id)?.cargo) {
    host().report("This project has no Cargo.toml");
    return false;
  }
  update(id, { task: { step, target } });
  host().showPanel(root, "output", "Cargo");
  let output = "";
  try {
    const result = await cargoBackend.run(root, step, target, (text) => {
      output += text;
      appendOutput("Cargo", text);
    });
    update(id, { task: null });
    if (step !== "clean")
      setBuildProblems(`cargo\0${pathKey(root)}`, problemsOf(output, root));
    else setBuildProblems(`cargo\0${pathKey(root)}`, new Map());
    return result.finished.code === 0 && !result.finished.cancelled;
  } catch (e) {
    update(id, { task: null });
    appendOutput("Cargo", `[error] ${message(e)}\n`);
    host().report(e);
    return false;
  }
}

export const buildCargo = (id: string, target = cargoChoices(id).buildTarget) =>
  runStep(id, "build", target);
export const checkCargo = (id: string) =>
  runStep(id, "check", cargoChoices(id).buildTarget);
export const clippyCargo = (id: string) =>
  runStep(id, "clippy", cargoChoices(id).buildTarget);
export const cleanCargo = (id: string) => runStep(id, "clean");
export function cancelCargo(id: string) {
  const root = getProject(id)?.root;
  if (root) void cargoBackend.cancel(root).catch((e) => host().report(e));
}

/** Builds the run target first (a setting), then starts it in the bottom panel's Run view. */
export async function runCargo(id: string) {
  const root = getProject(id)?.root;
  if (!root) return;
  const target = cargoChoices(id).runTarget ?? (await selectRunTarget(id));
  if (!target) return;
  const settings = await loadRustSettings().catch(() => null);
  if (
    settings?.settings.buildBeforeRun !== false &&
    !(await buildCargo(id, target))
  )
    return;
  const panel = host().showPanel(root, "run");
  if (!panel) return host().report("There is no room for the IDE panel here");
  startRun(panel, root, target);
}

/** The palette's Cargo commands for the active Cargo project. */
export function cargoCommands() {
  const project = activeCargoProject();
  if (!project) return [];
  const id = project.id;
  const task = store.projects.get(id)?.task;
  const report = (work: Promise<unknown>) =>
    void work.catch((e) => host().report(e));
  const list: { id: string; label: string; run: () => void }[] = [];
  const add = (
    key: string,
    label: string,
    run: () => Promise<unknown> | void,
  ) =>
    list.push({
      id: `cargo.${key}`,
      label: `Cargo: ${label}`,
      run: () => report(Promise.resolve(run())),
    });
  add("profile", "Select Profile", () => selectProfile(id));
  add("buildTarget", "Select Build Target", () => selectBuildTarget(id));
  add("runTarget", "Select Run Target", () => selectRunTarget(id));
  for (const step of ["build", "check", "clippy", "clean"] as const)
    add(step, STEP_NAMES[step], () =>
      runStep(id, step, step === "clean" ? null : cargoChoices(id).buildTarget),
    );
  add("run", "Run", () => runCargo(id));
  if (task) add("cancel", "Cancel", () => cancelCargo(id));
  return list;
}
export { targetLabel };
