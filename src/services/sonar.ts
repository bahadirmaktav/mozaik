import { native } from "./native";

/** The server and project an IDE project reads its SonarQube analysis from. */
export interface SonarBinding {
  url: string;
  projectKey: string;
}
/**
 * What the project's `sonar-project.properties` says (Mozaik never writes it). A token in
 * the file is never read, only noticed.
 */
export interface SonarProperties {
  file: string | null;
  hostUrl: string | null;
  projectKey: string | null;
  /** `sonar.projectBaseDir` inside the project, the folder issue paths are relative to. */
  baseDir: string | null;
  hasToken: boolean;
}
export interface SonarInfo {
  binding: SonarBinding | null;
  /** A token for the server is in the system's credential store. */
  hasToken: boolean;
  /** The server's address is `http://`. */
  insecure: boolean;
  properties: SonarProperties;
}
/** The analysis shown: a pull (merge) request, a branch or the main branch. */
export type SonarTarget =
  | {
      kind: "pullRequest";
      key: string;
      title: string;
      branch: string;
      url: string | null;
    }
  | { kind: "branch"; name: string }
  | { kind: "main"; name: string | null };
/** Lines from 1; offsets in UTF-16 code units. */
export interface SonarRange {
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
}
export interface SonarIssue {
  key: string;
  rule: string;
  /** 1 error, 2 warning, 3 information. */
  severity: 1 | 2 | 3;
  /** SonarQube's own severity. */
  level: string;
  kind: string | null;
  message: string;
  /** The local file; null when it cannot be placed in the project. */
  path: string | null;
  relative: string;
  /** Null for an issue on a whole file. */
  range: SonarRange | null;
  effort: string | null;
  created: string | null;
}
export interface QualityGate {
  /** `OK`, `WARN`, `ERROR` or `NONE`. */
  status: string;
  failing: {
    metric: string;
    comparator: string | null;
    threshold: string | null;
    actual: string | null;
  }[];
}
export interface SonarFetched {
  target: SonarTarget;
  /** The commit the analysis read, when the server reports it. */
  revision: string | null;
  analysisDate: string | null;
  qualityGate: QualityGate | null;
  issues: SonarIssue[];
  total: number;
  truncated: boolean;
  skipped: number;
  /** The requests made, for Output → SonarQube. */
  log: string[];
}

/**
 * Typed adapter for the SonarQube commands (`sonar.rs`) and the Git reads that match an
 * analysis to the working tree. Mutable, so browser tests can stand in for the server.
 */
export const sonarBackend = {
  info: (root: string) => native<SonarInfo>("sonar_info", { root }),
  /** Without a token the one kept for that server is used. */
  connect: (
    root: string,
    url: string,
    projectKey: string,
    token: string | null,
  ) => native<SonarInfo>("sonar_connect", { root, url, projectKey, token }),
  disconnect: (root: string) => native<SonarInfo>("sonar_disconnect", { root }),
  fetch: (root: string, branch: string | null, mainOnly: boolean) =>
    native<SonarFetched>("sonar_fetch", { root, branch, mainOnly }),
  hasCommit: (root: string, revision: string) =>
    native<boolean>("git_has_commit", { root, revision }),
  revisionText: (path: string, revision: string) =>
    native<string | null>("git_revision_text", { path, revision }),
  changedSince: (root: string, revision: string) =>
    native<string[]>("git_changed_since", { root, revision }),
};
