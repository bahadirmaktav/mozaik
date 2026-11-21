import type { PluginDefinition } from "../contract";
import {
  claimPanel as claimNotes,
  createInstance as createNotes,
  disposeInstance as disposeNotes,
  hasDrafts as hasNoteDrafts,
  saveAll as saveNotes,
  settle as settleNotes,
  subscribe as subscribeNotes,
} from "./store";

export const notesPlugin: PluginDefinition = {
  id: "notes",
  name: "Notes",
  minimum: { width: 260, height: 200 },
  create: createNotes,
  loadView: () => import("./Notes"),
  title: () => "Notes",
  modified: hasNoteDrafts,
  subscribe: subscribeNotes,
  beforeClose: () => !hasNoteDrafts(),
  save: saveNotes,
  claim: claimNotes,
  settle: settleNotes,
  dispose: disposeNotes,
};
