import { createBoundFiles, type BoundFile } from "../shared/boundFiles";

export type Drawing = BoundFile;
export { content, dirty, untitledName } from "../shared/boundFiles";

const EMPTY = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "mozaik",
  elements: [],
  appState: {},
  files: {},
});
export const drawingFiles = createBoundFiles({
  kind: "excalidraw",
  extensions: ["excalidraw"],
  empty: EMPTY,
  noun: "drawing",
});
const d = drawingFiles;
export const subscribe = d.subscribe;
export const allDrawings = d.all;
export const hasDrawing = d.has;
export const getDrawing = d.get;
export const baseName = d.baseName;
export const createDrawing = d.create;
export const updateDrawing = d.update;
export const disposeDrawing = d.dispose;
export const useDrawings = d.useAll;
export const useDrawing = d.useOne;
export const registerRuntime = d.registerRuntime;
export const flushDrawing = d.flush;
/** Called by the live scene with its newly serialized contents. */
export const setScene = d.setText;
export const saveDrawing = d.save;
export const settleDrawing = d.settle;
/** Opens a drawing file, or returns the drawing that already shows it. `null` when the dialog
 * was cancelled or another window shows the file. */
export const openDrawingFile = d.openFile;
export const findByPath = d.findByPath;
/** The previous session's drawings, reopened the first time Excalidraw is opened. */
export const restoreSession = d.restoreSession;
/** Applies a newer disk version to a clean drawing, or marks the drawing as conflicting. */
export const checkDrawing = d.check;
export const reloadDrawing = d.reload;
/** The workspace opens drawings for the File Manager and the Excalidraw menu. */
export const setOpener = d.setOpener;
export const requestOpen = d.requestOpen;
export const onError = d.onError;
export const reportError = d.reportError;
export const isDrawingPath = d.isPath;
const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["jfif", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["svg", "image/svg+xml"],
  ["bmp", "image/bmp"],
  ["ico", "image/x-icon"],
  ["avif", "image/avif"],
]);
/** The MIME type of an image Excalidraw accepts, from its extension. */
export const imageType = (path: string) =>
  IMAGE_TYPES.get(/\.([^.\\/]+)$/.exec(path)?.[1].toLowerCase() ?? "");
