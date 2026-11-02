import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { ViewProps } from "../contract";
import { keysOf, matches } from "../../workspace/keybindings";
import { useCommands } from "../../workspace/commands";
import { Dialog } from "../../components/Dialog";
import { InlineName } from "../../components/InlineName";
import {
  BackIcon,
  ComputerIcon,
  DriveIcon,
  FileIcon,
  FolderIcon,
  ForwardIcon,
  LinkIcon,
  MoreIcon,
  PinIcon,
  UpIcon,
} from "../../components/Icons";
import {
  fileSystem,
  isDirectory,
  type Conflict,
  type Drive,
  type FileEntry,
  type Failure,
  type TransferMode,
} from "../../services/filesystem";
import { pins, usePins } from "../../services/pins";
import { drawingFiles } from "../excalidraw/drawings";
import { diagramFiles } from "../mermaid/diagrams";
import { textFiles } from "../text-editor/open";
import { terminals } from "../terminal/open";
import { windowBackend } from "../../services/windows";

// Drawings and diagrams open in their own modules, which focus a tab already showing them.
function openInModule(path: string) {
  const files = [drawingFiles, diagramFiles].find((f) => f.isPath(path));
  files?.requestOpen(path);
  return !!files;
}
/**
 * Other files open in a Text Editor of the workspace (`panelId`: the one dropped on), else
 * as tabs beside the File Manager `from`; the workspace sends those that are not text to
 * their default application.
 */
async function openFiles(paths: string[], panelId?: string, from?: string) {
  const rest = paths.filter((path) => !openInModule(path));
  if (rest.length && !textFiles.open(rest, panelId, from))
    for (const path of rest) await fileSystem.open(path);
}
import {
  back,
  forward,
  getInstance,
  navigate,
  parentOf,
  refresh,
  setClipboard,
  setQuery,
  setShowHidden,
  THIS_PC,
  thisPc,
  transfer,
  up,
  update,
  useFileManager,
  type Decision,
} from "./instances";
import {
  formatDate,
  formatSize,
  relativeFolder,
  samePath,
  select,
  sortEntries,
  toggleSort,
  visibleEntries,
  within,
  type SortKey,
} from "./model";
import {
  Menu,
  Popup,
  useDismiss,
  usePlacement,
  type MenuItem,
} from "../../components/Menu";

const ROW = 26,
  OVERSCAN = 8;
const message = (error: unknown) => String(error).replace(/^Error: /, "");
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
const failures = (verb: string, failed: Failure[]) =>
  `${verb} ${failed.length === 1 ? "1 item" : `${failed.length} items`} failed: ${failed
    .slice(0, 3)
    .map((f) => `${f.name}: ${f.error}`)
    .join("; ")}${failed.length > 3 ? "; …" : ""}`;

/** A name typed in the list: a new file or folder at its top, or a row renamed in place. */
type Naming = { kind: "file" | "folder" } | { kind: "rename"; path: string };
type Prompt =
  | {
      kind: "conflict";
      conflict: Conflict;
      remaining: number;
      mode: TransferMode;
      resolve: (decision: Decision) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      action: string;
      resolve: (ok: boolean) => void;
    };
type Drag = {
  pointer: number;
  x: number;
  y: number;
  paths: string[];
  started: boolean;
  target: string | null;
  /** A Text Editor panel under the pointer, which opens the dragged files. */
  panel: string | null;
  valid: boolean;
};

