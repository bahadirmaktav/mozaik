import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import {
  allPanels,
  apply,
  contains,
  isFloating,
  emptyWorkspace,
  geometry,
  groupRoot,
  neighbor,
  panels,
  parentOf,
  type Action,
  type Node,
  type Panel as PanelNode,
  type Workspace,
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
  reloadsPage,
  type Modifier,
} from "./workspace/shortcuts";
import { moduleCommands } from "./workspace/commands";
import {
  codeEditor,
  codeView,
  diff as diffPlugin,
  coverage as coveragePlugin,
  excalidraw,
  fileManager,
  fileModules,
  fileTab,
  ideAgent,
  ideProject,
  idePanel,
  ideStatus,
  pluginLimits,
  registry,
  terminal,
  textEditor,
  type FileModule,
} from "./plugins/registry";
import { createSession } from "./plugins/terminal/sessions";
import { setTerminalOpener } from "./plugins/terminal/open";
import { loadShells } from "./plugins/terminal/ShellSetting";
import { windowBackend, type TextRequest } from "./services/windows";
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
  isBlank,
  markBlank,
  updateDocument,
  useDocuments,
} from "./plugins/text-editor/documents";
import {
  afterSave,
  beforeSave,
  checkExternal,
  fileBackend,
  native,
  openFile,
  saveDocument,
  type Recovery,
  type FileData,
} from "./services/native";
import { Dialog } from "./components/Dialog";
import type { MenuItem } from "./components/Menu";
import { FolderSidebar } from "./plugins/text-editor/FolderSidebar";
import { notText, setTextOpener, textLike } from "./plugins/text-editor/open";
import { setMarkdownLinkOpener } from "./plugins/text-editor/MarkdownPreview";
import { fileSystem } from "./services/filesystem";
import { layoutsBackend } from "./services/layouts";
import { templateOf, workspaceOf } from "./workspace/templates";
import { NamePrompt } from "./components/NamePrompt";
import {
  keepFolders,
  openFolder as openPanelFolder,
} from "./plugins/text-editor/folders";
import { Launcher, type AddMode } from "./components/Launcher";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { Settings, type SettingsTab } from "./workspace/Settings";
import {
  defaultFontSizes,
  defaultPreferences,
  IDE_FONT_SIZE,
  MINIMAP_WIDTH,
  preferencesBackend,
  type Preferences,
} from "./services/preferences";
import { applyTheme, THEMES } from "./workspace/themes";
import { setPinsPlacement } from "./services/pins";
import { setMinimap } from "./plugins/ide/minimap";
import { setDiffChangesOnly } from "./plugins/ide/diffs";
import { CPP_THEMES, setCppTheme } from "./plugins/ide/cppThemes";
import {
  current as currentCode,
  isEmptyArea,
  markEmptyArea,
  message,
  preferView,
  reveal,
  setHost,
  viewOf,
  type PickItem,
} from "./plugins/ide/editors";
import {
  createCodeView,
  viewDocument,
  viewsOfDocument,
} from "./plugins/ide/codeViews";
import { createFileTab, fileTabFor } from "./plugins/ide/fileTabs";
import {
  addAgentSession,
  agentPanelOf,
  agentProject,
  AGENTS,
  ensureAgentPanel,
  rememberCodeShare,
  sessionsOf,
  showAgent,
} from "./plugins/ide/agents";
import { AgentButton } from "./plugins/ide/AgentPanel";
import type { AgentName } from "./plugins/terminal/sessions";
import {
  commands as debugCommands,
  debugShortcut,
  isDebugging,
} from "./plugins/ide/debug";
import { commands as testCommands } from "./plugins/ide/testing";
import { DebugToolbar } from "./plugins/ide/DebugConsole";
import { setIdeZoom } from "./workspace/ideZoom";
import { logMessage, type ChannelName } from "./plugins/ide/channels";
import { commands as cmakeCommands, noteProject } from "./plugins/ide/cmake";
import { useQuickModes } from "./plugins/ide/quick";
import type { PanelView } from "./plugins/ide/panels";
import {
  commitDiffFor,
  createDiff,
  diffDocument,
  diffFor,
} from "./plugins/ide/diffs";
import {
  commands as coverageCommands,
  coverageTabFor,
  createCoverageTab,
} from "./plugins/ide/coverage";
import { formatBeforeSave } from "./plugins/ide/save";
import {
  analyzeAfterSave,
  commands as analysisCommands,
  loadInfo as loadAnalysis,
} from "./plugins/ide/analysis";
import { commands as sonarCommands } from "./plugins/ide/sonar";
import { FixPreview } from "./plugins/ide/FixPreview";
import { setTodoTags } from "./plugins/ide/todos";
import { enabled, setDisabledFeatures } from "./plugins/ide/features";
import { setWordWrap } from "./plugins/text-editor/wrap";
import { applyFonts } from "./workspace/fonts";
import { applyFontSizes } from "./workspace/moduleZoom";
import {
  createPanel,
  createStatus,
  getPanel,
  hasStatus,
  newTerminal,
  showView,
  statusProject,
} from "./plugins/ide/panels";
import { createInstance as createFileManager } from "./plugins/file-manager/instances";
import {
  allProjects,
  getProject,
  openFolder,
  projectFor,
  useProjectTitle,
} from "./plugins/ide/projects";
import { SearchIcon } from "./components/Icons";
import { ideBackend } from "./services/ide";
import { baseName } from "./plugins/ide/paths";
import {
  DEFAULT_ICON_THEME,
  ICON_THEMES,
  setIconTheme,
} from "./plugins/ide/fileIcons";
import "./App.css";

/** A pick list's entry selected first, and what follows the entry under the cursor. */
type PickOptions = {
  selected?: string;
  preview?: (id: string | null) => void;
};
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
/** IDEs side by side in one window: each keeps room for its sidebar, code and panel. */
const MAX_IDES = 2;
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
const DEBUG_KEYS = [
  "debug.continue",
  "debug.pause",
  "debug.stepOver",
  "debug.stepInto",
  "debug.stepOut",
  "debug.stop",
  "debug.restart",
  "debug.breakpoint",
];

