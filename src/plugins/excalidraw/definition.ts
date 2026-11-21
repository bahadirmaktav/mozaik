import type { PluginDefinition } from "../contract";
import {
  createDrawing,
  dirty as drawingDirty,
  disposeDrawing,
  flushDrawing,
  getDrawing,
  restoreSession,
  saveDrawing,
  settleDrawing,
  subscribe as subscribeDrawings,
} from "./drawings";

export const excalidraw: PluginDefinition = {
  id: "excalidraw",
  name: "Excalidraw",
  minimum: { width: 320, height: 240 },
  create: () => createDrawing(),
  loadView: () => import("./Drawing"),
  title: (id) => getDrawing(id).name,
  modified: (id) => drawingDirty(getDrawing(id)),
  subscribe: subscribeDrawings,
  beforeClose: (id) => {
    flushDrawing(id);
    return !drawingDirty(getDrawing(id));
  },
  save: (id) => saveDrawing(id),
  restore: restoreSession,
  settle: settleDrawing,
  dispose: disposeDrawing,
};
