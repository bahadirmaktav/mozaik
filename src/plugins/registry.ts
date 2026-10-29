import type { PluginDefinition } from "./contract";
import {
  createDocument,
  dirty,
  disposeDocument,
  getDocument,
  hasDocument,
  subscribe,
} from "./text-editor/documents";
import {
  allProjects,
  createProject,
  disposeProject,
  getProject,
  subscribe as subscribeProjects,
  title as projectTitle,
} from "./ide/projects";
import {
  createPanel,
  createStatus,
  disposePanel,
  disposeStatus,
  subscribe as subscribePanels,
} from "./ide/panels";
import {
  createDiff,
  diffTitle,
  disposeDiff,
  subscribe as subscribeDiffs,
} from "./ide/diffs";
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
  claimPanel as claimNotes,
  createInstance as createNotes,
  disposeInstance as disposeNotes,
  hasDrafts as hasNoteDrafts,
  saveAll as saveNotes,
  settle as settleNotes,
  subscribe as subscribeNotes,
} from "./notes/store";
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
export const notesPlugin: PluginDefinition = {
  id: "notes",
  name: "Notes",
  minimum: { width: 260, height: 200 },
  create: createNotes,
  loadView: () => import("./notes/Notes"),
  title: () => "Notes",
  modified: hasNoteDrafts,
  subscribe: subscribeNotes,
  beforeClose: () => !hasNoteDrafts(),
  save: saveNotes,
  claim: claimNotes,
  settle: settleNotes,
  dispose: disposeNotes,
};
/** The IDE is several panels in the ordinary workspace: a docked project sidebar (explorer,
 * search, source control, outline), code editors over the shared text documents, a docked
 * bottom panel (Problems, terminal), a status bar and change views. Only the sidebar is in
 * the launcher; App opens the rest with it and code tabs from it. */
export const ideProject: PluginDefinition = {
  id: "ide",
  name: "IDE",
  minimum: { width: 260, height: 200 },
  create: createProject,
  loadView: () => import("./ide/Project"),
  title: projectTitle,
  modified: () => false,
  subscribe: subscribeProjects,
  beforeClose: () => true,
  // The activity bar (40px) and the panel border stay when it is minimized.
  dock: { axis: "x", size: 42 },
  dispose(id) {
    const root = getProject(id)?.root;
    disposeProject(id);
    // A language server lives as long as some panel shows its project.
    if (root && !allProjects().some((p) => p.root === root))
      void import("./ide/lsp").then((lsp) => lsp.restart(root));
  },
};
export const codeEditor: PluginDefinition = {
  id: "code",
  name: "Code Editor",
  minimum: { width: 260, height: 160 },
  create: () => createDocument(),
  loadView: () => import("./ide/CodeEditor"),
  title: (id) => getDocument(id).name,
  modified: (id) => dirty(getDocument(id)),
  subscribe,
  beforeClose: (id) => !dirty(getDocument(id)),
  dispose(id) {
    const path = hasDocument(id) ? getDocument(id).path : null;
    disposeDocument(id);
    if (path) void import("./ide/lsp").then((lsp) => lsp.forgetDocument(path));
  },
  listed: false,
};
export const idePanel: PluginDefinition = {
  id: "ide-panel",
  name: "IDE Panel",
  minimum: { width: 260, height: 120 },
  // App creates it with its project; a panel without one shows every problem.
  create: () => createPanel(""),
  loadView: () => import("./ide/Panel"),
  title: () => "Panel",
  modified: () => false,
  subscribe: subscribePanels,
  beforeClose: () => true,
  dispose: disposePanel,
  listed: false,
  // Its 30px bar of views stays when it is minimized.
  dock: { axis: "y", size: 32 },
};
export const ideStatus: PluginDefinition = {
  id: "ide-status",
  name: "IDE Status Bar",
  minimum: { width: 200, height: 26 },
  create: () => createStatus(""),
  loadView: () => import("./ide/Status"),
  title: () => "Status Bar",
  modified: () => false,
  subscribe: subscribePanels,
  beforeClose: () => true,
  dispose: disposeStatus,
  listed: false,
  dock: { axis: "y", size: 26, fixed: true },
};
export const diff: PluginDefinition = {
  id: "diff",
  name: "Changes",
  minimum: { width: 320, height: 160 },
  create: () => createDiff(),
  loadView: () => import("./ide/Diff"),
  title: diffTitle,
  modified: () => false,
  subscribe: subscribeDiffs,
  beforeClose: () => true,
  dispose: disposeDiff,
  listed: false,
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
  [notesPlugin.id, notesPlugin],
  [ideProject.id, ideProject],
  [codeEditor.id, codeEditor],
  [idePanel.id, idePanel],
  [ideStatus.id, ideStatus],
  [diff.id, diff],
]);
export const pluginLimits = Object.fromEntries(
  [...registry].map(([id, plugin]) => [
    id,
    { ...plugin.minimum, dock: plugin.dock },
  ]),
);
