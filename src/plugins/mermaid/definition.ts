import type { PluginDefinition } from "../contract";
import {
  diagramFiles,
  dirty as diagramDirty,
  disposeDiagram,
} from "./diagrams";

export const mermaid: PluginDefinition = {
  id: "mermaid",
  name: "Mermaid",
  minimum: { width: 320, height: 240 },
  create: () => diagramFiles.create(),
  loadView: () => import("./Diagram"),
  title: (id) => diagramFiles.get(id).name,
  modified: (id) => diagramDirty(diagramFiles.get(id)),
  subscribe: diagramFiles.subscribe,
  beforeClose: (id) => !diagramDirty(diagramFiles.get(id)),
  save: (id) => diagramFiles.save(id),
  restore: diagramFiles.restoreSession,
  settle: diagramFiles.settle,
  dispose: disposeDiagram,
};
