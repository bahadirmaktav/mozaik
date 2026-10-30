// Replaces `browser-fs-access` for Excalidraw (see vite.config.ts). Excalidraw's own file saves
// (image export, library export) go to a native save dialog in Rust instead of a browser
// download. It imports nothing from Mozaik: the dependency pre-bundle would get its own copy.
import { fileOpen as browserFileOpen } from "mozaik-browser-fs-access";

type Options = { fileName?: string; extensions?: string[] };
export type NativeSave = (data: Blob, name: string) => Promise<boolean>;
const key = Symbol.for("mozaik.excalidraw.save");

// No file handles: Excalidraw never writes back to a file it was not given by Mozaik.
export const supported = false;
export const fileOpen = browserFileOpen;
export async function fileSave(
  blob: Blob | Promise<Blob>,
  options?: Options | Options[],
) {
  const option = Array.isArray(options) ? options[0] : options;
  const save = (globalThis as Record<symbol, NativeSave | undefined>)[key];
  if (!save) throw new Error("Saving files requires the Mozaik desktop app.");
  if (!(await save(await blob, option?.fileName ?? "Untitled")))
    throw new DOMException("The user aborted a request.", "AbortError");
  return null;
}
export function setNativeSave(save: NativeSave) {
  (globalThis as Record<symbol, NativeSave | undefined>)[key] = save;
}
