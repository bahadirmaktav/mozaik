import type { PluginDefinition } from "../contract";
import {
  createInstance,
  disposeInstance,
  subscribe as subscribeFileManagers,
  title as fileManagerTitle,
} from "./instances";

export const fileManager: PluginDefinition = {
  id: "file-manager",
  name: "File Manager",
  minimum: { width: 320, height: 180 },
  create: () => createInstance(),
  loadView: () => import("./FileManager"),
  title: fileManagerTitle,
  modified: () => false,
  subscribe: subscribeFileManagers,
  beforeClose: () => true,
  dispose: disposeInstance,
};
