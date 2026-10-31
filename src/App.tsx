import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import {
  allPanels,
  apply,
  isFloating,
  emptyWorkspace,
  geometry,
  neighbor,
  type Action,
  type Panel as PanelNode,
} from "./workspace/model";
type OpenAction = Extract<Action, { type: "open" }>;
import { WorkspaceView } from "./workspace/WorkspaceView";
import {
  keysOf,
  label,
  matches,
  parse,
  setCustom,
  useKeybindings,
} from "./workspace/keybindings";
import {
  command,
  DEFAULT_MODIFIER,
  isModifierKey,
  modifierDown,
  modifierLabel,
  moveKeys,
  type Modifier,
} from "./workspace/shortcuts";
import { moduleCommands } from "./workspace/commands";
import {
  codeEditor,
  diff as diffPlugin,
  coverage as coveragePlugin,
  excalidraw,
  fileModules,
  ideProject,
  idePanel,
  ideStatus,
  pluginLimits,
  registry,
  textEditor,
  type FileModule,
} from "./plugins/registry";
import { imageType } from "./plugins/excalidraw/drawings";
import {
  dirty as boundDirty,
  type BoundFile,
} from "./plugins/shared/boundFiles";
import { drawingsBackend } from "./services/drawings";
import type { PluginDefinition } from "./plugins/contract";
import {
  allDocuments,
  createDocument,
  dirty,
  getDocument,
  hasDocument,
  updateDocument,
  useDocuments,
} from "./plugins/text-editor/documents";
import {
  beforeSave,
  checkExternal,
  native,
  openFile,
  saveDocument,
  type Recovery,
  type FileData,
} from "./services/native";
import { Dialog } from "./components/Dialog";
import { Launcher, type AddMode } from "./components/Launcher";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Settings } from "./workspace/Settings";
import {
  defaultPreferences,
  preferencesBackend,
  type Preferences,
} from "./services/preferences";
import {
  current as currentCode,
  message,
  setHost,
  viewOf,
  type PickItem,
} from "./plugins/ide/editors";
import { commands as debugCommands } from "./plugins/ide/debug";
import { commands as testCommands } from "./plugins/ide/testing";
import { DebugToolbar } from "./plugins/ide/DebugConsole";
import { logMessage, type ChannelName } from "./plugins/ide/channels";
import { commands as cmakeCommands, noteProject } from "./plugins/ide/cmake";
import { useQuickModes } from "./plugins/ide/quick";
import type { PanelView } from "./plugins/ide/panels";
import { createDiff, diffDocument, diffFor } from "./plugins/ide/diffs";
import {
  commands as coverageCommands,
  coverageTabFor,
  createCoverageTab,
} from "./plugins/ide/coverage";
import { formatBeforeSave } from "./plugins/ide/save";
import { setTodoTags } from "./plugins/ide/todos";
import { setWordWrap } from "./plugins/text-editor/wrap";
import {
  createPanel,
  createStatus,
  getPanel,
  hasStatus,
  showView,
  statusProject,
} from "./plugins/ide/panels";
import {
  allProjects,
  getProject,
  openFolder,
  projectFor,
} from "./plugins/ide/projects";
import { ideBackend } from "./services/ide";
import "./App.css";

