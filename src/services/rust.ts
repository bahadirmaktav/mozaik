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
