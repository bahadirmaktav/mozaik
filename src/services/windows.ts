import { native } from "./native";

/** Typed adapter for Mozaik's windows (`lib.rs`); browser tests replace it. */
export const windowBackend = {
  /** A new, empty window; with `ide`, it opens an IDE on that folder. */
  open: (ide: string | null = null) => native<void>("new_workspace", { ide }),
  /** The folder this window was opened for, once (null on a reload or a plain window). */
  takeStart: () => native<string | null>("take_window_start"),
};
