import { native } from "./native";

/** A coverage report file the user chose for a project, as read by Rust. */
export interface ReportFile {
  path: string;
  text: string;
  /** Milliseconds since the Unix epoch. */
  modified: number | null;
}

/**
 * Typed adapter for the native coverage commands. A mutable object so browser tests can
 * substitute a fake. The report path is only ever chosen in Rust's native dialog.
 */
export const coverageBackend = {
  /** Asks for a report in a native dialog; `null` when cancelled. */
  choose: (root: string) =>
    native<ReportFile | null>("coverage_choose", { root }),
  /** The project's chosen report, read again; `null` when none was chosen. */
  report: (root: string) =>
    native<ReportFile | null>("coverage_report", { root }),
  forget: (root: string) => native<void>("coverage_forget", { root }),
  /** Last change of each file, `null` for missing ones. */
  modified: (paths: string[]) =>
    native<(number | null)[]>("coverage_modified", { paths }),
};
