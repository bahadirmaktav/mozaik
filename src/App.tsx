import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import {
  apply,
  emptyWorkspace,
  geometry,
  neighbor,
  panels,
  type Action,
} from "./workspace/model";
import { WorkspaceView } from "./workspace/WorkspaceView";
import {
  command,
  DEFAULT_MODIFIER,
  isModifierKey,
  modifierDown,
  modifierLabel,
  modifiers,
  type Modifier,
} from "./workspace/shortcuts";
import {
  codeEditor,
  diff as diffPlugin,
  excalidraw,
  fileModules,
  ideProject,
  problems as problemsPlugin,
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
import { Launcher } from "./components/Launcher";
import {
  CloseIcon,
  MaximizeIcon,
  MinimizeIcon,
  SearchIcon,
} from "./components/Icons";
import { CommandPalette, type Command } from "./components/CommandPalette";
import { ShellSetting } from "./plugins/terminal/ShellSetting";
import { setHost } from "./plugins/ide/editors";
import { createDiff, diffFor } from "./plugins/ide/diffs";
import { formatBeforeSave } from "./plugins/ide/save";
import "./App.css";

type Question = {
  title: string;
  message: string;
  choices: string[];
  resolve: (choice: string) => void;
};
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
    [palette, setPalette] = useState(false),
    [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState(""),
    [question, setQuestion] = useState<Question | null>(null);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const snapshotQueue = useRef<Promise<unknown>>(Promise.resolve());
  const docs = useDocuments(),
    closing = useRef(false);
  // Drawings and diagrams; the hooks re-render on their changes.
  const boundItems = fileModules.map((m) => m.files.useAll());
  const focused = panels(workspace.root).find(
    (p) => p.id === workspace.focused,
  );
  const active = docs.find((d) => d.id === focused?.active);
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
  function dispatch(action: Action) {
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
      report(error);
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
  function openPalette() {
    launcherReturn.current = document.activeElement;
    setPalette(true);
  }
  /** Focus goes back first, so a command acts on the tool that had it. */
  function closePalette(then?: () => void) {
    setPalette(false);
    const previous = launcherReturn.current;
    launcherReturn.current = null;
    setTimeout(() => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
      then?.();
    });
  }
  // The palette's starting set: actions that already have a workspace shortcut.
  const commands: Command[] = [
    {
      id: "launcher",
      label: "Add to Workspace…",
      shortcut: `${modifierLabel(modifier)} K`,
      run: openLauncher,
    },
    {
      id: "new",
      label: "New Text Tab",
      shortcut: "Ctrl N",
      run: () => void create("tab"),
    },
    {
      id: "open",
      label: "Open File…",
      shortcut: "Ctrl O",
      run: () => void (bound ? openBound(bound.module) : open()),
    },
    {
      id: "save",
      label: "Save",
      shortcut: "Ctrl S",
      run: () => saveFocused(false),
    },
    {
      id: "save-as",
      label: "Save As…",
      shortcut: "Ctrl Shift S",
      run: () => saveFocused(true),
    },
    {
      id: "close",
      label: "Close Tab",
      shortcut: "Ctrl W",
      run: () => void (focused?.active && close([focused.active])),
    },
    {
      id: "window",
      label: "New Window",
      shortcut: "Ctrl Alt N",
      run: () => void native("new_workspace").catch(report),
    },
    {
      id: "settings",
      label: "Workspace Settings…",
      shortcut: "Ctrl ,",
      run: () => setSettings(true),
    },
  ];
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
    mode: "tab" | "auto",
    plugin: PluginDefinition = textEditor,
  ) {
    const existing = panels(state.current.root).find((p) =>
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
    !panels(state.current.root).some((p) => p.tabs.some((t) => t.id === id));
  async function create(
    mode: "tab" | "auto",
    plugin: PluginDefinition = textEditor,
  ) {
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
    if (!attach(id, mode, plugin)) plugin.dispose(id);
  }
  function windowAction(action: "minimize" | "maximize" | "close") {
    if (!isTauri()) return;
    const currentWindow = getCurrentWindow();
    const request =
      action === "minimize"
        ? currentWindow.minimize()
        : action === "maximize"
          ? currentWindow.toggleMaximize()
          : currentWindow.close();
    void request.catch(report);
  }
  /** Files opened while a code editor is focused open as code; otherwise as text. */
  async function open(path?: string) {
    try {
      const focusedPanel = panels(state.current.root).find(
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
  /**
   * Where the IDE puts a tab: the panel of the last focused code editor, beside it with
   * `side`, or (the first time) to the right of the project sidebar.
   */
  function place(id: string, plugin: PluginDefinition, side = false) {
    const all = panels(state.current.root);
    if (all.some((p) => p.tabs.some((t) => t.id === id)))
      return attach(id, "tab", plugin);
    const isCode = (p: (typeof all)[number]) =>
      p.tabs.some((t) => t.plugin === codeEditor.id);
    const code =
      all.find((p) => p.id === lastCode.current && isCode(p)) ??
      all.find(isCode);
    const tab = { id, plugin: plugin.id };
    const panelId = crypto.randomUUID(),
      splitId = crypto.randomUUID();
    if (code) {
      dispatch({ type: "activate", panelId: code.id });
      return dispatch({
        type: "open",
        tab,
        panelId,
        splitId,
        mode: side ? "x" : "tab",
      });
    }
    const target = all.find((p) => p.id === state.current.focused);
    const sidebar = target?.tabs.some((t) => t.plugin === ideProject.id);
    const width =
      target &&
      geometry(state.current.root, latest.current.bounds).get(target.id)?.width;
    // Keep the project sidebar narrow, as in most code editors.
    const ratio =
      sidebar && width ? Math.min(0.5, Math.max(0.12, 320 / width)) : 0.5;
    return dispatch({ type: "open", tab, panelId, splitId, mode: "x", ratio });
  }
  useEffect(() => {
    setHost({
      showCode: (id, options) => place(id, codeEditor, options?.side),
      showDiff(path) {
        const existing = diffFor(path);
        const id = existing ?? createDiff(path);
        if (!place(id, diffPlugin, true) && !existing) diffPlugin.dispose(id);
      },
      showProblems() {
        const panel = panels(state.current.root).find((p) =>
          p.tabs.some((t) => t.plugin === problemsPlugin.id),
        );
        const tab = panel?.tabs.find((t) => t.plugin === problemsPlugin.id);
        if (panel && tab) {
          dispatch({ type: "activate", panelId: panel.id, tabId: tab.id });
          return;
        }
        const id = problemsPlugin.create();
        // Below the whole layout, like an IDE's bottom panel.
        if (
          !dispatch({
            type: "open",
            tab: { id, plugin: problemsPlugin.id },
            panelId: crypto.randomUUID(),
            splitId: crypto.randomUUID(),
            mode: "y",
            around: "root",
            ratio: 0.72,
          })
        )
          problemsPlugin.dispose(id);
      },
      ask,
      report,
    });
    beforeSave.add(formatBeforeSave);
    return () => {
      setHost(null);
      beforeSave.delete(formatBeforeSave);
    };
  }, []);
  useEffect(() => {
    if (
      focused?.tabs.find((t) => t.id === focused.active)?.plugin ===
      codeEditor.id
    )
      lastCode.current = focused.id;
  }, [focused?.id, focused?.active]);
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
    const tab = panels(state.current.root)
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
    try {
      if (!(await confirmClose(ids))) return;
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
        dispatch({ type: "close", tabId: id });
        plugin.dispose(id);
      }
    } catch (e) {
      report(e);
    } finally {
      closing.current = false;
    }
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
      if (isModifierKey(event, modifier)) {
        if (!event.getModifierState("AltGraph")) {
          held.current = true;
          setControl(true);
          // A bare Alt press would otherwise move focus to the WebView's menu handling.
          if (modifier === "AltLeft") event.preventDefault();
        }
        return;
      }
      // A keyup missed while another application had focus reads as released here.
      if (held.current && !modifierDown(event, modifier)) {
        held.current = false;
        setControl(false);
      }
      if (event.key === "Escape") setControl(false);
      const workspace = command(event, modifier, held.current);
      if (workspace) {
        // Taken before any module sees it: no shell byte, editor command or drawing tool.
        event.preventDefault();
        event.stopPropagation();
        if (workspace.kind === "launcher") {
          if (!document.querySelector("dialog[open]")) openLauncher();
        } else if (!document.querySelector("dialog[open]")) {
          const id = neighbor(
            state.current,
            latest.current.bounds,
            workspace.edge,
          );
          if (id) dispatch({ type: "activate", panelId: id });
        }
        return;
      }
      if (document.querySelector("dialog[open]")) return;
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        event.stopPropagation();
        void native("new_workspace").catch(report);
      } else if (event.ctrlKey && !event.altKey) {
        const key = event.key.toLowerCase();
        // Shell line editing owns Ctrl+N/O/S/W inside a terminal (next, operate, XOFF, word).
        const shellKey =
          !event.shiftKey &&
          ["n", "o", "s", "w"].includes(key) &&
          (event.target as Element | null)?.closest?.(".terminal-host");
        const bound = latest.current.bound;
        if (!shellKey && ["n", "o", "s", "w", ","].includes(key)) {
          event.preventDefault();
          event.stopPropagation();
          if (key === "n") void create(event.shiftKey ? "auto" : "tab");
          if (key === "o") void (bound ? openBound(bound.module) : open());
          if (key === ",") setSettings(true);
          if (key === "s") saveFocused(event.shiftKey);
          if (key === "w" && latest.current.tab)
            void close([latest.current.tab]);
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (isModifierKey(e, latest.current.modifier)) release();
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
          const ids = panels(state.current.root).flatMap((p) =>
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
            const panel = panels(state.current.root).find(
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
  const tabs = panels(workspace.root).flatMap((p) => p.tabs);
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
      <header
        className="titlebar"
        data-tauri-drag-region
        onDoubleClick={() => windowAction("maximize")}
      >
        <img
          className="titlebar-logo"
          src="/tessera.svg"
          alt="Tessera"
          draggable={false}
          data-tauri-drag-region
        />
        <div className="titlebar-drag" data-tauri-drag-region />
        <button
          type="button"
          className="titlebar-command"
          aria-label="Open command palette"
          aria-haspopup="dialog"
          onClick={openPalette}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <SearchIcon />
          <span>Search commands</span>
        </button>
        <div
          className="window-controls"
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Minimize window"
            onClick={() => windowAction("minimize")}
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            aria-label="Maximize window"
            onClick={() => windowAction("maximize")}
          >
            <MaximizeIcon />
          </button>
          <button
            type="button"
            className="window-close"
            aria-label="Close window"
            onClick={() => windowAction("close")}
          >
            <CloseIcon />
          </button>
        </div>
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
      <div className="workspace-area" ref={area}>
        {workspace.root ? (
          <WorkspaceView
            state={workspace}
            bounds={bounds}
            control={control}
            limits={pluginLimits}
            dispatch={dispatch}
            close={(ids) => void close(ids)}
          />
        ) : (
          <section className="empty">
            <div className="workspace-mark">▦</div>
            <h1>A little space to think.</h1>
            <p>
              Press <kbd>{modifierLabel(modifier)} K</kbd> to open the launcher.
            </p>
          </section>
        )}
      </div>
      <footer className="status">
        <span>{`${modifierLabel(modifier)}+K launcher · +arrows focus`}</span>
        <span>
          {active
            ? `${active.ending.toUpperCase()} · UTF-8${active.bom ? " BOM" : ""}${dirty(active) ? " · Modified" : ""}`
            : bound
              ? bound.item.path
                ? `Autosave · ${bound.item.saving ? "Saving…" : bound.item.conflict || bound.item.error ? "Not saved" : boundDirty(bound.item) ? "Modified" : "Saved"}`
                : `Not saved yet${boundDirty(bound.item) ? " · Modified" : ""}`
              : "Local · Offline"}
        </span>
      </footer>
      {launcher && (
        <Launcher
          plugins={[...registry.values()].filter((p) => p.listed !== false)}
          onPick={(plugin, mode) => void create(mode, plugin)}
          onCancel={closeLauncher}
        />
      )}
      {palette && (
        <CommandPalette
          commands={commands}
          onPick={(command) => closePalette(command.run)}
          onCancel={() => closePalette()}
        />
      )}
      {settings && (
        <Dialog title="Workspace settings" onCancel={() => setSettings(false)}>
          <label>
            Workspace control key{" "}
            <select
              value={modifier}
              onChange={(e) => {
                const value = e.target.value as Modifier;
                release();
                setModifier(value);
                if (isTauri())
                  void native("set_modifier", { modifier: value }).catch(
                    report,
                  );
              }}
            >
              {modifiers.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              <option disabled>Right Alt (AltGr) — not available</option>
            </select>
          </label>
          <p className="muted">
            Hold it with K for the launcher, with the arrows to move focus, or
            while dragging a panel grip. Other shortcuts stay with the focused
            tool. Right Alt is AltGr on many layouts and would block special
            characters.
          </p>
          {modifiers.find((m) => m.value === modifier)?.warning && (
            <p className="settings-warning" role="note">
              {modifiers.find((m) => m.value === modifier)!.warning}
            </p>
          )}
          <ShellSetting report={report} />
          <button onClick={() => setSettings(false)}>Done</button>
        </Dialog>
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