export default function App() {
  const [workspace, setWorkspace] = useState(emptyWorkspace),
    state = useRef(workspace);
  // Opening a named layout gives this window an identity until another layout replaces it.
  const [layoutName, setLayoutName] = useState<string | null>(null);
  // Modules added beside an IDE: they stay in floating panels of their own (`guestsApart`).
  const guests = useRef(new Set<string>());
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
    lastCode = useRef<string | null>(null),
    lastText = useRef<string | null>(null),
    lastTerminal = useRef<string | null>(null);
  const [launcher, setLauncher] = useState(false),
    // The palette's starting text: `>` commands, empty files, `@` symbols.
    [palette, setPalette] = useState<string | null>(null),
    [pick, setPick] = useState<{
      title: string;
      items: PickItem[];
      resolve: (id: string | null) => void;
      options?: PickOptions;
    } | null>(null),
    // Workspace Settings, open on that tab.
    [settings, setSettings] = useState<SettingsTab | null>(null),
    [naming, setNaming] = useState<{
      existing: string[];
      resolve: (name: string | null) => void;
    } | null>(null);
  const [notice, setNotice] = useState(""),
    [question, setQuestion] = useState<Question | null>(null);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const [preferences, setPreferences] = useState(defaultPreferences);
  const preferencesRef = useRef(defaultPreferences);
  // Menus and the palette show the current keys.
  useKeybindings();
  const snapshotQueue = useRef<Promise<unknown>>(Promise.resolve());
  const docs = useDocuments(),
    closing = useRef(false);
  // Drawings and diagrams; the hooks re-render on their changes.
  const boundItems = fileModules.map((m) => m.files.useAll());
  const focused = allPanels(workspace).find((p) => p.id === workspace.focused);
  // With two IDEs the focused one names the window.
  const ideProjectId =
    focused?.tabs.map((tab) => ideOf(tab.id)).find(Boolean) ??
    allPanels(workspace)
      .flatMap((panel) => panel.tabs)
      .find((tab) => tab.plugin === ideProject.id)?.id ??
    null;
  const projectName = useProjectTitle(ideProjectId);
  const windowName = projectName ?? layoutName ?? "Mozaik";
  const windowTitle =
    windowName === "Mozaik" ? windowName : `${windowName} — Mozaik`;
  // A layout's name lasts only while something of it is open.
  const empty = allPanels(workspace).length === 0;
  useEffect(() => {
    if (empty) setLayoutName(null);
  }, [empty]);
  // A comparison saves the document of its file, as in VS Code.
  const active = docs.find(
    (d) =>
      d.id === focused?.active ||
      (!!focused?.active &&
        (d.id === diffDocument(focused.active) ||
          d.id === viewDocument(focused.active))),
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
  useEffect(() => {
    document.title = windowTitle;
    if (isTauri()) void getCurrentWindow().setTitle(windowTitle).catch(report);
  }, [windowTitle]);
  /** `quiet` leaves a rejected layout change unreported, for optional IDE panels. */
  function dispatch(action: Action, quiet = false) {
    // A Text Editor tab dropped at an edge of a Text Editor divides it into editor groups.
    if (
      action.type === "drop" &&
      action.edge &&
      action.tabId &&
      action.group === undefined &&
      ((pluginOf(action.tabId) === textEditor &&
        textPanel(action.targetPanel)) ||
        codeTarget(action.targetPanel))
    )
      action = { ...action, group: true };
    // A tab added to a guest's floating panel is a guest too.
    if (action.type === "open" && action.mode === "tab") {
      const target = allPanels(state.current).find(
        (p) => p.id === state.current.focused,
      );
      if (target?.tabs.every((t) => guests.current.has(t.id)))
        guests.current.add(action.tab.id);
    }
    try {
      const next = apply(
        state.current,
        action,
        latest.current.bounds,
        pluginLimits(),
      );
      if (!guestsApart(next))
        throw new Error(
          "Beside an IDE, other modules stay in floating panels of their own",
        );
      state.current = next;
      setWorkspace(next);
      // A tab dropped among others takes the place of an empty code or text area there.
      if (action.type === "drop" && action.tabId) {
        const panel = panelWith(action.tabId);
        if (panel && panel.tabs.length > 1)
          dropEmptyArea({
            ...panel,
            tabs: panel.tabs.filter((t) => t.id !== action.tabId),
          });
      }
      return true;
    } catch (error) {
      if (!quiet) report(error);
      return false;
    }
  }
  /**
   * With an IDE in the window, a module added beside it floats in panels of its own: it
   * neither docks nor shares a panel with a part of the IDE.
   */
  function guestsApart(next: Workspace) {
    const panels = allPanels(next);
    if (!panels.some((p) => p.tabs.some((t) => t.plugin === ideProject.id)))
      return true;
    return panels.every((p) => {
      const count = p.tabs.filter((t) => guests.current.has(t.id)).length;
      return count === 0 || (count === p.tabs.length && isFloating(next, p.id));
    });
  }
  const isGuest = (panel: { tabs: { id: string }[] }) =>
    ideOpen() && panel.tabs.every((t) => guests.current.has(t.id));
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
  function choose(title: string, items: PickItem[], options?: PickOptions) {
    pick?.resolve(null);
    launcherReturn.current = document.activeElement;
    return new Promise<string | null>((resolve) =>
      setPick({ title, items, resolve, options }),
    );
  }
  /** Preferences: Color Theme: the theme under the cursor shows at once, as in VS Code;
   * Escape puts the saved one back. */
  async function chooseTheme() {
    const saved = preferencesRef.current.theme;
    const id = await choose(
      "Select Color Theme",
      THEMES.map((t) => ({
        id: t.id,
        label: t.name,
        detail: t.dark ? "dark" : "light",
      })),
      { selected: saved, preview: (id) => applyTheme(id ?? saved) },
    );
    if (id && id !== preferencesRef.current.theme)
      savePreferences({ ...preferencesRef.current, theme: id });
    else applyTheme(preferencesRef.current.theme);
  }
  /** Preferences: C++ Highlight Theme: as the color theme, it shows at once. */
  async function chooseCppTheme() {
    const saved = preferencesRef.current.ideCppTheme;
    const id = await choose(
      "Select C++ Highlight Theme",
      CPP_THEMES.map((t) => ({ id: t.id, label: t.name })),
      { selected: saved, preview: (id) => setCppTheme(id ?? saved) },
    );
    if (id && id !== preferencesRef.current.ideCppTheme)
      savePreferences({ ...preferencesRef.current, ideCppTheme: id });
    else setCppTheme(preferencesRef.current.ideCppTheme);
  }
  /** Preferences: File Icon Theme: as the color theme, the icons under the cursor show
   * in the Explorer at once; Escape puts the saved ones back. */
  async function chooseIconTheme() {
    const saved = preferencesRef.current.ideIconTheme;
    const id = await choose(
      "Select File Icon Theme",
      ICON_THEMES.map((t) => ({ id: t.id, label: t.name, detail: t.detail })),
      { selected: saved, preview: (id) => setIconTheme(id ?? saved) },
    );
    if (id && id !== preferencesRef.current.ideIconTheme)
      savePreferences({ ...preferencesRef.current, ideIconTheme: id });
    else setIconTheme(preferencesRef.current.ideIconTheme);
  }
  /** Developer: Reload Window: closes everything (asking about unsaved files) and starts
   * the page again; an open IDE comes back on its folder, as in VS Code. */
  async function reloadWindow() {
    if (!isTauri() || closing.current) return;
    closing.current = true;
    try {
      const ids = allPanels(state.current).flatMap((p) =>
        p.tabs.map((t) => t.id),
      );
      if (!(await confirmClose(ids))) return;
      const root = allProjects().find((p) => p.root)?.root ?? null;
      await snapshotQueue.current;
      await native("clear_snapshots");
      await windowBackend.prepareReload(root);
      location.reload();
    } catch (e) {
      report(e);
    } finally {
      closing.current = false;
    }
  }
  /** IDE: Zoom In/Out/Reset: the size of the whole IDE (its code text size), for every window. */
  function zoomIde(step: number | null) {
    const size = preferencesRef.current.ideFontSize;
    const next =
      step === null
        ? IDE_FONT_SIZE.default
        : Math.min(IDE_FONT_SIZE.max, Math.max(IDE_FONT_SIZE.min, size + step));
    if (next !== size)
      savePreferences({ ...preferencesRef.current, ideFontSize: next });
  }
  /** Asks for a template name in the palette; resolves with it, or null. */
  function askTemplateName(existing: string[]) {
    naming?.resolve(null);
    return new Promise<string | null>((resolve) =>
      setNaming({ existing, resolve }),
    );
  }
  /** A yes/no question as a palette pick list; Enter takes `action`. */
  async function confirmPick(title: string, action: string, detail?: string) {
    const answer = await choose(title, [
      { id: "yes", label: action, detail },
      { id: "no", label: "Cancel" },
    ]);
    return answer === "yes";
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
  // modules in the workspace (the focused one first). The IDE's command groups are listed
  // only while an IDE is in the workspace (Debug also while a session runs).
  const ide = palette !== null && ideOpen();
  const commands: Command[] = [
    {
      id: "launcher",
      label: "Add to Workspace…",
      shortcut: keyLabel("launcher"),
      run: openLauncher,
    },
    ...addable().map((plugin) => ({
      id: `add:${plugin.id}`,
      label: `Add to Workspace: ${plugin.name}`,
      adds: true,
      run: (mode: AddMode = "auto") =>
        void (plugin === ideProject ? addIde(mode) : create(mode, plugin)),
    })),
    {
      id: "new",
      label: "New File",
      shortcut: keyLabel("new"),
      run: () => newFile("tab"),
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
    ...(focused &&
    !pluginLimits()[focused.tabs[0].plugin]?.dock &&
    !isGuest(focused)
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
      id: "layout.save",
      label: "Save Layout as Template…",
      run: () => void saveTemplate().catch(report),
    },
    {
      id: "layout.open",
      label: "Open Layout Template…",
      run: () => void openTemplate().catch(report),
    },
    {
      id: "layout.delete",
      label: "Delete Layout Template…",
      run: () => void deleteTemplate().catch(report),
    },
    {
      id: "window.close",
      label: "Close Window",
      shortcut: keyLabel("window.close"),
      run: () => windowAction("close"),
    },
    {
      id: "window.minimize",
      label: "Minimize Window",
      shortcut: keyLabel("window.minimize"),
      run: () => windowAction("minimize"),
    },
    {
      id: "window",
      label: "New Window",
      shortcut: keyLabel("window"),
      run: () => void windowBackend.open().catch(report),
    },
    {
      id: "settings",
      label: "Workspace Settings…",
      shortcut: keyLabel("settings"),
      run: () => setSettings("general"),
    },
    {
      id: "theme",
      label: "Preferences: Color Theme…",
      run: () => void chooseTheme(),
    },
    {
      id: "icon-theme",
      label: "Preferences: File Icon Theme…",
      run: () => void chooseIconTheme(),
    },
    {
      id: "cpp-theme",
      label: "Preferences: C++ Highlight Theme…",
      run: () => void chooseCppTheme(),
    },
    {
      id: "window.reload",
      label: "Developer: Reload Window",
      run: () => void reloadWindow(),
    },
    ...(ide
      ? [
          {
            id: "view.terminal",
            label: "View: Toggle Terminal",
            shortcut: keyLabel("view.terminal"),
            run: toggleTerminal,
          },
          ...groupCommands(),
          ...(enabled("agents")
            ? AGENTS.flatMap((agent) => [
                {
                  id: `agent.${agent.id}`,
                  label: `IDE: Toggle ${agent.name}`,
                  run: () => toggleAgent(agent.id),
                },
                {
                  id: `agent.${agent.id}.new`,
                  label: `IDE: New ${agent.name} Session`,
                  run: () => openAgent(agent.id, true),
                },
              ])
            : []),
          {
            id: "ide.zoom.in",
            label: "IDE: Zoom In",
            shortcut: keyLabel("ide.zoom.in"),
            run: () => zoomIde(1),
          },
          {
            id: "ide.zoom.out",
            label: "IDE: Zoom Out",
            shortcut: keyLabel("ide.zoom.out"),
            run: () => zoomIde(-1),
          },
          {
            id: "ide.zoom.reset",
            label: "IDE: Reset Zoom",
            detail: `${preferences.ideFontSize}px`,
            run: () => zoomIde(null),
          },
        ]
      : []),
    ...(palette !== null ? moduleCommands() : []),
    // A feature turned off in Settings → IDE → Features adds no commands.
    ...(ide && enabled("cmake") ? cmakeCommands() : []),
    ...(ide && enabled("testing") ? testCommands() : []),
    ...(ide && enabled("coverage") ? coverageCommands() : []),
    ...(ide && enabled("analysis") ? analysisCommands() : []),
    ...(ide && enabled("sonarqube") ? sonarCommands() : []),
    ...((ide && enabled("debugging")) || (palette !== null && isDebugging())
      ? debugCommands(editorLine())
      : []),
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
    // The IDE's empty code area has nothing to save.
    if (active && !isEmptyArea(active.id)) void save(active.id, as);
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
    // An IDE is one whole: another one goes to the right of the whole window, not into it.
    const besideIde = plugin === ideProject && hasIde();
    // Its half of the window keeps the sidebar's width: the sidebar's share doubles first.
    const sidebars = besideIde
      ? allPanels(state.current)
          .filter((p) => p.tabs.some((t) => t.plugin === ideProject.id))
          .map((p) => {
            const s = parentOf(state.current.root, p.id);
            return s?.axis === "x" && s.first.id === p.id ? s : null;
          })
          .filter((s) => s !== null)
          .map((s) => ({ id: s.id, ratio: s.ratio }))
      : [];
    for (const s of sidebars)
      dispatch(
        {
          type: "resize",
          splitId: s.id,
          ratio: Math.min(0.6, s.ratio * 2),
        },
        true,
      );
    const opened = dispatch({
      type: "open",
      tab: { id, plugin: plugin.id },
      panelId: crypto.randomUUID(),
      splitId: crypto.randomUUID(),
      mode: besideIde ? "x" : mode,
      ...(besideIde && { whole: true }),
    });
    if (!opened)
      for (const s of sidebars)
        dispatch({ type: "resize", splitId: s.id, ratio: s.ratio }, true);
    return opened;
  }
  const hidden = (id: string) =>
    !allPanels(state.current).some((p) => p.tabs.some((t) => t.id === id));
  /**
   * Adds a tool. A Text Editor in a panel of its own starts as a page without a tab; one
   * added among tabs, or as `newFile` (New File), is an Untitled tab in place of a page.
   */
  async function create(
    mode: AddMode,
    plugin: PluginDefinition = textEditor,
    newFile = false,
    /** For an IDE: the folder chosen in the palette, or null for Empty Project. */
    project?: { root: string | null },
  ) {
    setLauncher(false);
    const refused = refusal(plugin, mode);
    if (refused) return report(refused);
    // Beside an IDE another module floats as a guest.
    const guest = plugin !== ideProject && hasIde();
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
      if (guest) restored.ids.forEach((id) => guests.current.add(id));
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
    if (guest) guests.current.add(id);
    if (!attach(id, mode, plugin)) return plugin.dispose(id);
    if (plugin === textEditor) {
      const panel = panelWith(id);
      if (!newFile && panel?.tabs.length === 1) markBlank(id);
      else dropEmptyArea(panel);
    }
    if (plugin === ideProject)
      openIde(
        id,
        project?.root ?? null,
        project !== undefined && !project.root,
      );
  }
  /**
   * Add to Workspace: IDE in the palette: Empty Project, then the folders opened last
   * (newest first), so a project opens in one step.
   */
  async function addIde(mode: AddMode) {
    // Floating (Ctrl+Shift+Enter) in a window that is already in use, past the IDE limit
    // too: the chosen project opens in a new window of its own.
    if (mode === "float" && allPanels(state.current).length)
      return void ideInNewWindow().catch(report);
    const refused = refusal(ideProject, mode);
    if (refused) return report(refused);
    const recents = await ideBackend.recents().catch(() => [] as string[]);
    const EMPTY = "<empty>"; // never a folder: those are absolute paths
    const choice = await choose("Open Project", [
      { id: EMPTY, label: "Empty Project", detail: "an IDE without a folder" },
      ...recents.map((root) => ({
        id: root,
        label: baseName(root),
        detail: root,
      })),
    ]);
    if (choice === null) return;
    await create(mode, ideProject, false, {
      root: choice === EMPTY ? null : choice,
    });
  }
  /** Add to Workspace: IDE as a floating panel: a folder, then a new window with its IDE. */
  async function ideInNewWindow() {
    const recents = await ideBackend.recents().catch(() => [] as string[]);
    const PICK = "<pick>"; // never a folder: those are absolute paths
    const choice = await choose("Open Project in New Window", [
      { id: PICK, label: "Open Folder…", detail: "choose a folder" },
      ...recents.map((root) => ({
        id: root,
        label: baseName(root),
        detail: root,
      })),
    ]);
    if (choice === null) return;
    const root = choice === PICK ? await fileBackend.chooseFolder() : choice;
    if (root) await windowBackend.open(root);
  }
  /**
   * An IDE keeps its window to itself, so its parts stay one whole: another module is added
   * beside it only as a floating panel, and it does not join other modules.
   */
  function refusal(plugin: PluginDefinition, mode: AddMode) {
    if (plugin === ideProject)
      return !hasIde() && allPanels(state.current).length
        ? "The IDE takes a window of its own. Close the other panels here, or open a new window (Ctrl+Alt+N)."
        : ideCount() >= MAX_IDES
          ? `A window holds at most ${MAX_IDES} IDEs. Open a new window (Ctrl+Alt+N) for another.`
          : null;
    return hasIde() && mode !== "float"
      ? `Beside an IDE, ${plugin.name} opens only as a floating panel (Ctrl+Shift+Enter), or in a new window (Ctrl+Alt+N).`
      : null;
  }
  /** What the launcher and palette offer; beside an IDE the others open only floating. */
  function addable() {
    return [...registry.values()].filter((p) => p.listed !== false);
  }
  /** Ctrl+N: a new file where files go in this window. */
  function newFile(mode: "tab" | "auto") {
    const code = ideOpen() ? codePanel() : null;
    if (!code) return void create(mode, textEditor, true);
    if (mode === "tab") return addTab(code.id);
    const id = codeEditor.create();
    if (
      !openAt(code.id, {
        tab: { id, plugin: codeEditor.id },
        panelId: crypto.randomUUID(),
        splitId: crypto.randomUUID(),
        mode: "auto",
        group: true,
      })
    ) {
      codeEditor.dispose(id);
      report("There is no room to split this panel");
    }
  }
  /**
   * The IDE opens as a whole around its sidebar: a status bar under all of it, an empty
   * code editor and the bottom panel under that. Parts without room are left out.
   */
  function openIde(project: string, root: string | null = null, empty = false) {
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
    markEmptyArea(code);
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
    // A window opened for a folder shows it; the first IDE of a window otherwise continues
    // with the folder opened last, unless Empty Project was chosen.
    if (root) void openFolder(project, root).catch(report);
    else if (!empty && allProjects().length === 1)
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
          (t.plugin === ideStatus.id && statusProject(t.id) === project) ||
          (t.plugin === ideAgent.id && agentProject(t.id) === project),
      )
      .map((t) => t.id);
  }
  /**
   * The tiled panels of one IDE's part of the window: the largest part of the layout around
   * its sidebar that holds no other IDE's sidebar.
   */
  function ideRegion(project: string) {
    const root = state.current.root;
    const sidebar = panelWith(project);
    if (!root || !sidebar || isFloating(state.current, sidebar.id)) return [];
    const others = allPanels(state.current)
      .filter(
        (p) =>
          p.id !== sidebar.id && p.tabs.some((t) => t.plugin === ideProject.id),
      )
      .map((p) => p.id);
    let node: Node = sidebar;
    for (;;) {
      const parent = parentOf(root, node.id);
      if (!parent || others.some((id) => contains(parent, id))) break;
      node = parent;
    }
    return panels(node).map((p) => p.id);
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
  function windowAction(action: "maximize" | "minimize" | "close") {
    if (!isTauri()) return;
    const currentWindow = getCurrentWindow();
    const request =
      action === "maximize"
        ? currentWindow.toggleMaximize()
        : action === "minimize"
          ? currentWindow.minimize()
          : currentWindow.close();
    void request.catch(report);
  }
  /** Files open as code in a window with an IDE, and as text elsewhere. */
  async function open(path?: string) {
    try {
      if (ideOpen()) {
        if (path) return void (await reveal(path));
        const id = await openFile();
        if (id && !place(id, codeEditor) && hidden(id)) codeEditor.dispose(id);
        return;
      }
      const id = await openFile(path);
      if (!id) return;
      if (!attach(id, "tab", textEditor)) {
        if (hidden(id)) textEditor.dispose(id);
        return;
      }
      dropEmptyArea(panelWith(id));
    } catch (e) {
      report(e);
    }
  }
  const panelWith = (tabId: string) =>
    allPanels(state.current).find((p) => p.tabs.some((t) => t.id === tabId));
  const ideCount = () =>
    allPanels(state.current)
      .flatMap((p) => p.tabs)
      .filter((t) => t.plugin === ideProject.id).length;
  const hasIde = () => ideCount() > 0;
  /**
   * While an IDE is open its code area stays, and a Text Editor panel stays a page to write
   * on: neither empty area has a tab to close. An editor group's page closes the group.
   */
  const emptyArea = (id: string) => isEmptyArea(id) || isBlank(id);
  const closable = (id: string) =>
    !isEmptyArea(id) && !(isBlank(id) && !grouped(panelWith(id)));
  /** The editor group around a panel, if it is one of several. */
  const grouped = (panel: PanelNode | undefined) =>
    panel ? groupRoot(state.current.root, panel.id) : null;
  const floats = (panelId: string) =>
    state.current.floating.some((f) => f.panel.id === panelId);
  /**
   * A tab splits off into a new panel beside its own. A Text Editor alone in its panel opens
   * a new, empty editor there instead: each tab owns its document; it splits into editor
   * groups inside its panel, as in Sublime Text. A code editor shows its file in the new
   * group too, as in VS Code.
   */
  const splittable = (id: string, count: number) => {
    const panel = panelWith(id);
    if (!panel || floats(panel.id)) return false;
    const plugin = pluginOf(id);
    return (
      count > 1 ||
      plugin === textEditor ||
      plugin === codeEditor ||
      plugin === codeView
    );
  };
  function splitTab(id: string, axis: "x" | "y", before = false) {
    const panel = panelWith(id);
    if (!panel || !splittable(id, panel.tabs.length)) return;
    const ids = { panelId: crypto.randomUUID(), splitId: crypto.randomUUID() };
    const plugin = pluginOf(id);
    const code = isCode(panel);
    const group = plugin === textEditor || code;
    if (plugin === codeEditor || plugin === codeView) {
      const fresh = createCodeView(viewDocument(id) ?? id);
      if (
        !openAt(panel.id, {
          tab: { id: fresh, plugin: codeView.id },
          ...ids,
          mode: axis,
          before,
          group,
        })
      ) {
        codeView.dispose(fresh);
        report("There is no room to split this panel");
      }
      return;
    }
    if (panel.tabs.length > 1) {
      dispatch({
        type: "drop",
        sourcePanel: panel.id,
        tabId: id,
        targetPanel: panel.id,
        edge: axis === "x" ? "right" : "bottom",
        ...ids,
        group,
      });
      return;
    }
    const fresh = plugin.create();
    // A new editor group is a page to write on.
    if (group) markBlank(fresh);
    if (
      !openAt(panel.id, {
        tab: { id: fresh, plugin: plugin.id },
        ...ids,
        mode: axis,
        group,
      })
    ) {
      plugin.dispose(fresh);
      report("There is no room to split this panel");
    }
  }
  /**
   * A new, empty tab in a panel of text or code editors. In the IDE's empty code area the
   * new code editor takes the area's place.
   */
  function addTab(panelId: string, make?: () => string) {
    const panel = allPanels(state.current).find((p) => p.id === panelId);
    // Whichever tab shows in the code area, a new one there is a code file.
    const plugin = panel?.active
      ? isCode(panel)
        ? codeEditor
        : pluginOf(panel.active)
      : textEditor;
    const id = make ? make() : plugin.create();
    if (
      !openAt(panelId, {
        tab: { id, plugin: plugin.id },
        panelId: crypto.randomUUID(),
        splitId: crypto.randomUUID(),
        mode: "tab",
      })
    )
      return plugin.dispose(id);
    dropEmptyArea(panel);
  }
  /** An empty code or text area gives way to the first tab added to its panel. */
  function dropEmptyArea(panel: PanelNode | undefined) {
    for (const tab of panel?.tabs ?? [])
      if (emptyArea(tab.id)) {
        dispatch({ type: "close", tabId: tab.id });
        pluginOf(tab.id).dispose(tab.id);
      }
  }
  /**
   * From a panel's + menu or folder: the file (without `path`, the one chosen in the
   * dialog) opens as a tab of that panel, as text or code like the panel.
   */
  async function openIn(panelId: string, path?: string) {
    try {
      const panel = allPanels(state.current).find((p) => p.id === panelId);
      const plugin = panel && isCode(panel) ? codeEditor : textEditor;
      const id = await openFile(path);
      if (!id) return;
      if (panelWith(id)) return void attach(id, "tab", plugin);
      const fresh = allPanels(state.current).find((p) => p.id === panelId);
      if (
        !fresh ||
        !openAt(panelId, {
          tab: { id, plugin: plugin.id },
          panelId: crypto.randomUUID(),
          splitId: crypto.randomUUID(),
          mode: "tab",
        })
      ) {
        if (!attach(id, "tab", plugin) && hidden(id)) plugin.dispose(id);
        return;
      }
      dropEmptyArea(fresh);
    } catch (e) {
      report(e);
    }
  }
  const terminalPanel = (panelId: string) => {
    const panel = allPanels(state.current).find((p) => p.id === panelId);
    return !!panel?.active && pluginOf(panel.active) === terminal;
  };
  /**
   * A Terminal panel's + menu: a new terminal with one of the detected shells, the default
   * one marked. Outside the desktop app it offers the default shell only.
   */
  async function shellItems(panelId: string): Promise<MenuItem[]> {
    const choices = await loadShells().catch(() => null);
    if (!choices?.shells.length)
      return [{ label: "Default Shell", action: () => addTab(panelId) }];
    const preferred = choices.selected ?? choices.system;
    return choices.shells.map((shell) => ({
      label: shell.id === preferred ? `${shell.name} (default)` : shell.name,
      action: () => addTab(panelId, () => createSession(null, null, shell.id)),
    }));
  }
  /** A text or code editor panel's + menu, as in Sublime Text's File menu. */
  function addItems(panelId: string): MenuItem[] | Promise<MenuItem[]> {
    if (terminalPanel(panelId)) return shellItems(panelId);
    return [
      {
        label: "New File",
        shortcut: keyLabel("new"),
        action: () => addTab(panelId),
      },
      {
        label: "Open File…",
        shortcut: keyLabel("open"),
        action: () => void openIn(panelId),
      },
      ...(textPanel(panelId)
        ? [
            {
              label: "Open Folder…",
              action: () => void openPanelFolder(panelId).catch(report),
            },
          ]
        : []),
    ];
  }
  /**
   * Files from the File Manager open as Text Editor tabs: in the panel they were dropped on,
   * else in the last focused Text Editor panel (or any), else beside the File Manager `from`
   * in its panel (else in a new panel beside). A file that is not text opens in its default
   * application, as before, unless `outside` is false (a Markdown link, whose text may hide
   * what it points at): then it opens nowhere and a notice says so.
   */
  async function openText(
    paths: string[],
    panelId?: string,
    from?: string,
    {
      outside = true,
      into,
    }: {
      outside?: boolean;
      /** The panel the files join as tabs, whatever it shows (`mozaik -t` in a terminal). */
      into?: string;
    } = {},
  ) {
    const elsewhere = async (path: string) => {
      if (outside) return fileSystem.open(path).catch(report);
      report(
        `${path} is not a text file. A Markdown link opens only text files here; open it from the File Manager.`,
      );
    };
    for (const path of paths) {
      if (!textLike(path)) {
        await elsewhere(path);
        continue;
      }
      let id: string | null;
      try {
        id = await openFile(path);
      } catch (e) {
        if (notText(e)) await elsewhere(path);
        else report(e);
        continue;
      }
      if (!id) continue;
      if (panelWith(id)) {
        attach(id, "tab", textEditor);
        continue;
      }
      const panels = allPanels(state.current);
      const target =
        (into && allPanels(state.current).some((p) => p.id === into) && into) ||
        (panelId && textPanel(panelId) && panelId) ||
        (lastText.current && textPanel(lastText.current) && lastText.current) ||
        panels.find((p) => textPanel(p.id))?.id ||
        (from && panelWith(from)?.id);
      if (
        target &&
        openAt(target, {
          tab: { id, plugin: textEditor.id },
          panelId: crypto.randomUUID(),
          splitId: crypto.randomUUID(),
          mode: "tab",
        })
      ) {
        dropEmptyArea(panelWith(id));
        continue;
      }
      if (!attach(id, "auto", textEditor) && hidden(id)) textEditor.dispose(id);
    }
  }
  /**
   * A terminal in `directory` (the File Manager's Open in Terminal): a tab of the last
   * focused Terminal panel (or any), else a new panel beside.
   */
  function openTerminal(directory: string) {
    const id = createSession(directory);
    const target =
      (lastTerminal.current &&
        terminalPanel(lastTerminal.current) &&
        lastTerminal.current) ||
      allPanels(state.current).find((p) => terminalPanel(p.id))?.id;
    if (
      target &&
      openAt(target, {
        tab: { id, plugin: terminal.id },
        panelId: crypto.randomUUID(),
        splitId: crypto.randomUUID(),
        mode: "tab",
      })
    )
      return;
    if (!attach(id, "auto", terminal)) {
      terminal.dispose(id);
      report("There is no room for a terminal here");
    }
  }
  /**
   * A template keeps the layout only: the IDE is kept as its project sidebar (it opens its
   * other parts around it again) and a panel's text tabs as one page to write on.
   */
  const templateTab = (tab: { plugin: string }) =>
    [
      idePanel,
      ideStatus,
      ideAgent,
      codeEditor,
      codeView,
      fileTab,
      diffPlugin,
      coveragePlugin,
    ].some((p) => p.id === tab.plugin)
      ? null
      : tab.plugin;
  async function saveTemplate() {
    if (!state.current.root && !state.current.floating.length)
      return report("The workspace is empty: there is no layout to save");
    const name = await askTemplateName(
      (await layoutsBackend.list()).map((t) => t.name),
    );
    if (!name) return;
    const same = (await layoutsBackend.list()).some(
      (t) => t.name.toLowerCase() === name.toLowerCase(),
    );
    if (
      same &&
      !(await confirmPick(
        `Replace the template “${name}” with this layout?`,
        "Replace",
        "The saved layout is overwritten",
      ))
    )
      return;
    await layoutsBackend.save(
      templateOf(
        name,
        state.current,
        latest.current.bounds,
        templateTab,
        (plugin) => plugin === textEditor.id,
      ),
      same,
    );
  }
  async function pickTemplate(title: string) {
    const templates = await layoutsBackend.list();
    if (!templates.length) {
      report(
        "There are no layout templates yet. Save one with Save Layout as Template…",
      );
      return null;
    }
    const name = await choose(
      title,
      templates.map((t) => ({ id: t.name, label: t.name })),
    );
    return templates.find((t) => t.name === name) ?? null;
  }
  /**
   * Opens a template in this window. Its panels replace the workspace's, after asking and
   * after the usual questions about unsaved files; every module starts fresh.
   */
  async function openTemplate() {
    const template = await pickTemplate("Open Layout Template");
    if (!template) return;
    const all = allPanels(state.current);
    if (all.length) {
      if (
        !(await confirmPick(
          `Close every panel of this window and open “${template.name}”?`,
          "Close and Open",
          "Unsaved files are asked about first",
        ))
      )
        return;
      await close(
        all.flatMap((p) => p.tabs.map((t) => t.id)),
        false,
      );
      // Cancelled at a question about unsaved changes.
      if (allPanels(state.current).length) return;
    }
    // A single-panel module (Tasks, Notes) open in another window is left out here.
    const plugins = new Set<string>();
    const walk = (node: typeof template.root): void => {
      if (!node) return;
      if (node.kind === "panel") node.tabs.forEach((p) => plugins.add(p));
      else [node.first, node.second].forEach(walk);
    };
    walk(template.root);
    template.floating.forEach((f) => f.tabs.forEach((p) => plugins.add(p)));
    // An older template may hold an IDE beside other modules; the IDE keeps its window.
    const onlyIde = plugins.has(ideProject.id);
    const claimed = new Set<string>();
    for (const id of plugins) {
      const plugin = registry.get(id);
      if (plugin?.claim && (await plugin.claim().catch(() => false)))
        claimed.add(id);
    }
    const created: { id: string; plugin: PluginDefinition }[] = [];
    const next = workspaceOf(
      template,
      latest.current.bounds,
      (id) => {
        const plugin = registry.get(id);
        if (
          !plugin ||
          templateTab({ plugin: plugin.id }) === null ||
          (onlyIde && plugin !== ideProject) ||
          (plugin.claim && !claimed.delete(id))
        )
          return null;
        const tab = plugin.create();
        if (plugin === textEditor) markBlank(tab);
        created.push({ id: tab, plugin });
        return { id: tab, plugin: plugin.id };
      },
      () => crypto.randomUUID(),
    );
    if (!created.length || !dispatch({ type: "load", workspace: next })) {
      created.forEach(({ id, plugin }) => plugin.dispose(id));
      if (!created.length)
        report("None of this template's tools can open here");
      return;
    }
    setLayoutName(template.name);
    for (const { id, plugin } of created)
      if (plugin === ideProject) openIde(id);
  }
  async function deleteTemplate() {
    const template = await pickTemplate("Delete Layout Template");
    if (
      template &&
      (await confirmPick(
        `Delete the template “${template.name}”?`,
        "Delete",
        "Open panels are not affected",
      ))
    )
      await layoutsBackend.delete(template.name);
  }
  /** Whether a panel shows a Text Editor, which can show a folder at its left. */
  function textPanel(panelId: string) {
    const panel = allPanels(state.current).find((p) => p.id === panelId);
    return !!panel?.active && pluginOf(panel.active) === textEditor;
  }
  function isCodeTab(plugin: string) {
    return (
      plugin === codeEditor.id ||
      plugin === codeView.id ||
      plugin === fileTab.id ||
      plugin === diffPlugin.id ||
      plugin === coveragePlugin.id
    );
  }
  function isCode(p: PanelNode) {
    return p.tabs.some((t) => isCodeTab(t.plugin));
  }
  /**
   * The last focused code panel, else any. With two IDEs in the window and a `project`,
   * only the code panels in that project's part of the window count.
   */
  function codePanel(project?: string | null) {
    let all = allPanels(state.current);
    if (project && allProjects().filter((p) => panelWith(p.id)).length > 1) {
      const region = new Set(ideRegion(project));
      if (region.size) all = all.filter((p) => region.has(p.id));
    }
    return (
      all.find((p) => p.id === lastCode.current && isCode(p)) ??
      all.find(isCode)
    );
  }
  /** Whether a tab dropped on this panel's edge makes an editor group of the code area. */
  function codeTarget(panelId: string) {
    const panel = allPanels(state.current).find((p) => p.id === panelId);
    return !!panel && isCode(panel);
  }
  /** The code panels from the left and top down: the editor groups. */
  function codeGroups() {
    return panels(state.current.root).filter(isCode);
  }
  function focusGroup(index: number) {
    const panel = codeGroups()[index];
    if (panel) dispatch({ type: "activate", panelId: panel.id });
  }
  /** Moves the active tab one group on; past the last group it opens a new one, as in VS Code. */
  function moveTab(step: 1 | -1) {
    const panel = codePanel();
    if (!panel) return;
    const groups = codeGroups();
    const target = groups[groups.findIndex((p) => p.id === panel.id) + step];
    if (!target && panel.tabs.length < 2) return;
    dispatch({
      type: "drop",
      sourcePanel: panel.id,
      tabId: panel.active,
      targetPanel: target?.id ?? panel.id,
      edge: target ? undefined : step > 0 ? "right" : "left",
      panelId: crypto.randomUUID(),
      splitId: crypto.randomUUID(),
      group: true,
    });
  }
  /** VS Code's commands for editor groups. */
  function groupCommands(): Command[] {
    const split =
      (axis: "x" | "y", before = false) =>
      () => {
        const panel = codePanel();
        if (panel && !emptyArea(panel.active))
          splitTab(panel.active, axis, before);
      };
    const multiple = codeGroups().length > 1;
    return [
      {
        id: "code.split.right",
        label: "View: Split Editor Right",
        shortcut: keyLabel("code.split.right"),
        run: split("x"),
      },
      {
        id: "code.split.left",
        label: "View: Split Editor Left",
        run: split("x", true),
      },
      {
        id: "code.split.down",
        label: "View: Split Editor Down",
        run: split("y"),
      },
      {
        id: "code.split.up",
        label: "View: Split Editor Up",
        run: split("y", true),
      },
      {
        id: "code.move.next",
        label: "View: Move Editor into Next Group",
        shortcut: keyLabel("code.move.next"),
        run: () => moveTab(1),
      },
      {
        id: "code.move.previous",
        label: "View: Move Editor into Previous Group",
        shortcut: keyLabel("code.move.previous"),
        run: () => moveTab(-1),
      },
      ...(multiple
        ? [1, 2, 3].map((n) => ({
            id: `code.group.${n}`,
            label: `View: Focus ${["First", "Second", "Third"][n - 1]} Editor Group`,
            shortcut: keyLabel(`code.group.${n}`),
            run: () => focusGroup(n - 1),
          }))
        : []),
      ...(multiple
        ? [
            {
              id: "code.group.close",
              label: "View: Close Editor Group",
              run: () => {
                const panel = codePanel();
                if (panel) void close(panel.tabs.map((t) => t.id));
              },
            },
          ]
        : []),
    ];
  }
  /** The project of the code file in use, else the window's first IDE. */
  function currentProject() {
    const code = currentCode();
    const path = code ? getDocument(code).path : null;
    return (
      (path && projectFor(path)?.id) ||
      allPanels(state.current)
        .flatMap((p) => p.tabs)
        .find((t) => t.plugin === ideProject.id)?.id ||
      null
    );
  }
  /**
   * The Claude Code and Codex buttons and commands, as VS Code's extensions: a project has one
   * agents panel, in the layout only while it is shown. Opening it shows the agent's last
   * session, or starts one in the project's folder; `fresh` always starts one.
   */
  function openAgent(agent: AgentName, fresh = false) {
    const project = currentProject();
    const root = project && getProject(project)?.root;
    if (!project || !root)
      return report("Open a folder in the IDE to run a coding agent there");
    const id = ensureAgentPanel(project, root);
    const shown = panelWith(id);
    if (shown) dispatch({ type: "activate", panelId: shown.id });
    else {
      const beside = codeGroups().pop() ?? idePanelOf(project)?.panel;
      const remembered = agentPanelOf(project)?.codeShare;
      const opens = (ratio: number) =>
        openAt(beside!.id, {
          tab: { id, plugin: ideAgent.id },
          panelId: crypto.randomUUID(),
          splitId: crypto.randomUUID(),
          mode: "x",
          ratio,
        });
      if (!beside || !((remembered && opens(remembered)) || opens(0.6)))
        return report("There is no room beside the code for a coding agent");
    }
    if (fresh) addAgentSession(id, agent);
    else showAgent(id, agent);
  }
  function currentAgents() {
    const project = currentProject();
    return project ? agentPanelOf(project) : null;
  }
  /** While the panel is shown, the icons are on it instead of on the code panels. */
  function agentsShown() {
    const known = currentAgents();
    return !!known && !!panelWith(known.id);
  }
  function agentSessions(agent: AgentName) {
    const known = currentAgents();
    return known ? sessionsOf(known, agent).length : 0;
  }
  /** A command's toggle: the agent shown minimizes the panel, any other opens. */
  function toggleAgent(agent: AgentName) {
    const known = currentAgents();
    if (
      known &&
      panelWith(known.id) &&
      known.agent === agent &&
      sessionsOf(known, agent).length
    )
      hideAgents(known.id);
    else openAgent(agent);
  }
  /** Takes the panel out of the layout, without ending its sessions, and keeps its width. */
  function hideAgents(id: string) {
    const panel = panelWith(id);
    if (!panel) return;
    const split = parentOf(state.current.root, panel.id);
    if (split)
      rememberCodeShare(
        id,
        split.second.id === panel.id ? split.ratio : 1 - split.ratio,
      );
    dispatch({ type: "close", tabId: id });
    const editor = codePanel();
    if (editor) dispatch({ type: "activate", panelId: editor.id });
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
      pluginLimits(),
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
  function place(
    id: string,
    plugin: PluginDefinition,
    side = false,
    file: string | null = null,
  ) {
    const path =
      file ??
      (plugin === codeEditor && hasDocument(id) ? getDocument(id).path : null);
    // With two IDEs a file goes to the code editors of the IDE whose project holds it.
    const project = (path && projectFor(path)?.id) || null;
    const code = codePanel(project);
    // A file split into views shows in the group in use if one of them is there.
    const here = code?.tabs.find((t) => viewDocument(t.id) === id);
    if (code && here) {
      dispatch({ type: "activate", panelId: code.id, tabId: here.id });
      preferView(here.id);
      return true;
    }
    if (panelWith(id)) return attach(id, "tab", plugin);
    const tab = { id, plugin: plugin.id };
    const ids = { panelId: crypto.randomUUID(), splitId: crypto.randomUUID() };
    if (code) {
      // The first file takes the place of the IDE's empty editor; a drawing joins it, so
      // the code area stays.
      const blanks =
        side || !isCodeTab(plugin.id)
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
        group: side,
      });
      if (opened)
        for (const id of blanks) {
          dispatch({ type: "close", tabId: id });
          codeEditor.dispose(id);
        }
      return opened;
    }
    const bottom = idePanelOf(project) ?? idePanelOf(null);
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
  // A panel's folder goes with the panel.
  useEffect(
    () => keepFolders(new Set(allPanels(workspace).map((p) => p.id))),
    [workspace],
  );
  useEffect(() => {
    setHost({
      showCode: (id, options) => place(id, codeEditor, options?.side),
      showDrawing: (path, options) => {
        const module = fileModules.find((m) => m.files.isPath(path));
        if (!module) return false;
        void module.files
          .openFile(path)
          .then((id) => {
            // An already open drawing is only activated; never dispose it.
            if (
              id &&
              !place(id, module.plugin, options?.side, path) &&
              hidden(id)
            )
              module.plugin.dispose(id);
          })
          .catch(report);
        return true;
      },
      showFile(path, options) {
        const existing = fileTabFor(path);
        const id = existing ?? createFileTab(path);
        const shown = place(id, fileTab, options?.side, path);
        if (!shown && !existing) fileTab.dispose(id);
        return shown;
      },
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
        if (!place(id, diffPlugin, false, path) && !existing)
          diffPlugin.dispose(id);
      },
      showCommitDiff(path, commit) {
        const existing = commitDiffFor(path, commit.hash);
        const id = existing ?? createDiff(path, false, commit);
        if (!place(id, diffPlugin, false, path) && !existing)
          diffPlugin.dispose(id);
      },
      showCoverage(project, path) {
        const existing = coverageTabFor(path);
        const id = existing ?? createCoverageTab(project, path);
        if (!place(id, coveragePlugin, false, path) && !existing)
          coveragePlugin.dispose(id);
      },
      showProblems(path) {
        const id = showPanel(path ?? null, "problems", true);
        if (!id) report("There is no room for the IDE panel here");
      },
      showPanel: (path, view, channel) => showPanel(path, view, false, channel),
      openTerminal(folder) {
        const id = showPanel(folder, "terminal", true, undefined, folder);
        if (!id) report("There is no room for the IDE panel here");
      },
      revealInFileManager(folder) {
        // Beside an IDE a File Manager floats as a guest.
        const id = createFileManager(folder);
        guests.current.add(id);
        if (!attach(id, "float", fileManager)) fileManager.dispose(id);
      },
      pick: (title, items) => choose(title, items),
      quickOpen: (prefix) => openPalette(prefix),
      openSettings: () => setSettings("ide"),
      closeTab: (id) => void close([id]),
      hideAgents,
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
    afterSave.add(analyzeAfterSave);
    if (isTauri()) void loadAnalysis().catch(() => {});
    return () => {
      setHost(null);
      beforeSave.delete(formatBeforeSave);
      afterSave.delete(analyzeAfterSave);
    };
  }, []);
  useEffect(() => {
    if (!focused) return;
    const plugin = focused.tabs.find((t) => t.id === focused.active)?.plugin;
    if (plugin && isCodeTab(plugin) && plugin !== codeEditor.id)
      lastCode.current = focused.id;
    if (plugin === textEditor.id) lastText.current = focused.id;
    if (plugin === terminal.id) lastTerminal.current = focused.id;
    const shown =
      plugin === codeEditor.id
        ? focused.active
        : plugin === codeView.id
          ? viewDocument(focused.active)
          : null;
    if (shown) {
      lastCode.current = focused.id;
      const path = hasDocument(shown) ? getDocument(shown).path : null;
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
    /** For the Terminal view: a new terminal started in this folder. */
    directory?: string,
  ) {
    const project = path ? (projectFor(path)?.id ?? null) : null;
    const found = idePanelOf(project) ?? (project ? null : idePanelOf(null));
    const id = found?.tab ?? openIdePanel(project ?? "");
    if (!id) return null;
    if (directory) newTerminal(id, null, directory);
    else showView(id, view, channel);
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
      const shown =
        !id ||
        (ideOpen()
          ? place(id, module.plugin, false, path)
          : attach(id, "tab", module.plugin));
      if (id && !shown && hidden(id)) module.plugin.dispose(id);
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
  /** `keepPages`: a Text Editor panel losing its last tab keeps a page (not for Close Panel). */
  async function close(ids: string[], keepPages = true) {
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
    // The last IDE takes its code editors and comparisons with it; one of two IDEs takes
    // those in its own part of the window.
    const closingIdes = ids.filter((id) => pluginOf(id) === ideProject);
    const region = new Set(
      ideStays ? closingIdes.flatMap((id) => ideRegion(id)) : [],
    );
    if (closingIdes.length)
      ids = [
        ...new Set([
          ...ids,
          ...all.flatMap((p) =>
            isCode(p) && (!ideStays || region.has(p.id))
              ? p.tabs.map((t) => t.id)
              : [],
          ),
        ]),
      ];
    // A file split into views stays open with what is left: a view that stays takes the
    // place of the document's own tab, and closes in its stead.
    for (const id of [...ids]) {
      if (pluginOf(id) !== codeEditor) continue;
      const stays = viewsOfDocument(id).find(
        (view) => panelWith(view) && !ids.includes(view),
      );
      if (!stays) continue;
      dispatch({
        type: "swapTabs",
        first: { id, plugin: codeEditor.id },
        second: { id: stays, plugin: codeView.id },
      });
      ids = ids.map((other) => (other === id ? stays : other));
    }
    // Views go before their document.
    ids = [
      ...ids.filter((id) => viewDocument(id)),
      ...ids.filter((id) => !viewDocument(id)),
    ];
    const wasCode = allPanels(state.current).some(
      (p) => p.id === state.current.focused && isCode(p),
    );
    try {
      if (!(await confirmClose(ids))) return;
      // Otherwise a code area closing its last tab keeps an empty area, as in VS Code; one of
      // several editor groups goes.
      const groupStays = () =>
        allPanels(state.current).some(
          (p) => isCode(p) && p.tabs.some((t) => !ids.includes(t.id)),
        );
      if (ideStays)
        for (const panel of allPanels(state.current)) {
          if (
            !isCode(panel) ||
            region.has(panel.id) ||
            panel.tabs.some((t) => !ids.includes(t.id))
          )
            continue;
          if (groupStays()) continue;
          const empty = panel.tabs.find((t) => isEmptyArea(t.id));
          if (empty) {
            ids = ids.filter((id) => id !== empty.id);
            continue;
          }
          const code = codeEditor.create();
          markEmptyArea(code);
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
      // A Text Editor panel closing its last tab stays a page to write on, as in Sublime Text.
      if (keepPages)
        for (const panel of allPanels(state.current)) {
          if (
            isCode(panel) ||
            panel.tabs.some((t) => !ids.includes(t.id)) ||
            !panel.tabs.some((t) => t.plugin === textEditor.id)
          )
            continue;
          // An editor group with nothing left goes; its line goes with it.
          const group = grouped(panel);
          if (
            group &&
            panels(group).some(
              (p) =>
                p.id !== panel.id && p.tabs.some((t) => !ids.includes(t.id)),
            )
          )
            continue;
          const page = panel.tabs.find((t) => isBlank(t.id));
          if (page) {
            ids = ids.filter((id) => id !== page.id);
            continue;
          }
          const fresh = textEditor.create();
          markBlank(fresh);
          dispatch({ type: "activate", panelId: panel.id });
          if (
            !dispatch({
              type: "open",
              tab: { id: fresh, plugin: textEditor.id },
              panelId: crypto.randomUUID(),
              splitId: crypto.randomUUID(),
              mode: "tab",
            })
          )
            textEditor.dispose(fresh);
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
      // The focus stays among the code editors when a group goes.
      const editor = wasCode && codePanel();
      if (
        editor &&
        !allPanels(state.current).some(
          (p) => p.id === state.current.focused && isCode(p),
        )
      )
        dispatch({ type: "activate", panelId: editor.id });
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
    // The agents panel only minimizes: closing it would end every session in it.
    if (pluginOf(panel.active) === ideAgent) return hideAgents(panel.active);
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
    // A Text Editor closes with all its editor groups.
    const group = grouped(panel);
    if (!project)
      return close(
        (group ? panels(group) : [panel]).flatMap((p) =>
          p.tabs.map((t) => t.id),
        ),
        false,
      );
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
      // Only the WebView's reload is stopped: the event still reaches the File Manager's
      // Refresh and a terminal's shell.
      if (reloadsPage(event)) event.preventDefault();
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
          pluginLimits(),
        );
        if (id) dispatch({ type: "activate", panelId: id });
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      // Debug keys (F5, F10, …) act while they have something to do, except in a terminal,
      // File Manager or drawing, which keep their own F keys.
      const debugKey = DEBUG_KEYS.find((id) => matches(event, id));
      if (debugKey) {
        const run =
          (ideOpen() && enabled("debugging")) || isDebugging()
            ? debugShortcut(debugKey, editorLine())
            : null;
        const target = event.target as Element | null;
        if (
          run &&
          !target?.closest?.(
            '.terminal-host, .excalidraw, .panel[data-plugin="file-manager"]',
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          void Promise.resolve().then(run).catch(report);
          return;
        }
      }
      const actions: [string, () => void][] = [
        ["launcher", openLauncher],
        ["module.close", () => void closeModule()],
        ["window.close", () => windowAction("close")],
        ["window.minimize", () => windowAction("minimize")],
        ["window", () => void windowBackend.open().catch(report)],
        ["new", () => newFile("tab")],
        ["new.split", () => newFile("auto")],
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
        ["settings", () => setSettings("general")],
        ["view.terminal", toggleTerminal],
        ["ide.zoom.in", () => ideOpen() && zoomIde(1)],
        ["ide.zoom.out", () => ideOpen() && zoomIde(-1)],
        [
          "code.split.right",
          () => {
            const panel = codePanel();
            if (panel && !emptyArea(panel.active)) splitTab(panel.active, "x");
          },
        ],
        ["code.group.1", () => focusGroup(0)],
        ["code.group.2", () => focusGroup(1)],
        ["code.group.3", () => focusGroup(2)],
        ["code.move.next", () => moveTab(1)],
        ["code.move.previous", () => moveTab(-1)],
        ["palette", () => openPalette(">")],
        ["palette.files", () => openPalette("")],
        ["palette.symbols", () => openPalette("@")],
      ];
      const found = actions.find(([id]) => matches(event, id));
      if (!found) return;
      // Editor group keys belong to the code area; elsewhere they stay with the module.
      if (
        /^code\.(split|group|move)/.test(found[0]) &&
        !allPanels(state.current).some(
          (p) => p.id === state.current.focused && isCode(p),
        )
      )
        return;
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
      // A terminal copies its selection with Ctrl+Shift+C, as terminals do; without a
      // selection the panel closes.
      if (
        found[0] === "module.close" &&
        target?.closest?.(".terminal-host")?.querySelector("[data-selection]")
      )
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
    preferencesRef.current = next;
    setPreferences(next);
    applyTheme(next.theme);
    document.documentElement.style.setProperty(
      "--ide-font-size",
      `${next.ideFontSize}px`,
    );
    setIdeZoom(next.ideFontSize / IDE_FONT_SIZE.default);
    setCustom(next.keybindings);
    setTodoTags(next.todoTags);
    setDisabledFeatures(next.ideDisabledFeatures ?? []);
    setIconTheme(next.ideIconTheme ?? DEFAULT_ICON_THEME);
    setPinsPlacement(next.pinsPlacement ?? "menu");
    setMinimap({
      shown: next.ideMinimap ?? true,
      width: next.ideMinimapWidth ?? MINIMAP_WIDTH.default,
      scale: next.ideMinimapScale ?? 1,
    });
    setCppTheme(next.ideCppTheme);
    setDiffChangesOnly(next.ideDiffChangesOnly ?? false);
    document.documentElement.style.setProperty(
      "--palette-zoom",
      String((next.paletteSize ?? 100) / 100),
    );
    setWordWrap(next.wordWrap);
    applyFonts(next.fonts);
    applyFontSizes(next.fontSizes ?? defaultFontSizes);
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
    // `mozaik -t <file>` in one of this window's terminals: beside that Terminal tab, or
    // in the code editors when an IDE terminal or coding agent ran it.
    void getCurrentWebviewWindow()
      .listen<TextRequest>("text-request", (event) => {
        const { terminal: session, path } = event.payload;
        const panel = panelWith(session);
        const options = { outside: false };
        if (panel && pluginOf(session) === terminal)
          void openText([path], undefined, undefined, {
            ...options,
            into: panel.id,
          }).catch(report);
        else if (ideOpen()) void reveal(path).catch(report);
        else void openText([path], undefined, undefined, options).catch(report);
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
    setTextOpener({
      open: (paths, panelId, from) =>
        void openText(paths, panelId, from).catch(report),
      accepts: textPanel,
    });
    setTerminalOpener(openTerminal);
    // A Markdown preview's link: beside code as code (pictures as file tabs), else as text.
    setMarkdownLinkOpener((from, path) => {
      const panel = panelWith(from);
      if (panel && isCode(panel)) return void reveal(path).catch(report);
      // Never in another application: a link's text and tooltip can name another file, and
      // types such as .rdp, .iqy or .docm are not programs yet act on their own.
      void openText([path], panel?.id, undefined, { outside: false }).catch(
        report,
      );
    });
    return () => {
      setMarkdownLinkOpener(null);
      setTextOpener(null);
      setTerminalOpener(null);
    };
  }, []);
  // A window opened for a folder (File Manager's Open in IDE, `mozaik -i`) starts with an
  // IDE on it; one opened for a file (`mozaik -t` outside a Mozaik terminal) shows it.
  useEffect(() => {
    if (!isTauri()) return;
    void windowBackend
      .takeStart()
      .then((start) => {
        if (!start) return;
        if (start.kind === "text")
          return openText([start.path], undefined, undefined, {
            outside: false,
          });
        const id = ideProject.create();
        if (attach(id, "auto", ideProject)) openIde(id, start.path);
        else ideProject.dispose(id);
      })
      .catch(report);
  }, []);
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
    if (module && ideOpen())
      return report(
        `A window with an IDE holds only the IDE. Recover ${item.name} in a new window.`,
      );
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
    if (ideOpen() ? place(id, codeEditor) : attach(id, "tab")) {
      // Keep the original snapshot until the recovered document has its own durable snapshot.
      await native("write_snapshot", { id, snapshot: item });
      await native("discard_recovery", { key: item.key });
      setRecoveries((list) => list.filter((r) => r.key !== item.key));
    } else if (hidden(id)) textEditor.dispose(id);
  }
  return (
    <main className="shell">
      {/* The status line doubles as the window's drag strip (double-click maximizes). Its
          centered command control opens the existing palette over the same place. */}
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
        <button
          className="command-center"
          aria-label="Open command palette"
          title={`${windowName} — ${keyLabel("palette")}`}
          onClick={() => openPalette(">")}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <SearchIcon />
          <span>{projectName ?? "Command Palette"}</span>
        </button>
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
      <FixPreview />
      <div className="workspace-area" ref={area}>
        {workspace.root || workspace.floating.length ? (
          <WorkspaceView
            state={workspace}
            bounds={bounds}
            control={control}
            limits={pluginLimits()}
            dispatch={dispatch}
            close={(ids) => void close(ids)}
            closable={closable}
            dockable={(panel) => !isGuest(panel)}
            ide={hasIde()}
            // A Text Editor's page has no tab to close: its button closes the panel.
            closePanel={(panel) =>
              isBlank(panel.active)
                ? () =>
                    void close(
                      panel.tabs.map((t) => t.id),
                      false,
                    )
                : // An empty editor group goes while another stays.
                  isEmptyArea(panel.active) && codeGroups().length > 1
                  ? () => void close(panel.tabs.map((t) => t.id))
                  : null
            }
            tools={(panel) =>
              isCode(panel) && enabled("agents") && !agentsShown()
                ? AGENTS.map((agent) => (
                    <AgentButton
                      key={agent.id}
                      agent={agent.id}
                      label={`Open ${agent.name}`}
                      count={agentSessions(agent.id)}
                      pressed={false}
                      onClick={() => openAgent(agent.id)}
                    />
                  ))
                : null
            }
            split={splitTab}
            splittable={splittable}
            addTab={addTab}
            addItems={addItems}
            addLabel={(panelId) =>
              terminalPanel(panelId) ? "New Terminal" : "New File or Open File"
            }
            aside={(panelId, tabId) =>
              pluginOf(tabId) === textEditor && (
                <FolderSidebar
                  panel={panelId}
                  onOpen={(path) => void openIn(panelId, path)}
                />
              )
            }
            canAdd={(id) =>
              pluginOf(id) === textEditor ||
              pluginOf(id) === terminal ||
              isCodeTab(pluginOf(id).id)
            }
            hidden={emptyArea}
          />
        ) : (
          <section className="empty">
            <img className="workspace-mark" src="/mozaik.svg" alt="" />
            <h1>A little space to think.</h1>
            <p>
              Press <kbd>{keyLabel("palette")}</kbd> for commands.
            </p>
          </section>
        )}
      </div>
      {launcher && (
        <Launcher
          plugins={addable()}
          onPick={(plugin, mode) => {
            // A floating IDE beside other panels opens in a new window (`addIde`).
            if (plugin === ideProject && mode === "float") {
              setLauncher(false);
              void addIde(mode);
            } else void create(mode, plugin);
          }}
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
          selected={pick.options?.selected}
          onActive={pick.options?.preview}
          commands={pick.items.map((item) => ({ ...item, run: () => {} }))}
          onPick={(item) => closePick(item.id)}
          onCancel={() => closePick(null)}
        />
      )}
      {settings && (
        <Settings
          tab={settings}
          modifier={modifier}
          preferences={preferences}
          ask={ask}
          onClose={() => setSettings(null)}
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
      {naming && (
        <NamePrompt
          title="Save Layout as Template"
          placeholder="Template name"
          maxLength={60}
          action={(name) =>
            naming.existing.some((e) => e.toLowerCase() === name.toLowerCase())
              ? `Replace the template “${name}” with this layout`
              : `Save this layout as “${name}”`
          }
          existing={naming.existing}
          existingCaption="saved templates"
          onSubmit={(name) => {
            setNaming(null);
            naming.resolve(name);
          }}
          onCancel={() => {
            setNaming(null);
            naming.resolve(null);
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
