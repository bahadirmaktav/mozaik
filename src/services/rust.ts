import { Channel, isTauri } from "@tauri-apps/api/core";
import { native } from "./native";

/** Workspace Settings → IDE → Rust (`cargo.rs`, `rust.json` in the app config). */
export interface RustSettings {
  /** rust-analyzer runs cargo check (or Clippy) after a Rust file is saved. */
  checkOnSave: boolean;
  checkCommand: "check" | "clippy";
  /** rust-analyzer builds and runs build scripts and procedural macros. */
  buildScripts: boolean;
  inlayHints: boolean;
  buildBeforeRun: boolean;
  /** Build, Run and Test with --offline. */
  offline: boolean;
  /** 0 leaves it to Cargo. */
  parallelJobs: number;
}
/** The same defaults as `RustSettings::default` in Rust. */
export const defaultRustSettings: RustSettings = {
  checkOnSave: true,
  checkCommand: "check",
  buildScripts: true,
  inlayHints: true,
  buildBeforeRun: true,
  offline: false,
  parallelJobs: 0,
};
export interface RustSettingsInfo {
  settings: RustSettings;
  /** The cargo that runs, or null when none was found. */
  cargo: string | null;
  /** Chosen rather than found. */
  configured: boolean;
}
/** The settings rust-analyzer starts with: changing them starts it again. */
export const ANALYZER_SETTINGS: (keyof RustSettings)[] = [
  "checkOnSave",
  "checkCommand",
  "buildScripts",
  "inlayHints",
];

/** Typed adapter for the native Rust and Cargo commands; replaceable in browser tests. */
export const rustBackend = {
  settings: () => native<RustSettingsInfo>("rust_settings"),
  setSettings: (settings: RustSettings) =>
    native<RustSettingsInfo>("rust_set_settings", { settings }),
  /** `reset` goes back to the detected cargo; otherwise a native dialog. */
  chooseCargo: (reset: boolean) =>
    native<RustSettingsInfo | null>("rust_choose_cargo", { reset }),
};

/** A project's Cargo choices, saved with its IDE settings. */
export interface ProjectCargo {
  /** "" or "dev", or "release". */
  profile: string;
  /** A target id (`cargo:<kind>:<package>:<name>`); null builds the default members. */
  buildTarget: string | null;
  runTarget: string | null;
  launch: Record<string, { args: string[]; cwd: string }>;
}
export const defaultCargo: ProjectCargo = {
  profile: "",
  buildTarget: null,
  runTarget: null,
  launch: {},
};
export interface CargoTarget {
  id: string;
  name: string;
  kind: "lib" | "bin" | "example" | "test" | "bench";
  package: string;
  srcPath: string;
}
export type CargoStep = "build" | "check" | "clippy" | "clean";
export interface CargoStepResult {
  finished: { code: number | null; cancelled: boolean };
}

/** Typed adapter for the native Cargo commands; replaceable in browser tests. */
export const cargoBackend = {
  /** Whether the folder has a Cargo.toml; runs nothing. */
  project: (root: string) =>
    native<{ cargo: boolean }>("cargo_project", { root }),
  /** The workspace's targets, from cargo metadata. */
  targets: (root: string) => native<CargoTarget[]>("cargo_targets", { root }),
  run(
    root: string,
    step: CargoStep,
    target: string | null,
    onOutput: (text: string) => void,
  ) {
    if (!isTauri()) return native<CargoStepResult>("cargo_run");
    const events = new Channel<{ kind: "output"; text: string }>();
    events.onmessage = (event) => onOutput(event.text);
    return native<CargoStepResult>("cargo_run", {
      root,
      step,
      target,
      events,
    });
  },
  cancel: (root: string) => native<void>("cargo_cancel", { root }),
};
