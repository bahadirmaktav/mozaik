import type { PluginDefinition } from "./contract";
import {
  createDocument,
  dirty,
  disposeDocument,
  getDocument,
  subscribe,
} from "./text-editor/documents";
import {
  createSession,
  disposeSession,
  sessionTitle,
  subscribe as subscribeSessions,
} from "./terminal/sessions";
import {
  createInstance,
  disposeInstance,
  subscribe as subscribeFileManagers,
  title as fileManagerTitle,
} from "./file-manager/instances";
import {
  claimPanel,
  createInstance as createTasks,
  disposeInstance as disposeTasks,
  hasDrafts,
  saveAll,
  subscribe as subscribeTasks,
} from "./tasks/store";
import {
  createDrawing,
  dirty as drawingDirty,
  disposeDrawing,
  drawingFiles,
  flushDrawing,
  getDrawing,
  restoreSession,
  saveDrawing,
  settleDrawing,
  subscribe as subscribeDrawings,
} from "./excalidraw/drawings";
import {
  diagramFiles,
  dirty as diagramDirty,
  disposeDiagram,
} from "./mermaid/diagrams";

export const textEditor: PluginDefinition = {
  id: "text-editor",
  name: "Text Editor",
  minimum: { width: 260, height: 160 },
  create: () => createDocument(),
  loadView: () => import("./text-editor/Editor"),
  title: (id) => getDocument(id).name,
  modified: (id) => dirty(getDocument(id)),
  subscribe,
  beforeClose: (id) => !dirty(getDocument(id)),
  dispose: disposeDocument,
};
export const terminal: PluginDefinition = {
  id: "terminal",
  name: "Terminal",
  minimum: { width: 260, height: 120 },
  create: createSession,
  loadView: () => import("./terminal/Terminal"),
  title: sessionTitle,
  modified: () => false,
  subscribe: subscribeSessions,
  beforeClose: () => true,
  dispose: disposeSession,
};
export const fileManager: PluginDefinition = {
  id: "file-manager",
  name: "File Manager",
  minimum: { width: 320, height: 180 },
  create: createInstance,
  loadView: () => import("./file-manager/FileManager"),
  title: fileManagerTitle,
  modified: () => false,
  subscribe: subscribeFileManagers,
  beforeClose: () => true,
  dispose: disposeInstance,
};
export const tasks: PluginDefinition = {
  id: "tasks",
  name: "Tasks",
  minimum: { width: 260, height: 200 },
  create: createTasks,
  loadView: () => import("./tasks/Tasks"),
  title: () => "Tasks",
  modified: hasDrafts,
  subscribe: subscribeTasks,
  beforeClose: () => !hasDrafts(),
  save: saveAll,
  claim: claimPanel,
  dispose: disposeTasks,
};
export const excalidraw: PluginDefinition = {
  id: "excalidraw",
  name: "Excalidraw",
  minimum: { width: 320, height: 240 },
  create: () => createDrawing(),
  loadView: () => import("./excalidraw/Drawing"),
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
export const mermaid: PluginDefinition = {
  id: "mermaid",
  name: "Mermaid",
  minimum: { width: 320, height: 240 },
  create: () => diagramFiles.create(),
  loadView: () => import("./mermaid/Diagram"),
  title: (id) => diagramFiles.get(id).name,
  modified: (id) => diagramDirty(diagramFiles.get(id)),
  subscribe: diagramFiles.subscribe,
  beforeClose: (id) => !diagramDirty(diagramFiles.get(id)),
  save: (id) => diagramFiles.save(id),
  restore: diagramFiles.restoreSession,
  settle: diagramFiles.settle,
  dispose: disposeDiagram,
};
/** Modules whose items are files that save themselves once bound to a path. `snapshot` is
 * the recovery kind of their unsaved contents. */
export const fileModules = [
  { plugin: excalidraw, files: drawingFiles, snapshot: "drawing" },
  { plugin: mermaid, files: diagramFiles, snapshot: "mermaid" },
] as const;
export type FileModule = (typeof fileModules)[number];
export const registry = new Map([
  [textEditor.id, textEditor],
  [terminal.id, terminal],
  [fileManager.id, fileManager],
  [tasks.id, tasks],
  [excalidraw.id, excalidraw],
  [mermaid.id, mermaid],
]);
export const pluginLimits = Object.fromEntries(
  [...registry].map(([id, plugin]) => [id, plugin.minimum]),
);
