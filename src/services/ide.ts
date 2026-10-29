import { Channel, isTauri } from "@tauri-apps/api/core";
import { native, type FileData } from "./native";

export interface ProjectSettings {
  formatOnSave: boolean;
  tabSize: number;
  insertSpaces: boolean;
  /** Gitignore-style patterns left out of quick open and project search. */
  exclude: string[];
}
export const defaultSettings: ProjectSettings = {
  formatOnSave: false,
  tabSize: 4,
  insertSpaces: true,
  exclude: [],
};
export interface OpenedProject {
  root: string;
  name: string;
  settings: ProjectSettings;
}
export interface SearchQuery {
  text: string;
  regex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
}
/** Columns and lengths are UTF-16 code units, like editor offsets; lines start at 1. */
export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  preview: string;
  offset: number;
}
export interface FileMatches {
  path: string;
  relative: string;
  revision: string;
  matches: SearchMatch[];
}
export interface SearchResult {
  files: FileMatches[];
  truncated: boolean;
  skipped: number;
}
export interface Replaced {
  path: string;
  error: string | null;
  file: FileData | null;
}
export type GitState = "M" | "A" | "D" | "R" | "U" | "C";
export interface GitStatus {
  root: string;
  branch: string;
  changes: { path: string; status: GitState }[];
}
export interface ServerInfo {
  id: string;
  languages: string;
  path: string | null;
  configured: boolean;
}
export type LspEvent =
  | { kind: "message"; data: string }
  | { kind: "exit"; code: number | null; log: string };

/**
 * Typed adapter for the native IDE commands. It is a mutable object so browser tests can
 * substitute a fake project, Git and language server; views must not call IPC directly.
 */
export const ideBackend = {
  /** `null` shows the folder picker. */
  open: (path: string | null) =>
    native<OpenedProject | null>("project_open", { path }),
  files: (root: string) =>
    native<{ files: string[]; truncated: boolean }>("project_files", { root }),
  search: (root: string, query: SearchQuery) =>
    native<SearchResult>("project_search", { root, query }),
  replaceText: (text: string, query: SearchQuery, replacement: string) =>
    native<string>("project_replace_text", { text, query, replacement }),
  replace: (
    root: string,
    query: SearchQuery,
    replacement: string,
    targets: { path: string; revision: string }[],
  ) =>
    native<Replaced[]>("project_replace", {
      root,
      query,
      replacement,
      targets,
    }),
  setSettings: (root: string, settings: ProjectSettings) =>
    native<ProjectSettings>("project_set_settings", { root, settings }),
  read: (path: string) => native<FileData>("read_file", { path }),
  save: (request: {
    path: string;
    text: string;
    revision: string;
    bom: boolean;
    ending: string;
    name: string;
  }) => native<FileData>("save_file", { request }),
  gitStatus: (root: string) => native<GitStatus | null>("git_status", { root }),
  headText: (path: string) => native<string | null>("git_head_text", { path }),
  servers: () => native<ServerInfo[]>("lsp_servers"),
  chooseServer: (server: string) =>
    native<ServerInfo | null>("lsp_choose_server", { server }),
  resetServer: (server: string) =>
    native<ServerInfo>("lsp_reset_server", { server }),
  lspStart(
    id: string,
    server: string,
    root: string,
    onEvent: (event: LspEvent) => void,
  ) {
    if (!isTauri()) return native<string>("lsp_start");
    const events = new Channel<LspEvent>();
    events.onmessage = onEvent;
    return native<string>("lsp_start", { id, server, root, events });
  },
  lspSend: (id: string, message: string) =>
    native<void>("lsp_send", { id, message }),
  lspStop: (id: string) => native<void>("lsp_stop", { id }),
};