export default function FileManagerView({
  instanceId: id,
  focused,
}: ViewProps) {
  const { state, showHidden, clipboard } = useFileManager(id);
  const commands = useCommands("File Manager", id, focused);
  const { pins: pinned } = usePins();
  const root = useRef<HTMLDivElement>(null),
    list = useRef<HTMLDivElement>(null),
    crumbBar = useRef<HTMLDivElement>(null);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    kind: "context" | "more" | "pins";
    x: number;
    y: number;
  } | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [naming, setNamingState] = useState<Naming | null>(null);
  // Read by the context menu's close, which runs before the field renders.
  const namingRef = useRef<Naming | null>(null);
  const setNaming = (next: Naming | null) => {
    namingRef.current = next;
    setNamingState(next);
  };
  const [scroll, setScroll] = useState(0),
    [height, setHeight] = useState(0);
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<{
    x: number;
    y: number;
    count: number;
    target: string | null;
    panel: string | null;
    valid: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const listing = state?.listing ?? null;
  const separator = listing?.separator ?? "/";

  // While a search ran, its results replace the folder's entries.
  const search = state?.search ?? null;
  const rows = useMemo(
    () =>
      listing && state
        ? sortEntries(
            visibleEntries(
              state.search ? state.search.results : listing.entries,
              "",
              showHidden,
            ),
            state.sort,
          )
        : [],
    [listing, state?.search, state?.sort, showHidden],
  );
  const order = useMemo(() => rows.map((e) => e.path), [rows]);
  const selected = useMemo(
    () => rows.filter((e) => state?.selection.paths.has(e.path)),
    [rows, state?.selection],
  );
  const cursorIndex = state?.selection.cursor
    ? order.indexOf(state.selection.cursor)
    : -1;

  // Watch only the folder currently displayed; release it on navigation and unmount.
  const directory = listing?.directory;
  useEffect(() => {
    if (!directory || !isTauri()) return;
    let current = true;
    void fileSystem
      .watch(id, directory)
      .then(() => current && update(id, { watchError: null }))
      .catch(
        (e) =>
          current &&
          update(id, {
            watchError: `Live updates are unavailable (${message(e)}). Press F5 to refresh.`,
          }),
      );
    return () => {
      current = false;
      void fileSystem.watch(id, null).catch(() => {});
    };
  }, [id, directory]);
  // A remounted view may have missed changes while it was hidden.
  useEffect(() => {
    if (getInstance(id).listing) void refresh(id);
  }, [id]);
  useEffect(() => {
    if (focused && !root.current?.contains(document.activeElement))
      list.current?.focus();
  }, [focused]);
  useEffect(() => {
    const viewport = list.current!;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry.contentRect.height),
    );
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    list.current?.scrollTo({ top: 0 });
    const bar = crumbBar.current;
    if (bar) bar.scrollLeft = bar.scrollWidth;
  }, [directory]);
  // Settle any open question if the view goes away (tab switch or close).
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  useEffect(() => () => cancelPrompt(promptRef.current), []);

  if (!state) return null;
  const selection = state.selection;
  const report = (text: string | null) => update(id, { notice: text });
  const operable = (entries: FileEntry[]) =>
    entries.length > 0 && entries.every((e) => !e.unsupported);

  function setSelection(next: typeof selection) {
    update(id, { selection: next });
  }
  function ensureVisible(index: number) {
    const viewport = list.current;
    if (!viewport || index < 0) return;
    const top = index * ROW;
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + ROW > viewport.scrollTop + viewport.clientHeight)
      viewport.scrollTop = top + ROW - viewport.clientHeight;
  }
  function ask<T>(make: (resolve: (value: T) => void) => Prompt) {
    return new Promise<T>((resolve) =>
      setPrompt(
        make((value) => {
          setPrompt(null);
          resolve(value);
          // The modal dialog keeps the page inert until it unmounts; refocus afterwards.
          setTimeout(() => list.current?.focus());
        }),
      ),
    );
  }
  const confirm = (title: string, text: string, action: string) =>
    ask<boolean>((resolve) => ({
      kind: "confirm",
      title,
      message: text,
      action,
      resolve,
    }));
  const run = (work: () => Promise<unknown>) =>
    void work().catch((e) => report(message(e)));

  function openEntries(entries: FileEntry[]) {
    if (!operable(entries)) return;
    if (entries.length === 1 && isDirectory(entries[0]))
      return void navigate(id, entries[0].path);
    run(() =>
      openFiles(
        entries.filter((e) => !isDirectory(e)).map((e) => e.path),
        undefined,
        id,
      ),
    );
  }
  function copy(mode: TransferMode) {
    if (operable(selected))
      setClipboard({ mode, paths: selected.map((e) => e.path) });
  }
  async function move(
    paths: string[],
    destination: string,
    mode: TransferMode,
  ) {
    const result = await transfer(
      id,
      paths,
      destination,
      mode,
      (conflict, remaining) =>
        ask<Decision>((resolve) => ({
          kind: "conflict",
          conflict,
          remaining,
          mode,
          resolve,
        })),
    );
    if (!result) return false;
    if (result.failed.length)
      report(failures(mode === "copy" ? "Copying" : "Moving", result.failed));
    else if (result.cancelled) report("The operation was cancelled.");
    return !result.failed.length && !result.cancelled;
  }
  function paste() {
    if (!clipboard || !listing || state?.page !== "folder") return;
    run(async () => {
      const done = await move(
        clipboard.paths,
        listing.directory,
        clipboard.mode,
      );
      if (done && clipboard.mode === "move") setClipboard(null);
    });
  }
  /** Renames the selected item in its row, as a file explorer does. */
  function rename() {
    if (selected.length !== 1 || !operable(selected)) return;
    ensureVisible(order.indexOf(selected[0].path));
    setNaming({ kind: "rename", path: selected[0].path });
  }
  /**
   * A new file or folder is named in a row at the top of the list; a file's name is typed
   * with its extension, nothing asks for a type.
   */
  function create(directory: boolean) {
    if (!listing) return;
    list.current?.scrollTo({ top: 0 });
    setNaming({ kind: directory ? "folder" : "file" });
  }
  /** Creates or renames as named; resolves with the error to show, or null. */
  async function submitName(name: string) {
    const current = namingRef.current;
    if (!current || !listing) return null;
    try {
      const entry =
        current.kind === "rename"
          ? await fileSystem.rename(current.path, name)
          : await fileSystem.create(
              listing.directory,
              name,
              current.kind === "folder",
            );
      setSelection(select(selection, [entry.path], entry.path, {}));
      await refresh(id);
      return null;
    } catch (e) {
      return message(e);
    }
  }
  function doneNaming() {
    setNaming(null);
    list.current?.focus();
  }
  function remove(permanent: boolean) {
    if (!operable(selected)) return;
    const paths = selected.map((e) => e.path);
    const what =
      paths.length === 1 ? `“${selected[0].name}”` : `${paths.length} items`;
    run(async () => {
      if (
        permanent &&
        !(await confirm(
          "Delete permanently",
          `Permanently delete ${what}? This cannot be undone: the items will not go to the Trash.`,
          "Delete permanently",
        ))
      )
        return;
      const failed = permanent
        ? await fileSystem.deletePermanently(paths)
        : await fileSystem.trash(paths);
      await refresh(id);
      report(failed.length ? failures("Deleting", failed) : null);
    });
  }
  const pinOf = (path: string) =>
    pinned.find((p) => samePath(p.path, path, separator));
  function togglePin(path: string) {
    const pin = pinOf(path);
    run(() => (pin ? pins.remove(pin.id) : pins.add(path)));
  }
  function activatePin(path: string, kind: string) {
    if (kind === "directory") void navigate(id, path);
    else run(() => openFiles([path], undefined, id));
  }

  function moveCursor(index: number, extend: boolean) {
    if (!rows.length) return;
    const target = order[Math.max(0, Math.min(order.length - 1, index))];
    setSelection(select(selection, order, target, { shift: extend }));
    ensureVisible(order.indexOf(target));
  }
  function openContextMenu(x: number, y: number) {
    setMenu({ kind: "context", x, y });
  }
  function listKey(event: KeyboardEvent) {
    if (event.target !== list.current) return;
    const ctrl = event.ctrlKey || event.metaKey,
      key = event.key;
    const page = Math.max(1, Math.floor(height / ROW) - 1);
    const handled = () => event.preventDefault();
    if (key === "ArrowDown" || key === "ArrowUp") {
      handled();
      moveCursor(
        cursorIndex < 0 ? 0 : cursorIndex + (key === "ArrowDown" ? 1 : -1),
        event.shiftKey,
      );
    } else if (key === "PageDown" || key === "PageUp") {
      handled();
      moveCursor(
        cursorIndex + (key === "PageDown" ? page : -page),
        event.shiftKey,
      );
    } else if (key === "Home" || key === "End") {
      handled();
      moveCursor(key === "Home" ? 0 : rows.length - 1, event.shiftKey);
    } else if (key === " " && ctrl && state!.selection.cursor) {
      handled();
      setSelection(
        select(selection, order, state!.selection.cursor, { ctrl: true }),
      );
    } else if (key === "Enter") {
      handled();
      openEntries(selected);
    } else if (matches(event, "files.trash")) {
      handled();
      remove(false);
    } else if (matches(event, "files.delete")) {
      handled();
      remove(true);
    } else if (matches(event, "files.rename")) {
      handled();
      rename();
    } else if (key === "Escape" && selection.paths.size) {
      handled();
      setSelection({ paths: new Set(), anchor: null, cursor: null });
    } else if (matches(event, "files.all")) {
      handled();
      setSelection({
        paths: new Set(order),
        anchor: order[0] ?? null,
        cursor: state!.selection.cursor,
      });
    } else if (matches(event, "files.copy") || matches(event, "files.cut")) {
      handled();
      copy(matches(event, "files.copy") ? "copy" : "move");
    } else if (matches(event, "files.paste")) {
      handled();
      paste();
    } else if (key === "ContextMenu" || (key === "F10" && event.shiftKey)) {
      handled();
      const rect = list.current!.getBoundingClientRect();
      const index = Math.max(0, cursorIndex);
      openContextMenu(
        rect.left + 40,
        rect.top + index * ROW - list.current!.scrollTop + ROW,
      );
    }
  }
  function rootKey(event: KeyboardEvent) {
    const ctrl = event.ctrlKey || event.metaKey;
    if (matches(event, "files.path")) {
      event.preventDefault();
      setEditingPath(listing?.directory ?? "");
    } else if (matches(event, "files.refresh")) {
      event.preventDefault();
      void refresh(id);
    } else if (editable(event.target)) {
      return;
    } else if (matches(event, "files.back")) {
      event.preventDefault();
      back(id);
    } else if (matches(event, "files.forward")) {
      event.preventDefault();
      forward(id);
    } else if (
      (event.altKey && !ctrl && event.key === "ArrowUp") ||
      matches(event, "files.up")
    ) {
      event.preventDefault();
      up(id);
    }
  }

  // Internal drag: move selected entries onto a folder row or breadcrumb, in any File Manager.
  function dropTarget(x: number, y: number) {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-drop-directory]");
    return element?.dataset.dropDirectory ?? null;
  }
  /** A Text Editor panel other than this one, under the pointer. */
  function panelTarget(x: number, y: number) {
    const panel = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-panel]");
    const id = panel?.dataset.panel;
    return id &&
      panel !== root.current?.closest("[data-panel]") &&
      textFiles.accepts(id)
      ? id
      : null;
  }
  function dropAllowed(target: string | null, paths: string[]) {
    if (!target) return false;
    return !paths.some(
      (source) =>
        within(target, source, separator) ||
        samePath(target, parentOf(source, separator), separator),
    );
  }
  function rowPointerDown(event: PointerEvent, entry: FileEntry) {
    if (event.button !== 0) return;
    let paths = [...selection.paths];
    if (!selection.paths.has(entry.path) && !event.ctrlKey && !event.shiftKey) {
      setSelection(select(selection, order, entry.path, {}));
      paths = [entry.path];
    }
    drag.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      paths,
      started: false,
      target: null,
      panel: null,
      valid: false,
    };
  }
  function listPointerMove(event: PointerEvent) {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    if (!d.started) {
      if (Math.hypot(event.clientX - d.x, event.clientY - d.y) <= 5) return;
      const entries = rows.filter((e) => d.paths.includes(e.path));
      if (!operable(entries)) {
        drag.current = null;
        return;
      }
      d.started = true;
      list.current!.setPointerCapture(event.pointerId);
    }
    d.target = dropTarget(event.clientX, event.clientY);
    d.panel = d.target ? null : panelTarget(event.clientX, event.clientY);
    // Only files open in an editor; a folder among them makes the drop invalid there.
    d.valid = d.panel
      ? rows.every((e) => !d.paths.includes(e.path) || !isDirectory(e))
      : dropAllowed(d.target, d.paths);
    setDragView({
      x: event.clientX,
      y: event.clientY,
      count: d.paths.length,
      target: d.target,
      panel: d.panel,
      valid: d.valid,
    });
  }
  function listPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (!d?.started) return;
    suppressClick.current = true;
    setDragView(null);
    if (d.valid && d.panel) {
      const panel = d.panel;
      run(() => openFiles(d.paths, panel));
    } else if (d.valid && d.target) {
      const target = d.target;
      run(() => move(d.paths, target, "move"));
    }
  }
  function listPointerCancel() {
    drag.current = null;
    setDragView(null);
  }

  const first = Math.max(0, Math.floor(scroll / ROW) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scroll + height) / ROW) + OVERSCAN,
  );
  const cut = clipboard?.mode === "move" ? new Set(clipboard.paths) : null;
  const adding = naming && naming.kind !== "rename" ? naming : null;
  const shift = adding ? ROW : 0;
  const single = selected.length === 1 ? selected[0] : null;
  // The This PC page keeps the last folder's listing for Back; nothing acts on it there.
  const shown = state.page === "folder" ? listing : null;
  const createItems: MenuItem[] = [
    { label: "New file", disabled: !shown, action: () => create(false) },
    { label: "New folder", disabled: !shown, action: () => create(true) },
  ];
  // A folder right-clicked, else the folder shown, as in a file explorer.
  const here =
    single && isDirectory(single) && !single.unsupported
      ? single.path
      : (shown?.directory ?? null);
  const openHereItems: MenuItem[] = [
    {
      label: "Open in Terminal",
      disabled: !here,
      action: () => {
        if (here && !terminals.open(here))
          report("A terminal cannot open here.");
      },
    },
    {
      label: "Open in IDE (New Window)",
      disabled: !here,
      action: () => here && run(() => windowBackend.open(here)),
    },
  ];
  const contextItems: MenuItem[] = [
    {
      label: "Open",
      shortcut: "Enter",
      disabled:
        !operable(selected) ||
        (selected.length > 1 && selected.some(isDirectory)),
      action: () => openEntries(selected),
    },
    "separator",
    {
      label: "Cut",
      shortcut: "Ctrl X",
      disabled: !operable(selected),
      action: () => copy("move"),
    },
    {
      label: "Copy",
      shortcut: "Ctrl C",
      disabled: !operable(selected),
      action: () => copy("copy"),
    },
    {
      label: "Paste",
      shortcut: "Ctrl V",
      disabled: !clipboard || !shown,
      action: paste,
    },
    "separator",
    {
      label: "Rename",
      shortcut: "F2",
      disabled: !single || single.unsupported,
      action: rename,
    },
    {
      label: single && pinOf(single.path) ? "Unpin" : "Pin",
      disabled: !single || single.unsupported || single.broken,
      action: () => single && togglePin(single.path),
    },
    "separator",
    {
      label: "Delete",
      shortcut: "Del",
      disabled: !operable(selected),
      action: () => remove(false),
    },
    "separator",
    ...createItems,
    "separator",
    ...openHereItems,
  ];
  const moreItems: MenuItem[] = [
    ...createItems,
    "separator",
    {
      label: "Show hidden files",
      checked: showHidden,
      action: () => run(() => setShowHidden(!showHidden)),
    },
    { label: "Refresh", shortcut: "F5", action: () => void refresh(id) },
    "separator",
    {
      label: "Delete permanently…",
      shortcut: "Shift Del",
      disabled: !operable(selected),
      action: () => remove(true),
    },
  ];
  commands.current = [
    {
      label: "Go Back",
      shortcut: keysOf("files.back"),
      action: () => back(id),
    },
    {
      label: "Go Forward",
      shortcut: keysOf("files.forward"),
      action: () => forward(id),
    },
    {
      label: "Parent Folder",
      shortcut: keysOf("files.up"),
      action: () => up(id),
    },
    {
      label: "Edit Path",
      shortcut: keysOf("files.path"),
      action: () => setEditingPath(listing?.directory ?? ""),
    },
    { label: thisPc(state), action: () => void navigate(id, THIS_PC) },
    ...moreItems,
    ...openHereItems,
  ];
  const hiddenCount = listing
    ? listing.entries.filter((e) => e.hidden).length
    : 0;
  const sortButton = (key: SortKey, label: string) => (
    <button
      role="columnheader"
      aria-sort={
        state.sort.by === key
          ? state.sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      onClick={() => update(id, { sort: toggleSort(state.sort, key) })}
    >
      {label}
      {state.sort.by === key && (
        <span aria-hidden="true">
          {state.sort.direction === "asc" ? " ▲" : " ▼"}
        </span>
      )}
    </button>
  );

  return (
    <div
      ref={root}
      className="file-manager"
      onKeyDown={rootKey}
      onMouseUp={(e) => {
        if (e.button === 3) back(id);
        if (e.button === 4) forward(id);
      }}
    >
      <div className="fm-toolbar">
        <button
          aria-label="Back"
          title="Back"
          disabled={!state.history.back.length}
          onClick={() => back(id)}
        >
          <BackIcon />
        </button>
        <button
          aria-label="Forward"
          title="Forward"
          disabled={!state.history.forward.length}
          onClick={() => forward(id)}
        >
          <ForwardIcon />
        </button>
        <button
          aria-label="Up"
          title="Up (Backspace)"
          disabled={!listing || state.page === "drives"}
          onClick={() => up(id)}
        >
          <UpIcon />
        </button>
        {editingPath !== null ? (
          <input
            className="fm-path"
            aria-label="Folder path"
            autoFocus
            spellCheck={false}
            value={editingPath}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setEditingPath(e.target.value)}
            onBlur={() => setEditingPath(null)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const target = editingPath.trim();
                setEditingPath(null);
                list.current?.focus();
                if (target) void navigate(id, target);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setEditingPath(null);
                list.current?.focus();
              }
            }}
          />
        ) : (
          <div
            ref={crumbBar}
            className="fm-crumbs"
            title="Click to type a path (Ctrl+L)"
            onClick={(e) => {
              if (e.target === e.currentTarget)
                setEditingPath(listing?.directory ?? "");
            }}
          >
            <nav aria-label="Folder path">
              {/* This PC leads the path, as in a file explorer; it lists the drives. */}
              <span>
                <button
                  className="fm-crumb fm-crumb-pc"
                  title={state.page === "drives" ? undefined : thisPc(state)}
                  aria-label={thisPc(state)}
                  aria-current={
                    state.page === "drives" ? "location" : undefined
                  }
                  onClick={() => void navigate(id, THIS_PC)}
                >
                  <ComputerIcon />
                  {state.page === "drives" && thisPc(state)}
                </button>
              </span>
              {state.page === "folder" &&
                listing?.crumbs.map((crumb, index) => (
                  <span key={crumb.path}>
                    <span className="fm-crumb-separator" aria-hidden="true">
                      ›
                    </span>
                    <button
                      className="fm-crumb"
                      data-drop-directory={crumb.path}
                      aria-current={
                        index === listing.crumbs.length - 1
                          ? "location"
                          : undefined
                      }
                      onClick={() => void navigate(id, crumb.path)}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
            </nav>
            <button
              className="fm-edit-path"
              aria-label="Edit path"
              onClick={() => setEditingPath(listing?.directory ?? "")}
            />
          </div>
        )}
        <input
          className="fm-filter"
          type="search"
          aria-label="Search this folder"
          placeholder={
            state.page === "drives" || !listing
              ? "Search"
              : `Search ${listing.crumbs[listing.crumbs.length - 1]?.name ?? ""}`
          }
          title="Names in this folder and its subfolders; * and ? match any characters"
          spellCheck={false}
          disabled={state.page === "drives"}
          value={state.query}
          onChange={(e) => setQuery(id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && state.query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery(id, "");
            } else if (e.key === "Enter") {
              // Search again at once, as after typing.
              e.preventDefault();
              setQuery(id, state.query);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              list.current?.focus();
              if (!state.selection.cursor && order.length)
                setSelection(select(selection, order, order[0], {}));
            }
          }}
        />
        <button
          aria-label="Pinned items"
          title="Pinned items"
          aria-haspopup="dialog"
          aria-expanded={menu?.kind === "pins"}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu(
              menu?.kind === "pins"
                ? null
                : { kind: "pins", x: rect.right - 260, y: rect.bottom + 4 },
            );
          }}
        >
          <PinIcon />
        </button>
        <button
          aria-label="More actions"
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={menu?.kind === "more"}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu(
              menu?.kind === "more"
                ? null
                : { kind: "more", x: rect.right - 220, y: rect.bottom + 4 },
            );
          }}
        >
          <MoreIcon />
        </button>
      </div>
      {state.notice && (
        <div className="fm-notice" role="alert">
          <span>{state.notice}</span>
          <button aria-label="Dismiss message" onClick={() => report(null)}>
            ×
          </button>
        </div>
      )}
      {state.page === "drives" ? (
        <Drives
          drives={state.drives}
          onOpen={(path) => void navigate(id, path)}
        />
      ) : (
        <>
          <div className={`fm-columns${search ? " searching" : ""}`} role="row">
            {sortButton("name", "Name")}
            {search && (
              <span role="columnheader" className="fm-folder-header">
                Folder
              </span>
            )}
            {sortButton("size", "Size")}
            {sortButton("modified", "Modified")}
          </div>
          <div
            ref={list}
            className={`fm-list ${dragView ? "dragging" : ""}${search ? " searching" : ""}`}
            role="listbox"
            aria-label="Folder contents"
            aria-multiselectable="true"
            aria-activedescendant={
              cursorIndex >= first && cursorIndex < last
                ? `${id}-row-${cursorIndex}`
                : undefined
            }
            tabIndex={0}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
            onKeyDown={listKey}
            onPointerMove={listPointerMove}
            onPointerUp={listPointerUp}
            onPointerCancel={listPointerCancel}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget && e.button === 0)
                setSelection({ paths: new Set(), anchor: null, cursor: null });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (e.target === e.currentTarget)
                setSelection({ paths: new Set(), anchor: null, cursor: null });
              openContextMenu(e.clientX, e.clientY);
            }}
          >
            <div
              className="fm-rows"
              style={{ height: rows.length * ROW + shift }}
            >
              {adding && (
                <div
                  className="fm-row naming"
                  style={{ top: 0, height: ROW }}
                  role="presentation"
                >
                  <span className="fm-name">
                    <span className="fm-icon">
                      {adding.kind === "folder" ? <FolderIcon /> : <FileIcon />}
                    </span>
                    <InlineName
                      label={
                        adding.kind === "folder"
                          ? "New folder name"
                          : "New file name"
                      }
                      initial=""
                      submit={submitName}
                      onDone={doneNaming}
                    />
                  </span>
                </div>
              )}
              {rows.slice(first, last).map((entry, offset) => {
                const index = first + offset;
                const isSelected = selection.paths.has(entry.path);
                const folder = isDirectory(entry);
                return (
                  <div
                    key={entry.path}
                    id={`${id}-row-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    className={[
                      "fm-row",
                      isSelected && "selected",
                      index === cursorIndex && "cursor",
                      cut?.has(entry.path) && "cut",
                      entry.hidden && "hidden-entry",
                      entry.broken && "broken",
                      entry.unsupported && "unsupported",
                      dragView?.target === entry.path &&
                        (dragView.valid ? "drop-ok" : "drop-no"),
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ top: index * ROW + shift, height: ROW }}
                    data-drop-directory={
                      folder && !entry.unsupported ? entry.path : undefined
                    }
                    title={
                      entry.unsupported
                        ? "This name is not valid Unicode; Mozaik cannot act on it"
                        : entry.broken
                          ? "Broken link: the target is missing or loops"
                          : entry.kind === "symlink"
                            ? "Link"
                            : undefined
                    }
                    onPointerDown={(e) => rowPointerDown(e, entry)}
                    onClick={(e) => {
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      setSelection(
                        select(selection, order, entry.path, {
                          ctrl: e.ctrlKey || e.metaKey,
                          shift: e.shiftKey,
                        }),
                      );
                    }}
                    onDoubleClick={() => openEntries([entry])}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!isSelected)
                        setSelection(select(selection, order, entry.path, {}));
                      openContextMenu(e.clientX, e.clientY);
                    }}
                  >
                    <span className="fm-name">
                      <span className="fm-icon">
                        {folder ? <FolderIcon /> : <FileIcon />}
                        {entry.kind === "symlink" && (
                          <span className="fm-link" aria-label="link">
                            <LinkIcon />
                          </span>
                        )}
                      </span>
                      {naming?.kind === "rename" &&
                      naming.path === entry.path ? (
                        <InlineName
                          label={`Rename ${entry.name}`}
                          initial={entry.name}
                          stem={!folder}
                          submit={submitName}
                          onDone={doneNaming}
                        />
                      ) : (
                        <span className="fm-label">{entry.name}</span>
                      )}
                    </span>
                    {search && (
                      <span
                        className="fm-folder"
                        title={parentOf(entry.path, separator)}
                      >
                        {relativeFolder(entry.path, search.root, separator)}
                      </span>
                    )}
                    <span className="fm-size">
                      {folder ? "—" : formatSize(entry.size)}
                    </span>
                    <span className="fm-date">
                      {formatDate(entry.modified)}
                    </span>
                  </div>
                );
              })}
            </div>
            {!listing && state.error && (
              <div className="fm-state" role="alert">
                <p>{state.error}</p>
                <button onClick={() => void navigate(id, null)}>
                  Open home folder
                </button>
              </div>
            )}
            {!listing && !state.error && (
              <p className="fm-state muted">Loading…</p>
            )}
            {listing && !rows.length && (
              <p className="fm-state muted">
                {search
                  ? search.error
                    ? search.error
                    : search.running
                      ? "Searching…"
                      : `No items match “${search.query}”.`
                  : listing.entries.length
                    ? "Only hidden items are in this folder."
                    : "This folder is empty."}
              </p>
            )}
          </div>
        </>
      )}
      <div className="fm-status">
        {state.operation ? (
          <span className="fm-progress" role="status">
            {state.operation.label} · {state.operation.files} files
            {state.operation.current && ` · ${state.operation.current}`}
            <button
              onClick={() => run(() => fileSystem.cancel(state.operation!.id))}
            >
              Cancel
            </button>
          </span>
        ) : (
          <span role="status">
            {state.loading && listing ? "Loading… · " : ""}
            {search?.running ? "Searching… · " : ""}
            {state.page === "drives"
              ? `${state.drives?.length ?? 0} drives`
              : rows.length === 1
                ? `1 ${search ? "result" : "item"}`
                : `${rows.length} ${search ? "results" : "items"}`}
            {search?.truncated ? " (more match; refine the search)" : ""}
            {selected.length ? ` · ${selected.length} selected` : ""}
            {!showHidden && hiddenCount ? ` · ${hiddenCount} hidden` : ""}
            {listing?.unreadable ? ` · ${listing.unreadable} unreadable` : ""}
          </span>
        )}
        {state.watchError && (
          <span className="fm-watch">{state.watchError}</span>
        )}
      </div>
      {menu?.kind === "context" && (
        <Menu
          label="File actions"
          items={contextItems}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(null);
            if (!namingRef.current) list.current?.focus();
          }}
        />
      )}
      {menu?.kind === "more" && (
        <Menu
          label="More actions"
          items={moreItems}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
      {menu?.kind === "pins" && (
        <PinMenu
          x={menu.x}
          y={menu.y}
          current={listing?.directory ?? null}
          isPinned={(path) => !!pinOf(path)}
          onActivate={(path, kind) => {
            setMenu(null);
            activatePin(path, kind);
          }}
          onToggle={(path) => togglePin(path)}
          onError={(e) => report(message(e))}
          onClose={() => setMenu(null)}
        />
      )}
      {dragView && (
        <div
          className={`fm-drag ${dragView.valid ? "" : "invalid"}`}
          style={{ left: dragView.x + 14, top: dragView.y + 10 }}
        >
          {dragView.panel
            ? dragView.valid
              ? `Open ${dragView.count === 1 ? "1 file" : `${dragView.count} files`} here`
              : "Only files open in an editor"
            : dragView.valid
              ? `Move ${dragView.count === 1 ? "1 item" : `${dragView.count} items`}`
              : "Drop on a different folder"}
        </div>
      )}
      {prompt && <PromptDialog prompt={prompt} />}
    </div>
  );
}

function cancelPrompt(prompt: Prompt | null) {
  if (prompt?.kind === "conflict") prompt.resolve("cancel");
  if (prompt?.kind === "confirm") prompt.resolve(false);
}
function PromptDialog({ prompt }: { prompt: Prompt }) {
  const [all, setAll] = useState(false);
  if (prompt.kind === "confirm")
    return (
      <Dialog title={prompt.title} onCancel={() => prompt.resolve(false)}>
        <p>{prompt.message}</p>
        <div className="dialog-actions">
          <button data-autofocus onClick={() => prompt.resolve(false)}>
            Cancel
          </button>
          <button className="danger" onClick={() => prompt.resolve(true)}>
            {prompt.action}
          </button>
        </div>
      </Dialog>
    );
  const { conflict, remaining } = prompt;
  const kind = (directory: boolean) => (directory ? "folder" : "file");
  const decide = (resolution: "replace" | "keepBoth" | "skip") =>
    prompt.resolve({ resolution, all });
  return (
    <Dialog
      title="Item already exists"
      onCancel={() => prompt.resolve("cancel")}
    >
      <p>
        {conflict.same
          ? `“${conflict.name}” is already in this folder.`
          : `A ${kind(conflict.targetDirectory)} named “${conflict.name}” already exists in the destination.`}
        {!conflict.same &&
          ` Replace moves the existing ${kind(conflict.targetDirectory)} to the Trash.`}
      </p>
      {remaining > 0 && (
        <label className="fm-apply-all">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />{" "}
          Do this for the remaining {remaining}{" "}
          {remaining === 1 ? "conflict" : "conflicts"}
        </label>
      )}
      <div className="dialog-actions">
        <button onClick={() => prompt.resolve("cancel")}>Cancel</button>
        <button data-autofocus onClick={() => decide("skip")}>
          Skip
        </button>
        <button onClick={() => decide("keepBoth")}>Keep both</button>
        {!conflict.same && (
          <button className="danger" onClick={() => decide("replace")}>
            Replace
          </button>
        )}
      </div>
    </Dialog>
  );
}

function PinMenu({
  x,
  y,
  current,
  isPinned,
  onActivate,
  onToggle,
  onError,
  onClose,
}: {
  x: number;
  y: number;
  current: string | null;
  isPinned: (path: string) => boolean;
  onActivate: (path: string, kind: string) => void;
  onToggle: (path: string) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { pins: list, error } = usePins();
  useDismiss(ref, onClose);
  const position = usePlacement(ref, x, y);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);
  const guard = (work: Promise<unknown>) => void work.catch(onError);
  return (
    <Popup
      ref={ref}
      label="Pinned items"
      role="dialog"
      style={position}
      onClose={onClose}
    >
      <div className="pin-list">
        {list.map((pin, index) => (
          <div
            key={pin.id}
            className={`pin-row ${pin.missing ? "missing" : ""}`}
          >
            <button
              className="pin-open"
              title={pin.missing ? `${pin.path} (missing)` : pin.path}
              disabled={pin.missing}
              onClick={() => onActivate(pin.path, pin.kind)}
            >
              <span className="fm-icon">
                {pin.kind === "directory" ? <FolderIcon /> : <FileIcon />}
              </span>
              <span className="fm-label">{pin.name}</span>
              {pin.missing && <span className="pin-missing">Missing</span>}
            </button>
            <button
              aria-label={`Move ${pin.name} up`}
              disabled={index === 0}
              onClick={() => guard(pins.move(pin.id, -1))}
            >
              ▲
            </button>
            <button
              aria-label={`Move ${pin.name} down`}
              disabled={index === list.length - 1}
              onClick={() => guard(pins.move(pin.id, 1))}
            >
              ▼
            </button>
            <button
              aria-label={`Unpin ${pin.name}`}
              onClick={() => guard(pins.remove(pin.id))}
            >
              ×
            </button>
          </div>
        ))}
        {!list.length && (
          <p className="muted pin-empty">
            Nothing pinned. Right-click a file or folder and choose Pin.
          </p>
        )}
        {error && <p className="pin-error">{error}</p>}
      </div>
      {current && (
        <button className="pin-current" onClick={() => onToggle(current)}>
          {isPinned(current) ? "Unpin this folder" : "Pin this folder"}
        </button>
      )}
    </Popup>
  );
}

/** The This PC page: the drives with their used space; a click opens one. */
function Drives({
  drives,
  onOpen,
}: {
  drives: Drive[] | null;
  onOpen: (path: string) => void;
}) {
  if (!drives) return <p className="fm-state muted">Loading…</p>;
  return (
    <ul className="fm-drives" aria-label="Drives">
      {drives.map((drive) => {
        const used =
          drive.total && drive.free !== null
            ? (drive.total - drive.free) / drive.total
            : null;
        return (
          <li key={drive.path}>
            <button
              className="fm-drive"
              title={drive.path}
              onClick={() => onOpen(drive.path)}
            >
              <span className="fm-drive-icon">
                <DriveIcon />
              </span>
              <span className="fm-drive-text">
                <span className="fm-label">{drive.name}</span>
                {used !== null && (
                  <span
                    className={`fm-drive-bar${used > 0.9 ? " full" : ""}`}
                    role="meter"
                    aria-label={`${drive.name} used`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(used * 100)}
                  >
                    <span style={{ width: `${used * 100}%` }} />
                  </span>
                )}
                <span className="fm-drive-space muted">
                  {drive.total !== null && drive.free !== null
                    ? `${formatSize(drive.free)} free of ${formatSize(drive.total)}`
                    : drive.kind === "network"
                      ? "Network drive"
                      : "Not available"}
                </span>
              </span>
            </button>
          </li>
        );
      })}
      {!drives.length && <p className="fm-state muted">No drives found.</p>}
    </ul>
  );
}
