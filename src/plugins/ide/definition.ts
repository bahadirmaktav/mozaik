import type { PluginDefinition } from "../contract";
import {
  createDocument,
  dirty,
  disposeDocument,
  getDocument,
  hasDocument,
  subscribe,
} from "../../documents/documents";
import {
  allProjects,
  createProject,
  disposeProject,
  getProject,
  subscribe as subscribeProjects,
  title as projectTitle,
} from "./projects";
import { closeProject as closeDebugging } from "./debug";
import { disposeTodos } from "./todos";
import { disposeAnalysis } from "./analysis";
import { disposeSonar } from "./sonar";
import {
  coverageTitle,
  createCoverageTab,
  disposeCoverage,
  disposeCoverageTab,
  subscribe as subscribeCoverage,
} from "./coverage";
import {
  createPanel,
  createStatus,
  disposePanel,
  disposeStatus,
  subscribe as subscribePanels,
} from "./panels";
import {
  createDiff,
  diffDocument,
  diffTitle,
  disposeDiff,
  subscribe as subscribeDiffs,
  usedByDiff,
} from "./diffs";
import { forgetEmptyArea, host } from "./editors";
import { disposeCodeView, viewDocument, viewsOfDocument } from "./codeViews";
import {
  disposeFileTab,
  fileTabTitle,
  subscribe as subscribeFileTabs,
} from "./fileTabs";
import {
  agentTitle,
  disposeAgentPanel,
  disposeAgentsOf,
  subscribe as subscribeAgents,
} from "./agents";

/** The IDE is several panels in the ordinary workspace: a docked project sidebar (explorer,
 * search, source control, outline), code editors over the shared text documents, a docked
 * bottom panel (Problems, terminal), a status bar and change views. Only the sidebar is in
 * the launcher; App opens the rest with it and code tabs from it. */
export const ideProject: PluginDefinition = {
  id: "ide",
  name: "IDE",
  minimum: { width: 260, height: 200 },
  create: createProject,
  loadView: () => import("./Project"),
  title: projectTitle,
  modified: () => false,
  subscribe: subscribeProjects,
  beforeClose: () => true,
  // The activity bar (40px) and the panel border stay when it is minimized.
  dock: { axis: "x", size: 42 },
  dispose(id) {
    const root = getProject(id)?.root;
    // Closing the IDE ends its debug session.
    closeDebugging(id);
    disposeTodos(id);
    disposeCoverage(id);
    disposeAnalysis(id);
    disposeSonar(id);
    disposeProject(id);
    disposeAgentsOf(id);
    // A language server lives as long as some panel shows its project.
    if (root && !allProjects().some((p) => p.root === root))
      void import("./lsp").then((lsp) => lsp.restart(root));
  },
};
export const codeEditor: PluginDefinition = {
  id: "code",
  name: "Code Editor",
  minimum: { width: 260, height: 160 },
  create: () => createDocument(),
  loadView: () => import("./CodeEditor"),
  title: (id) => getDocument(id).name,
  modified: (id) => dirty(getDocument(id)),
  subscribe,
  beforeClose: (id) => !dirty(getDocument(id)),
  dispose(id) {
    const path = hasDocument(id) ? getDocument(id).path : null;
    forgetEmptyArea(id);
    viewsOfDocument(id).forEach(disposeCodeView);
    disposeDocument(id);
    if (path) void import("./lsp").then((lsp) => lsp.forgetDocument(path));
  },
  listed: false,
};
/**
 * Another view of a code document, as in VS Code's split editors. The document stays open
 * with its own tab, which asks about unsaved changes, so this one closes without asking.
 */
export const codeView: PluginDefinition = {
  id: "code-view",
  name: "Code Editor",
  minimum: { width: 260, height: 160 },
  create() {
    throw new Error("A code view is created from its document");
  },
  loadView: () => import("./CodeEditor"),
  title(id) {
    const doc = viewDocument(id);
    return doc && hasDocument(doc) ? getDocument(doc).name : "Code Editor";
  },
  modified(id) {
    const doc = viewDocument(id);
    return !!doc && hasDocument(doc) && dirty(getDocument(doc));
  },
  subscribe,
  beforeClose: () => true,
  dispose: disposeCodeView,
  listed: false,
};
/** A file that is not text among the code editors: an image, or a note about the file. */
export const fileTab: PluginDefinition = {
  id: "file-tab",
  name: "File",
  minimum: { width: 260, height: 160 },
  create() {
    throw new Error("A file tab is created from its path");
  },
  loadView: () => import("./FileTab"),
  title: fileTabTitle,
  modified: () => false,
  subscribe: subscribeFileTabs,
  beforeClose: () => true,
  dispose: disposeFileTab,
  listed: false,
};
/** The coding agents' terminals beside the code editors; App creates it with its project. */
export const ideAgent: PluginDefinition = {
  id: "ide-agent",
  name: "Coding Agent",
  minimum: { width: 280, height: 160 },
  create() {
    throw new Error("An agent panel is created from its project");
  },
  loadView: () => import("./AgentPanel"),
  title: agentTitle,
  modified: () => false,
  subscribe: subscribeAgents,
  beforeClose: () => true,
  dispose: disposeAgentPanel,
  listed: false,
  // Alone in its panel with its own bar. Minimized it leaves the layout, so it is never a bar.
  dock: { axis: "x", size: 34 },
};
export const idePanel: PluginDefinition = {
  id: "ide-panel",
  name: "IDE Panel",
  minimum: { width: 260, height: 120 },
  // App creates it with its project; a panel without one shows every problem.
  create: () => createPanel(""),
  loadView: () => import("./Panel"),
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
  loadView: () => import("./Status"),
  title: () => "Status Bar",
  modified: () => false,
  subscribe: subscribePanels,
  beforeClose: () => true,
  dispose: disposeStatus,
  listed: false,
  dock: { axis: "y", size: 26, fixed: true },
};
/** The document a comparison edits; its own edits open it in a code tab, which saves it. */
const diffEdits = (id: string) => {
  const doc = diffDocument(id);
  return doc && hasDocument(doc) ? getDocument(doc) : null;
};
export const diff: PluginDefinition = {
  id: "diff",
  name: "Changes",
  minimum: { width: 320, height: 160 },
  create: () => createDiff(),
  loadView: () => import("./Diff"),
  title: diffTitle,
  modified(id) {
    const doc = diffEdits(id);
    return !!doc && dirty(doc);
  },
  subscribe(listener) {
    const unsubscribe = [subscribeDiffs(listener), subscribe(listener)];
    return () => unsubscribe.forEach((fn) => fn());
  },
  // Unsaved edits belong to the file's code tab, which asks when it closes.
  beforeClose: () => true,
  dispose(id) {
    const doc = diffDocument(id);
    disposeDiff(id);
    // A document read only for the comparison goes with it.
    if (
      doc &&
      hasDocument(doc) &&
      !dirty(getDocument(doc)) &&
      !usedByDiff(doc) &&
      !host().shows(doc)
    )
      codeEditor.dispose(doc);
  },
  listed: false,
};
/** One file of an IDE project's coverage report, read only, among the code editors. */
export const coverage: PluginDefinition = {
  id: "coverage",
  name: "Coverage",
  minimum: { width: 320, height: 160 },
  create: () => createCoverageTab(),
  loadView: () => import("./CoverageFile"),
  title: coverageTitle,
  modified: () => false,
  subscribe: subscribeCoverage,
  beforeClose: () => true,
  dispose: disposeCoverageTab,
  listed: false,
};
