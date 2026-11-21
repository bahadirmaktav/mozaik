import type { PluginDefinition } from "../contract";
import {
  claimPanel,
  createInstance as createTasks,
  disposeInstance as disposeTasks,
  hasDrafts,
  saveAll,
  subscribe as subscribeTasks,
} from "./store";

export const tasks: PluginDefinition = {
  id: "tasks",
  name: "Tasks",
  minimum: { width: 260, height: 200 },
  create: createTasks,
  loadView: () => import("./Tasks"),
  title: () => "Tasks",
  modified: hasDrafts,
  subscribe: subscribeTasks,
  beforeClose: () => !hasDrafts(),
  save: saveAll,
  claim: claimPanel,
  dispose: disposeTasks,
};