type Question = {
  title: string;
  message: string;
  choices: string[];
  resolve: (choice: string) => void;
};
const clockFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
/** The local date and time, updated at each minute. */
function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setTimeout(
      () => setNow(new Date()),
      60_000 - (now.getTime() % 60_000) + 50,
    );
    return () => clearTimeout(timer);
  }, [now]);
  return (
    <time
      className="status-clock"
      dateTime={now.toISOString()}
      data-tauri-drag-region
    >
      {clockFormat.format(now)}
    </time>
  );
}
export default function App() {
  const [workspace, setWorkspace] = useState(emptyWorkspace),
    state = useRef(workspace);
  const [bounds, setBounds] = useState({
    x: 0,
    y: 0,
    width: 1000,
    height: 700,
  });
  const area = useRef<HTMLDivElement>(null);
  const [control, setControl] = useState(false),
    [modifier, setModifier] = useState<Modifier>(DEFAULT_MODIFIER);
  const held = useRef(false),
    launcherReturn = useRef<Element | null>(null),
    lastCode = useRef<string | null>(null);
  const [launcher, setLauncher] = useState(false),
    // The palette's starting text: `>` commands, empty files, `@` symbols.
    [palette, setPalette] = useState<string | null>(null),
    [pick, setPick] = useState<{
      title: string;
      items: PickItem[];
      resolve: (id: string | null) => void;
    } | null>(null),
    [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState(""),
    [question, setQuestion] = useState<Question | null>(null);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const [preferences, setPreferences] = useState(defaultPreferences);
  // Menus and the palette show the current keys.
  useKeybindings();
  const snapshotQueue = useRef<Promise<unknown>>(Promise.resolve());
  const docs = useDocuments(),
    closing = useRef(false);
  // Drawings and diagrams; the hooks re-render on their changes.
  const boundItems = fileModules.map((m) => m.files.useAll());
  const focused = allPanels(workspace).find((p) => p.id === workspace.focused);
  // A comparison saves the document of its file, as in VS Code.
  const active = docs.find(
    (d) =>
      d.id === focused?.active ||
      (!!focused?.active && d.id === diffDocument(focused.active)),
  );
  const bound = fileModules
    .map((module) => ({
      module,
      item: module.files.all().find((d) => d.id === focused?.active),
    }))
    .find((b) => b.item) as { module: FileModule; item: BoundFile } | undefined;
  const latest = useRef({
    bounds,
    modifier,
    active,
    bound,
    tab: focused?.active,
  });
  latest.current = { bounds, modifier, active, bound, tab: focused?.active };
  const report = (error: unknown) =>
    setNotice(String(error).replace(/^Error: /, ""));
  /** `quiet` leaves a rejected layout change unreported, for optional IDE panels. */
  function dispatch(action: Action, quiet = false) {
    try {
      const next = apply(
        state.current,
        action,
        latest.current.bounds,
        pluginLimits,
      );
      state.current = next;
      setWorkspace(next);
      return true;
    } catch (error) {
      if (!quiet) report(error);
      return false;
    }
  }
  function release() {
    held.current = false;
    setControl(false);
  }
  function openLauncher() {
    launcherReturn.current = document.activeElement;
    setLauncher(true);
  }
  /** Cancelling returns focus to where it was, such as the editor or terminal. */
  function closeLauncher() {
    setLauncher(false);
    const previous = launcherReturn.current;
    launcherReturn.current = null;
    setTimeout(() => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    });
  }
  function openPalette(initial = ">") {
    if (document.querySelector("dialog[open]")) return;
    launcherReturn.current = document.activeElement;
    setPalette(initial);
  }
  /** Focus goes back first, so a command acts on the tool that had it. */
  function closePalette(then?: () => void) {
    setPalette(null);
    const previous = launcherReturn.current;
    launcherReturn.current = null;
    setTimeout(() => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
      then?.();
    });
  }
  /** A pick list in the palette; resolves with the chosen ID, or null. */
  function choose(title: string, items: PickItem[]) {
    pick?.resolve(null);
    launcherReturn.current = document.activeElement;
    return new Promise<string | null>((resolve) =>
      setPick({ title, items, resolve }),
    );
  }
  function closePick(id: string | null) {
    const resolve = pick?.resolve;
    setPick(null);
    const previous = launcherReturn.current;
    launcherReturn.current = null;
    setTimeout(() => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
      resolve?.(id);
    });
  }
  const keyLabel = (id: string) => label(keysOf(id), modifierLabel(modifier));
  // The palette: workspace actions, a command per module to add it, then the commands of the
  // modules in the workspace (the focused one first).
  const commands: Command[] = [
    {
      id: "launcher",
      label: "Add to Workspace…",
      shortcut: keyLabel("launcher"),
      run: openLauncher,
    },
    ...[...registry.values()]
      .filter((p) => p.listed !== false)
      .map((plugin) => ({
        id: `add:${plugin.id}`,
        label: `Add to Workspace: ${plugin.name}`,
        adds: true,
        run: (mode: AddMode = "auto") => void create(mode, plugin),
      })),
    {
      id: "new",
      label: "New Text Tab",
      shortcut: keyLabel("new"),
      run: () => void create("tab"),
    },
    {
      id: "open",
      label: "Open File…",
      shortcut: keyLabel("open"),
      run: () => void (bound ? openBound(bound.module) : open()),
    },
    {
      id: "save",
      label: "Save",
      shortcut: keyLabel("save"),
      run: () => saveFocused(false),
    },
    {
      id: "save-as",
      label: "Save As…",
      shortcut: keyLabel("save.as"),
      run: () => saveFocused(true),
    },
    {
      id: "close",
      label: "Close Tab",
      shortcut: keyLabel("close"),
      run: () => void (focused?.active && close([focused.active])),
    },
    {
      id: "module.close",
      label: "Close Panel",
      shortcut: keyLabel("module.close"),
      run: () => void closeModule(),
    },
    ...(focused && !pluginLimits[focused.tabs[0].plugin]?.dock
      ? [
          isFloating(workspace, focused.id)
            ? {
                id: "panel.dock",
                label: "Dock Panel",
                run: () =>
                  void dispatch({
                    type: "dock",
                    panelId: focused.id,
                    splitId: crypto.randomUUID(),
                  }),
              }
            : {
                id: "panel.float",
                label: "Float Panel",
                run: () =>
                  void dispatch({ type: "float", panelId: focused.id }),
              },
        ]
      : []),
    {
      id: "window.close",
      label: "Close Window",
      shortcut: keyLabel("window.close"),
      run: () => windowAction("close"),
    },
    {
      id: "window",
      label: "New Window",
      shortcut: keyLabel("window"),
      run: () => void native("new_workspace").catch(report),
    },
    {
      id: "settings",
      label: "Workspace Settings…",
      shortcut: keyLabel("settings"),
      run: () => setSettings(true),
    },
    ...(palette !== null && ideOpen()
      ? [
          {
            id: "view.terminal",
            label: "View: Toggle Terminal",
            shortcut: keyLabel("view.terminal"),
            run: toggleTerminal,
          },
        ]
      : []),
    ...(palette !== null ? moduleCommands() : []),
    ...(palette !== null ? cmakeCommands() : []),
    ...(palette !== null ? testCommands() : []),
    ...(palette !== null ? coverageCommands() : []),
    ...(palette !== null ? debugCommands(editorLine()) : []),
  ];
  const quickModes = useQuickModes(palette !== null);
  /** The focused code editor's file and cursor line, for Debug: Toggle Breakpoint. */
  function editorLine() {
    const id = currentCode();
    const view = id ? viewOf(id) : null;
    const path = id ? getDocument(id).path : null;
    return view && path
      ? {
          path,
          line: view.state.doc.lineAt(view.state.selection.main.head).number,
        }
      : null;
  }
  function saveFocused(as: boolean) {
    const { bound, active } = latest.current;
    if (bound) void bound.module.files.save(bound.item.id, as).catch(report);
    if (active) void save(active.id, as);
  }
  function ask(title: string, message: string, choices: string[]) {
    return new Promise<string>((resolve) =>
      setQuestion({ title, message, choices, resolve }),
    );
  }
  function answer(choice: string) {
    question?.resolve(choice);
    setQuestion(null);
  }
  function attach(
    id: string,
    mode: AddMode,
    plugin: PluginDefinition = textEditor,
  ) {
    const existing = allPanels(state.current).find((p) =>
      p.tabs.some((t) => t.id === id),
    );
    if (existing)
      return dispatch({ type: "activate", panelId: existing.id, tabId: id });
    return dispatch({
      type: "open",
      tab: { id, plugin: plugin.id },
      panelId: crypto.randomUUID(),
      splitId: crypto.randomUUID(),
      mode,
    });
  }
  const hidden = (id: string) =>
    !allPanels(state.current).some((p) => p.tabs.some((t) => t.id === id));
  async function create(mode: AddMode, plugin: PluginDefinition = textEditor) {
    setLauncher(false);
    // A single-panel plugin shown in another window focuses that window instead.
    if (plugin.claim && !(await plugin.claim().catch(report))) return;
    const restored = plugin.restore
      ? await plugin.restore().catch((e) => {
          report(e);
          return null;
        })
      : null;
    if (restored?.errors.length) report(restored.errors.join("\n"));
    if (restored?.ids.length) {
      const [first, ...rest] = restored.ids;
      if (!attach(first, mode, plugin)) {
        restored.ids.filter(hidden).forEach((id) => plugin.dispose(id));
        return;
      }
      for (const id of rest)
        if (!attach(id, "tab", plugin) && hidden(id)) plugin.dispose(id);
      return;
    }
    const id = plugin.create();
    if (!attach(id, mode, plugin)) return plugin.dispose(id);
    if (plugin === ideProject) openIde(id);
  }
  /**
   * The IDE opens as a whole around its sidebar: a status bar under all of it, an empty
   * code editor and the bottom panel under that. Parts without room are left out.
   */
  function openIde(project: string) {
    const sidebar = () => panelWith(project)!.id;
    const ids = () => ({
      panelId: crypto.randomUUID(),
      splitId: crypto.randomUUID(),
    });
    const status = createStatus(project);
    if (
      !openAt(sidebar(), {
        tab: { id: status, plugin: ideStatus.id },
        ...ids(),
        mode: "y",
        ratio: 0.95,
      })
    )
      ideStatus.dispose(status);
    const code = codeEditor.create();
    if (
      openAt(sidebar(), {
        tab: { id: code, plugin: codeEditor.id },
        ...ids(),
        mode: "x",
        ratio: sidebarRatio(sidebar()),
      })
    )
      openIdePanel(project, panelWith(code) ?? null);
    else {
      codeEditor.dispose(code);
      openIdePanel(project, null);
    }
    dispatch({ type: "activate", panelId: sidebar() });
    // The first IDE of a window continues with the folder opened last.
    if (allProjects().length === 1)
      void ideBackend
        .recent()
        .catch(() => null)
        .then((root) => {
          if (root && getProject(project)?.root === null)
            return openFolder(project, root);
        })
        .catch(report);
  }
  /** The open tabs of one project's IDE: sidebar, bottom panel and status bar. */
  function ideTabs(project: string) {
    return allPanels(state.current)
      .flatMap((p) => p.tabs)
      .filter(
        (t) =>
          t.id === project ||
          (t.plugin === idePanel.id && getPanel(t.id)?.project === project) ||
          (t.plugin === ideStatus.id && statusProject(t.id) === project),
      )
      .map((t) => t.id);
  }
  /** The project whose IDE part a tab is, if it is one. */
  function ideOf(id: string) {
    const plugin = pluginOf(id);
    return plugin === ideProject
      ? id
      : plugin === idePanel
        ? getPanel(id)?.project || null
        : plugin === ideStatus
          ? statusProject(id) || null
          : null;
  }
  /** The empty code editor an IDE opens with, still untouched. */
  function blank(id: string) {
    if (!hasDocument(id)) return false;
    const doc = getDocument(id);
    return !doc.path && !doc.text && !dirty(doc);
  }
  function windowAction(action: "maximize" | "close") {
    if (!isTauri()) return;
    const currentWindow = getCurrentWindow();
    const request =
      action === "maximize"
        ? currentWindow.toggleMaximize()
        : currentWindow.close();
    void request.catch(report);
  }
  /** Files opened while a code editor is focused open as code; otherwise as text. */
  async function open(path?: string) {
    try {
      const focusedPanel = allPanels(state.current).find(
        (p) => p.id === state.current.focused,
      );
      const plugin =
        focusedPanel?.tabs.find((t) => t.id === focusedPanel.active)?.plugin ===
        codeEditor.id
          ? codeEditor
          : textEditor;
      const id = await openFile(path);
      if (id && !attach(id, "tab", plugin) && hidden(id)) plugin.dispose(id);
    } catch (e) {
      report(e);
    }
  }
  const panelWith = (tabId: string) =>
    allPanels(state.current).find((p) => p.tabs.some((t) => t.id === tabId));
  const hasIde = () =>
    allPanels(state.current).some((p) =>
      p.tabs.some((t) => t.plugin === ideProject.id),
    );
  /** While an IDE is open its code editor area stays: its last, empty editor has no close. */
  const closable = (id: string, count: number) =>
    !(count === 1 && pluginOf(id) === codeEditor && blank(id) && hasIde());
  const floats = (panelId: string) =>
    state.current.floating.some((f) => f.panel.id === panelId);
  /**
   * A tab splits off into a new panel beside its own. A text or code editor alone in its
   * panel opens a new, empty editor there instead: each tab owns its document.
   */
  const splittable = (id: string, count: number) => {
    const panel = panelWith(id);
    if (!panel || floats(panel.id)) return false;
    const plugin = pluginOf(id);
    return count > 1 || plugin === textEditor || plugin === codeEditor;
  };
  function splitTab(id: string, axis: "x" | "y") {
    const panel = panelWith(id);
    if (!panel || !splittable(id, panel.tabs.length)) return;
    const ids = { panelId: crypto.randomUUID(), splitId: crypto.randomUUID() };
    if (panel.tabs.length > 1) {
      dispatch({
        type: "drop",
        sourcePanel: panel.id,
        tabId: id,
        targetPanel: panel.id,
        edge: axis === "x" ? "right" : "bottom",
        ...ids,
      });
      return;
    }
    const plugin = pluginOf(id);
    const fresh = plugin.create();
    if (
      !openAt(panel.id, {
        tab: { id: fresh, plugin: plugin.id },
        ...ids,
        mode: axis,
      })
    ) {
      plugin.dispose(fresh);
      report("There is no room to split this panel");
    }
  }
  /** A new, empty text tab in a panel of text editors. */
  function addTab(panelId: string) {
    const id = textEditor.create();
    if (
      !openAt(panelId, {
        tab: { id, plugin: textEditor.id },
        panelId: crypto.randomUUID(),
        splitId: crypto.randomUUID(),
        mode: "tab",
      })
    )
      textEditor.dispose(id);
  }
  const isCode = (p: PanelNode) =>
    p.tabs.some(
      (t) =>
        t.plugin === codeEditor.id ||
        t.plugin === diffPlugin.id ||
        t.plugin === coveragePlugin.id,
    );
  /** The last focused code panel, else any. */
  function codePanel() {
    const all = allPanels(state.current);
    return (
      all.find((p) => p.id === lastCode.current && isCode(p)) ??
      all.find(isCode)
    );
  }
  /** A visible IDE bottom panel: the project's, else (without one) any. */
  function idePanelOf(project: string | null) {
    for (const panel of allPanels(state.current))
      for (const tab of panel.tabs)
        if (
          tab.plugin === idePanel.id &&
          (!project || getPanel(tab.id)?.project === project)
        )
          return { panel, tab: tab.id };
    return null;
  }
  /** Keeps a project sidebar narrow, as in most code editors. */
  function sidebarRatio(panelId: string) {
    const width = geometry(
      state.current.root,
      latest.current.bounds,
      pluginLimits,
    ).get(panelId)?.width;
    return width ? Math.min(0.5, Math.max(0.12, 320 / width)) : 0.5;
  }
  function openAt(target: string, action: Omit<OpenAction, "type">) {
    dispatch({ type: "activate", panelId: target });
    return dispatch({ type: "open", ...action }, true);
  }
  /**
   * Opens a project's bottom panel under the code editors, or beside the sidebar while no
   * code is open. It never spans the sidebar.
   */
  function openIdePanel(
    project: string,
    code: PanelNode | null = codePanel() ?? null,
  ) {
    const id = createPanel(project);
    const tab = { id, plugin: idePanel.id };
    const ids = { panelId: crypto.randomUUID(), splitId: crypto.randomUUID() };
    const sidebar = panelWith(project);
    // A sidebar sharing its panel with other tools may need more than the narrow share.
    const opened = code
      ? openAt(code.id, { tab, ...ids, mode: "y", ratio: 0.7 })
      : sidebar
        ? openAt(sidebar.id, {
            tab,
            ...ids,
            mode: "x",
            ratio: sidebarRatio(sidebar.id),
          }) || openAt(sidebar.id, { tab, ...ids, mode: "auto" })
        : dispatch({ type: "open", tab, ...ids, mode: "auto" }, true);
    if (!opened) {
      idePanel.dispose(id);
      return null;
    }
    return id;
  }
  /**
   * Where the IDE puts a tab: the panel of the last focused code editor, beside it with
   * `side`, else above the project's bottom panel, else right of the project sidebar.
   */
  function place(id: string, plugin: PluginDefinition, side = false) {
    if (panelWith(id)) return attach(id, "tab", plugin);
    const tab = { id, plugin: plugin.id };
    const ids = { panelId: crypto.randomUUID(), splitId: crypto.randomUUID() };
    const code = codePanel();
    if (code) {
      // The first file takes the place of the IDE's empty editor.
      const blanks = side
        ? []
        : code.tabs
            .filter((t) => t.plugin === codeEditor.id && blank(t.id))
            .map((t) => t.id);
      dispatch({ type: "activate", panelId: code.id });
      const opened = dispatch({
        type: "open",
        tab,
        ...ids,
        mode: side ? "x" : "tab",
      });
      if (opened)
        for (const id of blanks) {
          dispatch({ type: "close", tabId: id });
          codeEditor.dispose(id);
        }
      return opened;
    }
    const path = plugin === codeEditor ? getDocument(id).path : null;
    const bottom =
      idePanelOf((path && projectFor(path)?.id) || null) ?? idePanelOf(null);
    if (
      bottom &&
      openAt(bottom.panel.id, {
        tab,
        ...ids,
        mode: "y",
        before: true,
        ratio: 0.7,
      })
    )
      return true;
    const target = allPanels(state.current).find(
      (p) => p.id === state.current.focused,
    );
    const sidebar = target?.tabs.some((t) => t.plugin === ideProject.id);
    const ratio = sidebar && target ? sidebarRatio(target.id) : 0.5;
    return dispatch({ type: "open", tab, ...ids, mode: "x", ratio });
  }
  useEffect(() => {
    setHost({
      showCode: (id, options) => place(id, codeEditor, options?.side),
      keepOpen(id, beside) {
        if (panelWith(id)) return true;
        const panel = panelWith(beside);
        if (!panel) return false;
        dispatch({ type: "activate", panelId: panel.id });
        const opened = dispatch({
          type: "open",
          tab: { id, plugin: codeEditor.id },
          panelId: crypto.randomUUID(),
          splitId: crypto.randomUUID(),
          mode: "tab",
        });
        dispatch({ type: "activate", panelId: panel.id, tabId: beside });
        return opened;
      },
      shows: (id) => !!panelWith(id),
      // A comparison is a tab among the code editors, as in VS Code.
      showDiff(path, staged = false) {
        const existing = diffFor(path, staged);
        const id = existing ?? createDiff(path, staged);
        if (!place(id, diffPlugin) && !existing) diffPlugin.dispose(id);
      },
      showCoverage(project, path) {
        const existing = coverageTabFor(path);
        const id = existing ?? createCoverageTab(project, path);
        if (!place(id, coveragePlugin) && !existing) coveragePlugin.dispose(id);
      },
      showProblems(path) {
        const id = showPanel(path ?? null, "problems", true);
        if (!id) report("There is no room for the IDE panel here");
      },
      showPanel: (path, view, channel) => showPanel(path, view, false, channel),
      pick: (title, items) => choose(title, items),
      quickOpen: (prefix) => openPalette(prefix),
      closeIde: (project) => void close(ideTabs(project)),
      ask,
      // IDE messages go to Output → IDE and the IDE status bar, not over the workspace;
      // without a status bar they are a notice as before.
      report(error) {
        logMessage(message(error));
        if (!hasStatus()) report(error);
      },
    });
    beforeSave.add(formatBeforeSave);
    return () => {
      setHost(null);
      beforeSave.delete(formatBeforeSave);
    };
  }, []);
  useEffect(() => {
    if (!focused) return;
    const plugin = focused.tabs.find((t) => t.id === focused.active)?.plugin;
    if (plugin === diffPlugin.id || plugin === coveragePlugin.id)
      lastCode.current = focused.id;
    if (plugin === codeEditor.id) {
      lastCode.current = focused.id;
      const path = focused.active && getDocument(focused.active).path;
      noteProject((path && projectFor(path)?.id) || null);
    } else if (focused.active) noteProject(ideOf(focused.active));
  }, [focused?.id, focused?.active]);
  /**
   * Shows a view of the bottom panel of the project containing `path` (opened under the
   * code when missing) and restores it when minimized. `focus` also activates it.
   */
  function showPanel(
    path: string | null,
    view: PanelView,
    focus: boolean,
    channel?: ChannelName,
  ) {
    const project = path ? (projectFor(path)?.id ?? null) : null;
    const found = idePanelOf(project) ?? (project ? null : idePanelOf(null));
    const id = found?.tab ?? openIdePanel(project ?? "");
    if (!id) return null;
    showView(id, view, channel);
    const panel = panelWith(id);
    if (panel) {
      if (focus || !found)
        dispatch({ type: "activate", panelId: panel.id, tabId: id });
      if (panel.collapsed)
        dispatch({ type: "collapse", panelId: panel.id, collapsed: false });
    }
    return id;
  }
  function ideOpen() {
    return allPanels(state.current).some((p) =>
      p.tabs.some((t) => t.plugin === ideProject.id),
    );
  }
  /**
   * As in VS Code: shows and focuses the IDE terminal of the current code file's project;
   * when that terminal already has focus, minimizes the bottom panel and returns to the code.
   */
  function toggleTerminal() {
    if (!ideOpen()) return;
    const code = currentCode();
    const path = code ? getDocument(code).path : null;
    const project = path ? (projectFor(path)?.id ?? null) : null;
    const found = idePanelOf(project) ?? idePanelOf(null);
    if (
      found &&
      !found.panel.collapsed &&
      found.panel.active === found.tab &&
      getPanel(found.tab)?.view === "terminal" &&
      state.current.focused === found.panel.id
    ) {
      dispatch({ type: "collapse", panelId: found.panel.id, collapsed: true });
      const editor = codePanel();
      if (editor) dispatch({ type: "activate", panelId: editor.id });
      return;
    }
    const at = found ? getPanel(found.tab)?.project : project;
    const root = (at && getProject(at)?.root) || path;
    if (!showPanel(root ?? null, "terminal", true))
      report("There is no room for the IDE panel here");
  }
  /** Opens a drawing or diagram file; `null` shows the module's open dialog. */
  async function openBound(module: FileModule, path: string | null = null) {
    try {
      const id = await module.files.openFile(path);
      // An already open file is only activated; never dispose it.
      if (id && !attach(id, "tab", module.plugin) && hidden(id))
        module.plugin.dispose(id);
    } catch (e) {
      report(e);
    }
  }
  async function save(id: string, as = false) {
    try {
      return await saveDocument(id, as);
    } catch (e) {
      report(e);
      return false;
    }
  }
  function pluginOf(id: string) {
    const tab = allPanels(state.current)
      .flatMap((p) => p.tabs)
      .find((t) => t.id === id);
    return registry.get(tab?.plugin ?? textEditor.id)!;
  }
  async function confirmClose(ids: string[]) {
    for (const id of ids) {
      const plugin = pluginOf(id);
      await plugin.settle?.(id);
      while (!plugin.beforeClose(id)) {
        const result = await ask(
          "Unsaved changes",
          `Save changes to ${plugin.title(id)}?`,
          ["Save", "Discard", "Cancel"],
        );
        if (
          result === "Cancel" ||
          (result === "Save" &&
            !(await (plugin.save ? plugin.save(id) : save(id))))
        )
          return false;
        if (result === "Discard") break;
        // If typing continued while a native save dialog was open, ask again for those edits.
      }
    }
    return true;
  }
  async function close(ids: string[]) {
    if (closing.current) return;
    closing.current = true;
    // The IDE's own parts have no close buttons and close together.
    ids = [
      ...new Set(
        ids.flatMap((id) => {
          const project = ideOf(id);
          return project ? [id, ...ideTabs(project)] : [id];
        }),
      ),
    ];
    const all = allPanels(state.current);
    const ideStays = all.some((p) =>
      p.tabs.some((t) => t.plugin === ideProject.id && !ids.includes(t.id)),
    );
    // The last IDE takes its code editors and comparisons with it.
    if (!ideStays && ids.some((id) => pluginOf(id) === ideProject))
      ids = [
        ...new Set([
          ...ids,
          ...all.flatMap((p) => (isCode(p) ? p.tabs.map((t) => t.id) : [])),
        ]),
      ];
    try {
      if (!(await confirmClose(ids))) return;
      // Otherwise a code area closing its last tab keeps an empty editor, as in VS Code.
      if (ideStays)
        for (const panel of allPanels(state.current)) {
          if (!isCode(panel) || panel.tabs.some((t) => !ids.includes(t.id)))
            continue;
          const empty = panel.tabs.find(
            (t) => t.plugin === codeEditor.id && blank(t.id),
          );
          if (empty) {
            ids = ids.filter((id) => id !== empty.id);
            continue;
          }
          const code = codeEditor.create();
          dispatch({ type: "activate", panelId: panel.id });
          if (
            !dispatch({
              type: "open",
              tab: { id: code, plugin: codeEditor.id },
              panelId: crypto.randomUUID(),
              splitId: crypto.randomUUID(),
              mode: "tab",
            })
          )
            codeEditor.dispose(code);
        }
      await snapshotQueue.current;
      for (const id of ids) {
        const plugin = pluginOf(id);
        if (
          isTauri() &&
          (plugin === textEditor ||
            plugin === codeEditor ||
            fileModules.some((m) => m.plugin === plugin))
        ) {
          await native("remove_snapshot", { id });
          await native("watch_document", { id, path: null });
        }
        const read = plugin === diffPlugin ? diffDocument(id) : null;
        dispatch({ type: "close", tabId: id });
        plugin.dispose(id);
        // The document a comparison read for itself went with it.
        if (read && !hasDocument(read) && isTauri())
          await native("watch_document", { id: read, path: null });
      }
    } catch (e) {
      report(e);
    } finally {
      closing.current = false;
    }
  }
  /**
   * Closes the focused module: every tab of its panel. A part of an IDE (its code editors
   * included) closes the whole IDE, after asking.
   */
  async function closeModule() {
    const panel = allPanels(state.current).find(
      (p) => p.id === state.current.focused,
    );
    if (!panel) return;
    const part = panel.tabs.map((t) => ideOf(t.id)).find(Boolean);
    const path =
      pluginOf(panel.active) === codeEditor
        ? getDocument(panel.active).path
        : null;
    const project =
      part ??
      (isCode(panel) && hasIde()
        ? ((path && projectFor(path)?.id) ??
          allPanels(state.current)
            .flatMap((p) => p.tabs)
            .find((t) => t.plugin === ideProject.id)?.id ??
          null)
        : null);
    if (!project) return close(panel.tabs.map((t) => t.id));
    const others = allPanels(state.current).some((p) =>
      p.tabs.some((t) => t.plugin === ideProject.id && t.id !== project),
    );
    const answer = await ask(
      "Close IDE",
      `Close the IDE of ${ideProject.title(project)}${others ? "" : " and its code editors"}?`,
      ["Close IDE", "Cancel"],
    );
    if (answer === "Close IDE") await close(ideTabs(project));
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setBounds({
        x: 0,
        y: 0,
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(area.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    function down(event: KeyboardEvent) {
      const modifier = latest.current.modifier;
      // Ctrl+Shift held lets a panel's grip move the whole panel.
      setControl(event.key !== "Escape" && moveKeys(event));
      if (isModifierKey(event, modifier)) {
        if (!event.getModifierState("AltGraph")) {
          held.current = true;
          // A bare Alt press would otherwise move focus to the WebView's menu handling.
          if (modifier === "AltLeft") event.preventDefault();
        }
        return;
      }
      // A keyup missed while another application had focus reads as released here.
      if (held.current && !modifierDown(event, modifier)) held.current = false;
      const workspace = command(event, modifier, held.current);
      if (workspace) {
        // Taken before any module sees it: no shell byte, editor command or drawing tool.
        event.preventDefault();
        event.stopPropagation();
        if (document.querySelector("dialog[open]")) return;
        const id = neighbor(
          state.current,
          latest.current.bounds,
          workspace.edge,
          pluginLimits,
        );
        if (id) dispatch({ type: "activate", panelId: id });
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      const actions: [string, () => void][] = [
        ["launcher", openLauncher],
        ["module.close", () => void closeModule()],
        ["window.close", () => windowAction("close")],
        ["window", () => void native("new_workspace").catch(report)],
        ["new", () => void create("tab")],
        ["new.split", () => void create("auto")],
        [
          "open",
          () => {
            const { bound } = latest.current;
            void (bound ? openBound(bound.module) : open());
          },
        ],
        ["save", () => saveFocused(false)],
        ["save.as", () => saveFocused(true)],
        [
          "close",
          () => void (latest.current.tab && close([latest.current.tab])),
        ],
        ["settings", () => setSettings(true)],
        ["view.terminal", toggleTerminal],
        ["palette", () => openPalette(">")],
        ["palette.files", () => openPalette("")],
        ["palette.symbols", () => openPalette("@")],
      ];
      const found = actions.find(([id]) => matches(event, id));
      if (!found) return;
      const target = event.target as Element | null;
      // While a drawing has focus, Excalidraw keeps its command palette (Ctrl+Shift+P), font
      // size (Ctrl+Shift+,) and image export (Ctrl+Shift+E).
      if (
        (found[0].startsWith("palette") ||
          found[0] === "settings" ||
          found[0] === "window.close") &&
        target?.closest?.(".excalidraw")
      )
        return;
      // A terminal copies its selection with Ctrl+Shift+C, as terminals do.
      if (found[0] === "module.close" && target?.closest?.(".terminal-host"))
        return;
      // Shell line editing owns plain Ctrl+letter keys inside a terminal, such as Ctrl+N/O/S/W
      // (next, operate, XOFF, word).
      const combo = parse(keysOf(found[0]))!;
      if (
        combo.ctrl &&
        !combo.alt &&
        !combo.shift &&
        /^[A-Z]$/.test(combo.key) &&
        (event.target as Element | null)?.closest?.(".terminal-host")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      found[1]();
    }
    const up = (e: KeyboardEvent) => {
      setControl(moveKeys(e));
      if (isModifierKey(e, latest.current.modifier)) held.current = false;
    };
    const hidden = () => {
      if (document.hidden) release();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  function applyPreferences(next: Preferences) {
    setPreferences(next);
    setCustom(next.keybindings);
    setTodoTags(next.todoTags);
    setWordWrap(next.wordWrap);
    document.documentElement.style.setProperty(
      "--window-opacity",
      String(next.opacity),
    );
  }
  function savePreferences(next: Preferences) {
    applyPreferences(next);
    void preferencesBackend.set(next).catch(report);
  }
  useEffect(() => {
    void preferencesBackend.get().then(applyPreferences).catch(report);
    // Settings changed in any window apply to every window.
    const unlisten = preferencesBackend.onChange(applyPreferences);
    return () => void unlisten.then((fn) => fn());
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    void native<Modifier>("get_modifier").then(setModifier).catch(report);
    void native<Recovery[]>("list_recovery").then(setRecoveries).catch(report);
    const cleanups: (() => void)[] = [];
    let disposed = false;
    function add(unlisten: () => void) {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    }
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing.current) return;
        closing.current = true;
        try {
          const ids = allPanels(state.current).flatMap((p) =>
            p.tabs.map((t) => t.id),
          );
          if (await confirmClose(ids)) {
            await snapshotQueue.current;
            await native("clear_snapshots");
            // Drawings of the last window are reopened by the next session.
            await drawingsBackend.closeWindow().catch(report);
            await getCurrentWindow().destroy();
          }
        } catch (e) {
          report(e);
        } finally {
          closing.current = false;
        }
      })
      .then(add)
      .catch(report);
    // Another window asked this one to show its single-panel plugin (for example Tasks).
    void getCurrentWebviewWindow()
      .listen<string>("focus-plugin", (event) => {
        const plugin = registry.get(event.payload);
        if (plugin) void create("tab", plugin);
      })
      .then(add)
      .catch(report);
    // Another window was asked to open a drawing or diagram this one already shows.
    void getCurrentWebviewWindow()
      .listen<string>("focus-drawing", (event) => {
        for (const module of fileModules) {
          const id = module.files.findByPath(event.payload);
          if (id) attach(id, "tab", module.plugin);
        }
      })
      .then(add)
      .catch(report);
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop")
          void (async () => {
            // Native drop positions are physical pixels; the workspace uses CSS pixels.
            const scale = await getCurrentWindow().scaleFactor();
            if (event.payload.type !== "drop") return;
            const x = event.payload.position.x / scale,
              y = event.payload.position.y / scale;
            const target = document
              .elementFromPoint(x, y)
              ?.closest<HTMLElement>("[data-panel]");
            if (target)
              dispatch({ type: "activate", panelId: target.dataset.panel! });
            const panel = allPanels(state.current).find(
              (p) => p.id === target?.dataset.panel,
            );
            const drawing =
              panel?.tabs.find((t) => t.id === panel.active)?.plugin ===
              excalidraw.id
                ? panel.active
                : null;
            const images: string[] = [];
            for (const path of event.payload.paths) {
              const module = fileModules.find((m) => m.files.isPath(path));
              if (module) await openBound(module, path);
              else if (drawing && imageType(path)) images.push(path);
              else await open(path);
            }
            // Images dropped onto a drawing go to Excalidraw's own image drop at that point.
            if (drawing && images.length) {
              const { dropFiles } =
                await import("./plugins/excalidraw/runtime");
              const files = await Promise.all(
                images.map(
                  async (path) =>
                    new File(
                      [await drawingsBackend.readImage(path)],
                      path.split(/[\\/]/).pop()!,
                      { type: imageType(path)! },
                    ),
                ),
              );
              dropFiles(drawing, files, x, y);
            }
          })().catch(report);
      })
      .then(add)
      .catch(report);
    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    for (const doc of docs)
      void native("watch_document", { id: doc.id, path: doc.path }).catch(
        report,
      );
  }, [docs.map((d) => `${d.id}:${d.path}`).join("|")]);
  const boundList = boundItems.flat();
  useEffect(() => {
    if (!isTauri()) return;
    for (const d of boundList)
      void native("watch_document", { id: d.id, path: d.path }).catch(report);
  }, [boundList.map((d) => `${d.id}:${d.path}`).join("|")]);
  // Rust keeps this window's file-bound drawings and diagrams, in tab order, for the next
  // session.
  const tabs = allPanels(workspace).flatMap((p) => p.tabs);
  const openPaths = fileModules.map((_, index) =>
    tabs
      .map((t) => boundItems[index].find((d) => d.id === t.id)?.path)
      .filter((path): path is string => !!path),
  );
  useEffect(() => {
    if (isTauri())
      fileModules.forEach(
        (module, index) =>
          void drawingsBackend
            .setOpen(openPaths[index], module.files.kind)
            .catch(report),
      );
  }, [openPaths.map((paths) => paths.join("\n")).join("\0")]);
  useEffect(() => {
    const unsubscribe = fileModules.map((module) => {
      module.files.setOpener((path) => void openBound(module, path));
      return module.files.onError(report);
    });
    return () => {
      fileModules.forEach((module) => module.files.setOpener(null));
      unsubscribe.forEach((fn) => fn());
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const written = new Map<string, number>();
    // Periodic checkpoints also protect continuous typing; never write per keystroke.
    const timer = window.setInterval(() => {
      if (closing.current) return;
      snapshotQueue.current = snapshotQueue.current
        .then(async () => {
          if (closing.current) return;
          const live = new Set(
            [
              ...allDocuments(),
              ...fileModules.flatMap((m) => m.files.all()),
            ].map((d) => d.id),
          );
          for (const id of written.keys()) {
            if (!live.has(id)) written.delete(id);
          }
          for (const doc of allDocuments()) {
            if (written.get(doc.id) === doc.generation) continue;
            await native(
              dirty(doc) ? "write_snapshot" : "remove_snapshot",
              dirty(doc)
                ? {
                    id: doc.id,
                    snapshot: {
                      name: doc.name,
                      text: doc.text,
                      bom: doc.bom,
                      ending: doc.ending,
                    },
                  }
                : { id: doc.id },
            );
            written.set(doc.id, doc.generation);
          }
          for (const module of fileModules)
            for (const d of module.files.all()) {
              if (written.get(d.id) === d.generation) continue;
              await native(
                boundDirty(d) ? "write_snapshot" : "remove_snapshot",
                boundDirty(d)
                  ? {
                      id: d.id,
                      snapshot: {
                        name: d.name,
                        text: d.text,
                        bom: d.bom,
                        ending: d.ending,
                        kind: module.snapshot,
                      },
                    }
                  : { id: d.id },
              );
              written.set(d.id, d.generation);
            }
        })
        .catch(report);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let running = false,
      disposed = false,
      pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function check() {
      if (disposed) return;
      if (running) {
        pending = true;
        return;
      }
      running = true;
      try {
        for (const doc of allDocuments()) {
          if (!doc.path || doc.conflict) continue;
          try {
            await checkExternal(doc.id);
          } catch (e) {
            if (allDocuments().some((d) => d.id === doc.id))
              updateDocument(doc.id, { conflict: String(e) });
          }
        }
        for (const module of fileModules)
          for (const d of module.files.all()) {
            if (!d.path || d.conflict) continue;
            try {
              await module.files.check(d.id);
            } catch (e) {
              if (module.files.has(d.id))
                module.files.update(d.id, {
                  conflict: String(e).replace(/^Error: /, ""),
                });
            }
          }
      } finally {
        running = false;
        if (pending) {
          pending = false;
          void check();
        }
      }
    }
    const registered = listen("disk-change", () => {
      clearTimeout(timer);
      timer = setTimeout(() => void check(), 150);
    });
    const errors = listen<string>("watch-error", (event) =>
      report(event.payload),
    );
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      disposed = true;
      clearTimeout(timer);
      void registered.then((fn) => fn());
      void errors.then((fn) => fn());
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  async function recover(item: Recovery) {
    const module = fileModules.find((m) => m.snapshot === item.kind);
    if (module) {
      // A recovered drawing or diagram is new and unsaved; it never writes to the original.
      const id = module.files.create({
        name: `${module.files.baseName(item.name)} (recovered)`,
        text: item.text,
        bom: item.bom,
        ending: item.ending,
      });
      if (attach(id, "tab", module.plugin)) {
        await native("write_snapshot", { id, snapshot: item });
        await native("discard_recovery", { key: item.key });
        setRecoveries((list) => list.filter((r) => r.key !== item.key));
      } else module.plugin.dispose(id);
      return;
    }
    const id = createDocument({
      name: `${item.name} (recovered)`,
      text: item.text,
      bom: item.bom,
      ending: item.ending,
    });
    if (attach(id, "tab")) {
      // Keep the original snapshot until the recovered document has its own durable snapshot.
      await native("write_snapshot", { id, snapshot: item });
      await native("discard_recovery", { key: item.key });
      setRecoveries((list) => list.filter((r) => r.key !== item.key));
    } else textEditor.dispose(id);
  }
  return (
    <main className="shell">
      {/* The status line doubles as the window's drag strip (double-click maximizes). A
          tool's own state (a file's encoding, autosave) is in that tool's bar. */}
      <header
        className="titlebar status"
        data-tauri-drag-region
        onDoubleClick={() => windowAction("maximize")}
      >
        <span className="status-left" data-tauri-drag-region>
          <img
            className="status-logo"
            src="/mozaik.svg"
            alt="Mozaik"
            draggable={false}
            data-tauri-drag-region
          />
        </span>
        <span className="status-right" data-tauri-drag-region>
          <Clock />
        </span>
      </header>
      {notice && (
        <div className="notice" role="alert">
          <span>{notice}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      {recoveries.length > 0 && (
        <div className="recovery">
          <span>Recoverable work</span>
          {recoveries.map((item) => (
            <div key={item.key}>
              <span>{item.name}</span>
              <button onClick={() => void recover(item).catch(report)}>
                Recover
              </button>
              <button
                onClick={() =>
                  void (async () => {
                    if (
                      (await ask(
                        "Discard recovery",
                        `Permanently discard ${item.name}?`,
                        ["Discard", "Cancel"],
                      )) === "Discard"
                    ) {
                      await native("discard_recovery", { key: item.key });
                      setRecoveries((list) =>
                        list.filter((r) => r.key !== item.key),
                      );
                    }
                  })().catch(report)
                }
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}
      {active?.conflict && (
        <div className="notice" role="alert">
          <span>{active.conflict}</span>
          <button onClick={() => void save(active.id, true)}>Save As</button>
          <button
            onClick={() =>
              void (async () => {
                if (
                  dirty(active) &&
                  (await ask(
                    "Reload file",
                    "Discard local edits and reload the disk version?",
                    ["Reload", "Cancel"],
                  )) !== "Reload"
                )
                  return;
                const file = await native<FileData>("read_file", {
                  path: active.path,
                });
                updateDocument(active.id, {
                  ...file,
                  saved: file.text,
                  conflict: null,
                });
              })().catch(report)
            }
          >
            Reload
          </button>
        </div>
      )}
      <DebugToolbar />
      <div className="workspace-area" ref={area}>
        {workspace.root || workspace.floating.length ? (
          <WorkspaceView
            state={workspace}
            bounds={bounds}
            control={control}
            limits={pluginLimits}
            dispatch={dispatch}
            close={(ids) => void close(ids)}
            closable={closable}
            split={splitTab}
            splittable={splittable}
            addTab={addTab}
            canAdd={(id) => pluginOf(id) === textEditor}
          />
        ) : (
          <section className="empty">
            <div className="workspace-mark">▦</div>
            <h1>A little space to think.</h1>
            <p>
              Press <kbd>{keyLabel("launcher")}</kbd> to add a tool, or{" "}
              <kbd>{keyLabel("palette")}</kbd> for commands.
            </p>
          </section>
        )}
      </div>
      {launcher && (
        <Launcher
          plugins={[...registry.values()].filter((p) => p.listed !== false)}
          onPick={(plugin, mode) => void create(mode, plugin)}
          onCancel={closeLauncher}
        />
      )}
      {palette !== null && (
        <CommandPalette
          commands={commands}
          modes={quickModes}
          initial={palette}
          onPick={(command, mode) => closePalette(() => command.run(mode))}
          onCancel={() => closePalette()}
        />
      )}
      {pick && (
        <CommandPalette
          key={pick.title}
          title={pick.title}
          commands={pick.items.map((item) => ({ ...item, run: () => {} }))}
          onPick={(item) => closePick(item.id)}
          onCancel={() => closePick(null)}
        />
      )}
      {settings && (
        <Settings
          modifier={modifier}
          preferences={preferences}
          ask={ask}
          onClose={() => setSettings(false)}
          onSave={(draft) => {
            if (draft.modifier !== modifier) {
              release();
              setModifier(draft.modifier);
              if (isTauri())
                void native("set_modifier", { modifier: draft.modifier }).catch(
                  report,
                );
            }
            savePreferences(draft.preferences);
          }}
        />
      )}
      {question && (
        <Dialog title={question.title} onCancel={() => answer("Cancel")}>
          <p>{question.message}</p>
          <div className="dialog-actions">
            {question.choices.map((choice) => (
              <button key={choice} onClick={() => answer(choice)}>
                {choice}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </main>
  );
}
