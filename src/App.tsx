import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  apply,
  emptyWorkspace,
  neighbor,
  panels,
  type Action,
  type Edge,
} from "./workspace/model";
import { WorkspaceView } from "./workspace/WorkspaceView";
import { pluginLimits, registry, textEditor } from "./plugins/registry";
import type { PluginDefinition } from "./plugins/contract";
import {
  allDocuments,
  createDocument,
  dirty,
  updateDocument,
  useDocuments,
} from "./plugins/text-editor/documents";
import {
  checkExternal,
  native,
  openFile,
  saveDocument,
  type Modifier,
  type Recovery,
  type FileData,
} from "./services/native";
import { Dialog } from "./components/Dialog";
import { Launcher } from "./components/Launcher";
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
    [modifier, setModifier] = useState<Modifier>("Alt");
  const [launcher, setLauncher] = useState(false),
    [settings, setSettings] = useState(false);
  const [notice, setNotice] = useState(""),
    [question, setQuestion] = useState<Question | null>(null);
  const [recoveries, setRecoveries] = useState<Recovery[]>([]);
  const snapshotQueue = useRef<Promise<unknown>>(Promise.resolve());
  const docs = useDocuments(),
    closing = useRef(false);
  const focused = panels(workspace.root).find(
    (p) => p.id === workspace.focused,
  );
  const active = docs.find((d) => d.id === focused?.active);
  const latest = useRef({ bounds, modifier, active, tab: focused?.active });
  latest.current = { bounds, modifier, active, tab: focused?.active };
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
  function create(mode: "tab" | "auto", plugin: PluginDefinition = textEditor) {
    const id = plugin.create();
    if (!attach(id, mode, plugin)) plugin.dispose(id);
    setLauncher(false);
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
  async function open(path?: string) {
    try {
      const id = await openFile(path);
      if (id && !attach(id, "tab")) textEditor.dispose(id);
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
      while (!plugin.beforeClose(id)) {
        const result = await ask(
          "Unsaved changes",
          `Save changes to ${plugin.title(id)}?`,
          ["Save", "Discard", "Cancel"],
        );
        if (result === "Cancel" || (result === "Save" && !(await save(id))))
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
        if (isTauri() && plugin === textEditor) {
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
      if (
        event.key === latest.current.modifier &&
        !event.getModifierState("AltGraph")
      ) {
        event.preventDefault();
        setControl(true);
      }
      if (event.key === "Escape") {
        setControl(false);
        setLauncher(false);
      }
      if (document.querySelector("dialog[open]")) return;
      const directions: Record<string, Edge> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "top",
        ArrowDown: "bottom",
      };
      if (
        event.getModifierState(latest.current.modifier) &&
        !event.getModifierState("AltGraph") &&
        directions[event.key]
      ) {
        event.preventDefault();
        event.stopPropagation();
        const id = neighbor(
          state.current,
          latest.current.bounds,
          directions[event.key],
        );
        if (id) dispatch({ type: "activate", panelId: id });
      } else if (
        event.ctrlKey &&
        event.altKey &&
        event.key.toLowerCase() === "n"
      ) {
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
        if (!shellKey && ["n", "o", "s", "w", "k", ","].includes(key)) {
          event.preventDefault();
          event.stopPropagation();
          if (key === "n") create(event.shiftKey ? "auto" : "tab");
          if (key === "o") void open();
          if (key === "k") setLauncher(true);
          if (key === ",") setSettings(true);
          if (key === "s" && latest.current.active)
            void save(latest.current.active.id, event.shiftKey);
          if (key === "w" && latest.current.tab)
            void close([latest.current.tab]);
        }
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === latest.current.modifier) setControl(false);
    };
    const blur = () => setControl(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
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
          const ids = allDocuments().map((d) => d.id);
          if (await confirmClose(ids)) {
            await snapshotQueue.current;
            await native("clear_snapshots");
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
    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop")
          void (async () => {
            // Native drop positions are physical pixels; the workspace uses CSS pixels.
            const scale = await getCurrentWindow().scaleFactor();
            if (event.payload.type !== "drop") return;
            const target = document
              .elementFromPoint(
                event.payload.position.x / scale,
                event.payload.position.y / scale,
              )
              ?.closest<HTMLElement>("[data-panel]");
            if (target)
              dispatch({ type: "activate", panelId: target.dataset.panel! });
            for (const path of event.payload.paths) await open(path);
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
  useEffect(() => {
    if (!isTauri()) return;
    const written = new Map<string, number>();
    // Periodic checkpoints also protect continuous typing; never write per keystroke.
    const timer = window.setInterval(() => {
      if (closing.current) return;
      snapshotQueue.current = snapshotQueue.current
        .then(async () => {
          if (closing.current) return;
          const live = new Set(allDocuments().map((d) => d.id));
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
        <div
          className="window-controls"
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Minimize window"
            onClick={() => windowAction("minimize")}
          >
            <span aria-hidden="true">&#x2212;</span>
          </button>
          <button
            type="button"
            aria-label="Maximize window"
            onClick={() => windowAction("maximize")}
          >
            <span className="maximize-icon" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="window-close"
            aria-label="Close window"
            onClick={() => windowAction("close")}
          >
            <span aria-hidden="true">&#x00D7;</span>
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
          <span>Recoverable documents</span>
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
              Press <kbd>Ctrl K</kbd> to open the launcher.
            </p>
          </section>
        )}
      </div>
      <footer className="status">
        <span>
          {control ? "Workspace control" : `Hold ${modifier} to arrange panels`}
        </span>
        <span>
          {active
            ? `${active.ending.toUpperCase()} · UTF-8${active.bom ? " BOM" : ""}${dirty(active) ? " · Modified" : ""}`
            : "Local · Offline"}
        </span>
      </footer>
      {launcher && (
        <Launcher
          plugins={[...registry.values()]}
          onPick={(plugin, mode) => create(mode, plugin)}
          onCancel={() => setLauncher(false)}
        />
      )}
      {settings && (
        <Dialog title="Workspace settings" onCancel={() => setSettings(false)}>
          <label>
            Hold to control panels{" "}
            <select
              value={modifier}
              onChange={(e) => {
                const value = e.target.value as Modifier;
                setControl(false);
                setModifier(value);
                if (isTauri())
                  void native("set_modifier", { modifier: value }).catch(
                    report,
                  );
              }}
            >
              <option>Alt</option>
              <option>Control</option>
              <option>Shift</option>
            </select>
          </label>
          <p className="muted">
            Choose another modifier if your window manager captures Alt.
          </p>
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
