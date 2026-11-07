/**
 * The IDE's built-in features, each of which the user can turn off in Workspace Settings →
 * IDE → Features, as extensions are in VS Code (`docs/decisions/024-ide-features.md`). They
 * are trusted parts of Mozaik, not loaded plugins: a feature that is off hides its views,
 * status bar items, commands and menus and starts none of its processes. All are on by
 * default; the preference keeps the ones turned off.
 */
import { useSyncExternalStore } from "react";

export type Feature =
  | "languageServer"
  | "sourceControl"
  | "cmake"
  | "debugging"
  | "testing"
  | "coverage"
  | "analysis"
  | "sonarqube"
  | "todos"
  | "agents";

export const FEATURES: {
  id: Feature;
  name: string;
  description: string;
  /** Works only while this one is on. */
  needs?: Feature;
}[] = [
  {
    id: "languageServer",
    name: "Language Server (clangd)",
    description:
      "Completion, diagnostics, navigation, rename and formatting for C and C++.",
  },
  {
    id: "sourceControl",
    name: "Source Control (Git)",
    description:
      "The Source Control view, the branch in the status bar and file states in the Explorer.",
  },
  {
    id: "cmake",
    name: "CMake",
    description:
      "Kits, presets, configure, build and run from the status bar and the palette.",
  },
  {
    id: "debugging",
    name: "Run and Debug",
    description: "The debugger (GDB, LLDB), breakpoints and the Debug Console.",
    needs: "cmake",
  },
  {
    id: "testing",
    name: "Testing (CTest)",
    description: "The Testing view: lists and runs the build folder's tests.",
    needs: "cmake",
  },
  {
    id: "coverage",
    name: "Coverage",
    description: "The Coverage view for an LCOV or Cobertura report.",
  },
  {
    id: "analysis",
    name: "Code Analysis (clang-tidy)",
    description: "clang-tidy runs on a file or the project, with fix previews.",
  },
  {
    id: "sonarqube",
    name: "SonarQube",
    description:
      "The SonarQube view: issues and Quality Gate of the analysis CI made, read from your server on Refresh.",
  },
  {
    id: "todos",
    name: "TODOs",
    description: "The TODOs view of the project's TODO and FIXME comments.",
  },
  {
    id: "agents",
    name: "Coding Agents (Claude Code, Codex)",
    description:
      "Buttons and commands that run claude or codex in a terminal beside the code.",
  },
];
const IDS = new Set<string>(FEATURES.map((f) => f.id));

let off = new Set<Feature>();
let version = 0;
const listeners = new Set<() => void>();

/** The features the user turned off (from the preferences). */
export function setDisabledFeatures(list: readonly string[]) {
  const next = new Set(list.filter((id) => IDS.has(id)) as Feature[]);
  if (next.size === off.size && [...next].every((id) => off.has(id))) return;
  off = next;
  version++;
  // For CSS: the breakpoint gutter hides with Run and Debug.
  document.documentElement.dataset.ideOff = FEATURES.filter(
    (f) => !enabled(f.id),
  )
    .map((f) => f.id)
    .join(" ");
  for (const listener of listeners) listener();
}
/** Whether a feature is on: itself and what it needs. */
export function enabled(feature: Feature): boolean {
  if (off.has(feature)) return false;
  const needs = FEATURES.find((f) => f.id === feature)?.needs;
  return !needs || enabled(needs);
}
export function onFeatures(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/** Re-renders when a feature is turned on or off; returns `enabled`. */
export function useFeatures() {
  useSyncExternalStore(onFeatures, () => version);
  return enabled;
}
