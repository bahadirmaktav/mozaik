import { native } from "./native";

/** What a window opens at start: an IDE on a folder, or a text file (`mozaik -t`). */
export interface WindowStart {
  kind: "ide" | "text";
  path: string;
}
/** `mozaik -t <file>` run in one of this window's terminals (`requests.rs`). */
export interface TextRequest {
  terminal: string;
  path: string;
}

/** Typed adapter for Mozaik's windows (`lib.rs`); browser tests replace it. */
export const windowBackend = {
  /** A new, empty window; with `ide`, it opens an IDE on that folder. */
  open: (ide: string | null = null) => native<void>("new_workspace", { ide }),
  /** What this window was opened for, once (null on a plain window). */
  takeStart: () => native<WindowStart | null>("take_window_start"),
  /** Ends what this window started before its page reloads; with `ide`, the reloaded page
   * opens an IDE on that folder. */
  prepareReload: (ide: string | null) => native<void>("reload_window", { ide }),
};
