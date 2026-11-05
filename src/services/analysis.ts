import { Channel } from "@tauri-apps/api/core";
import { native } from "./native";

/** Workspace Settings → IDE → Code Analysis (see `analysis.rs`). */
export interface AnalysisSettings {
  /** clang-tidy checks: clangd's live ones and the commands that run the program. */
  clangTidyEnabled: boolean;
  maxParallelJobs: number;
  /** "onSave" analyzes a C/C++ file of a project after it was saved. */
  autoAnalysis: "off" | "onSave";
  /** The checks of a project without a `.clang-tidy` of its own. */
  defaultChecks: string;
  /** Compiler warnings for clangd and clang-tidy, like `-Wall -Wextra`. */
  warningFlags: string;
}
/** The same defaults as `AnalysisSettings::default` in Rust. */
export const defaultAnalysisSettings: AnalysisSettings = {
  clangTidyEnabled: true,
  maxParallelJobs: 2,
  autoAnalysis: "off",
  defaultChecks:
    "bugprone-*,cert-*,clang-analyzer-*,concurrency-*,cppcoreguidelines-*,misc-*,modernize-*,performance-*,portability-*,readability-*,-modernize-use-trailing-return-type,-readability-identifier-length,-readability-magic-numbers",
  warningFlags: "-Wall -Wextra",
};
export interface AnalysisInfo {
  settings: AnalysisSettings;
  /** The clang-tidy that will run, or null when none was found. */
  program: string | null;
  configured: boolean;
  version: string | null;
}
export interface Position {
  line: number;
  character: number;
}
export interface FixEdit {
  path: string;
  start: Position;
  end: Position;
  newText: string;
}
export interface Finding {
  path: string;
  position: Position;
  /** 1 error, 2 warning, 3 information. */
  severity: 1 | 2 | 3;
  /** clang-tidy's own level. */
  level: string;
  rule: string;
  message: string;
  related: { path: string; position: Position; message: string }[];
  fix: FixEdit[];
}
export interface FileResult {
  path: string;
  findings: Finding[];
  /** SHA-256 of each file a finding or fix refers to, as analyzed. */
  hashes: Record<string, string>;
  code: number | null;
}
export type AnalysisEvent =
  | { kind: "started"; total: number; build: string }
  | { kind: "output"; text: string }
  | { kind: "file"; result: FileResult };

/** Typed adapter for the native clang-tidy commands. */
export const analysisBackend = {
  info: () => native<AnalysisInfo>("analysis_info"),
  setSettings: (settings: AnalysisSettings) =>
    native<AnalysisInfo>("analysis_set_settings", { settings }),
  chooseProgram: (reset: boolean) =>
    native<AnalysisInfo | null>("analysis_choose_program", { reset }),
  /** One file of the project, or with `file` null every file of its compilation database. */
  run(
    root: string,
    file: string | null,
    onEvent: (event: AnalysisEvent) => void,
  ) {
    const events = new Channel<AnalysisEvent>();
    events.onmessage = onEvent;
    return native<{ files: number; cancelled: boolean }>("analysis_run", {
      root,
      file,
      events,
    });
  },
  cancel: (root: string) => native<void>("analysis_cancel", { root }),
  /** The files whose text is no longer the analyzed one. */
  changed: (hashes: Record<string, string>) =>
    native<string[]>("analysis_check", { hashes }),
};
