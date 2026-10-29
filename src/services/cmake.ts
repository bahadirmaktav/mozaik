import { Channel, isTauri } from "@tauri-apps/api/core";
import { native } from "./native";

export const VARIANTS = [
  "Debug",
  "Release",
  "RelWithDebInfo",
  "MinSizeRel",
] as const;
export interface CMakeSettings {
  /** Empty: Ninja when found, otherwise the kit's default. */
  generator: string;
  buildDirectory: string;
  buildBeforeRun: boolean;
  /** 0 leaves it to the generator. */
  parallelJobs: number;
}
/** The same defaults as `CMakeSettings::default` in Rust. */
export const defaultCMakeSettings: CMakeSettings = {
  generator: "",
  buildDirectory: "${sourceDir}/build/${kit}-${variant}",
  buildBeforeRun: true,
  parallelJobs: 0,
};
export interface CMakeSettingsInfo {
  settings: CMakeSettings;
  program: string | null;
  /** The program was chosen rather than found. */
  configured: boolean;
  generators: string[];
}
export interface Launch {
  args: string[];
  cwd: string;
}
/** A project's CMake choices, saved with its IDE settings. */
export interface ProjectCMake {
  sourceDirectory: string;
  kit: string | null;
  variant: string;
  configurePreset: string | null;
  buildPreset: string | null;
  /** `null` builds all. */
  buildTarget: string | null;
  runTarget: string | null;
  launch: Record<string, Launch>;
}
export const defaultCMake: ProjectCMake = {
  sourceDirectory: "",
  kit: null,
  variant: "",
  configurePreset: null,
  buildPreset: null,
  buildTarget: null,
  runTarget: null,
  launch: {},
};
export interface Kit {
  id: string;
  name: string;
  slug: string;
  kind: "msvc" | "gcc" | "clang" | "clangCl";
  cxx: string;
  version: string;
  target: string;
}
export interface PresetInfo {
  name: string;
  display: string;
  configure: string | null;
}
export interface Target {
  name: string;
  kind: string;
  artifact: string | null;
}
export interface CMakeProjectInfo {
  /** The source folder has a CMakeLists.txt. */
  cmake: boolean;
  source: string;
  presets: boolean;
  configurePresets: PresetInfo[];
  buildPresets: PresetInfo[];
  buildDir: string | null;
  generator: string | null;
  /** `null` until the build folder was configured. */
  targets: Target[] | null;
  compileCommands: boolean;
  error: string | null;
}
export type Step =
  "configure" | "reconfigure" | "build" | "clean" | "cleanRebuild";
export interface StepResult {
  finished: { code: number | null; cancelled: boolean };
  info: CMakeProjectInfo;
}

/** Typed adapter for the native CMake commands; replaceable in browser tests. */
export const cmakeBackend = {
  settings: () => native<CMakeSettingsInfo>("cmake_settings"),
  setSettings: (settings: CMakeSettings) =>
    native<CMakeSettingsInfo>("cmake_set_settings", { settings }),
  /** `reset` goes back to the detected program; otherwise a native dialog. */
  chooseProgram: (reset: boolean) =>
    native<CMakeSettingsInfo | null>("cmake_choose_program", { reset }),
  kits: (rescan: boolean) => native<Kit[]>("cmake_kits", { rescan }),
  project: (root: string) =>
    native<CMakeProjectInfo>("cmake_project", { root }),
  run(
    root: string,
    step: Step,
    target: string | null,
    onOutput: (text: string) => void,
  ) {
    if (!isTauri()) return native<StepResult>("cmake_run");
    const events = new Channel<{ kind: "output"; text: string }>();
    events.onmessage = (event) => onOutput(event.text);
    return native<StepResult>("cmake_run", { root, step, target, events });
  },
  cancel: (root: string) => native<void>("cmake_cancel", { root }),
};
