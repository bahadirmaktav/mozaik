import type { PluginDefinition } from "../contract";
import {
  createSession,
  disposeSession,
  renameSession,
  sessionTitle,
  subscribe as subscribeSessions,
} from "../../terminal-core/sessions";

export const terminal: PluginDefinition = {
  id: "terminal",
  name: "Terminal",
  minimum: { width: 260, height: 120 },
  create: createSession,
  loadView: () => import("../../terminal-core/Terminal"),
  title: sessionTitle,
  modified: () => false,
  subscribe: subscribeSessions,
  beforeClose: () => true,
  rename: renameSession,
  dispose: disposeSession,
};
