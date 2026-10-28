import type { PluginDefinition } from "./contract";
import {
  createDocument,
  dirty,
  disposeDocument,
  getDocument,
} from "./text-editor/documents";

export const textEditor: PluginDefinition = {
  id: "text-editor",
  name: "Text Editor",
  minimum: { width: 260, height: 160 },
  create: () => createDocument(),
  loadView: () => import("./text-editor/Editor"),
  beforeClose: (id) => !dirty(getDocument(id)),
  dispose: disposeDocument,
};
export const registry = new Map([[textEditor.id, textEditor]]);
export const pluginLimits = Object.fromEntries(
  [...registry].map(([id, plugin]) => [id, plugin.minimum]),
);
