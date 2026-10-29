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
export const registry = new Map([
  [textEditor.id, textEditor],
  [terminal.id, terminal],
]);
export const pluginLimits = Object.fromEntries(
  [...registry].map(([id, plugin]) => [id, plugin.minimum]),
);
