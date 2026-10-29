import { invoke, isTauri } from "@tauri-apps/api/core";
import { native, type FileData } from "./native";

export type OpenOutcome =
  | { kind: "opened"; file: FileData }
  /** Already open in another window, which was focused instead. */
  | { kind: "elsewhere" };
export type SaveOutcome =
  | { kind: "saved"; file: FileData }
  | { kind: "cancelled" }
  | { kind: "conflict"; message: string };
export interface SaveRequest {
  /** `null` asks for a destination (Save As). */
  path: string | null;
  current: string | null;
  text: string;
  revision: string | null;
  bom: boolean;
  ending: "lf" | "crlf" | "mixed";
  name: string;
}
export type ExportExtension = "png" | "svg" | "excalidrawlib";

/** Rust validates and writes every drawing file. Mutable so browser tests can substitute it. */
export const drawingsBackend = {
  /** `null` path shows the open dialog; `null` result means it was cancelled. */
  open: (path: string | null) =>
    native<OpenOutcome | null>("drawings_open", { path }),
  save: (request: SaveRequest) =>
    native<SaveOutcome>("drawings_save", { request }),
  /** Unchanged since `revision`: `null`; otherwise the current disk version. */
  check: (path: string, revision: string | null) =>
    native<FileData | null>("check_file", { path, revision }),
  read: (path: string) => native<FileData>("read_file", { path }),
  setOpen: (paths: string[]) => native<void>("drawings_set_open", { paths }),
  takePending: () => native<string[]>("drawings_take_pending"),
  closeWindow: () => native<void>("drawings_close_window"),
  /** Resolves with the written path, or `null` when the dialog was cancelled. */
  async export(data: Blob, name: string, extension: ExportExtension) {
    if (!isTauri())
      throw new Error("This action requires the Tessera desktop app.");
    return invoke<string | null>(
      "drawings_export",
      new Uint8Array(await data.arrayBuffer()),
      {
        headers: {
          "x-tessera-name": encodeURIComponent(name),
          "x-tessera-extension": extension,
        },
      },
    );
  },
  readImage: (path: string) =>
    native<ArrayBuffer>("drawings_read_image", { path }),
};
