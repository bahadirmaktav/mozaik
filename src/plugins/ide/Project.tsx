import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ViewProps } from "../contract";
import { Dialog } from "../../components/Dialog";
import { InlineName } from "../../components/InlineName";
import { Menu, type MenuItem } from "../../components/Menu";
import { useCommands } from "../../workspace/commands";
import {
  fileSystem,
  type Resolution,
  type TransferMode,
} from "../../services/filesystem";
import {
  getClipboard,
  setClipboard,
  useClipboard,
} from "../file-manager/instances";
import { EntryIcon } from "./fileIcons";
import {
  followRename,
  record,
  recordTransfer,
  redo,
  undo,
  useFileHistory,
} from "../file-manager/history";
import {
  BranchIcon,
  ChevronIcon,
  ClearAllIcon,
  CollapseAllIcon,
  IgnoredFilesIcon,
  ReplaceAllIcon,
  NewFileIcon,
  NewFolderIcon,
  RefreshIcon,
  DebugIcon,
  DiscardIcon,
  FileIcon,
  FilesIcon,
  GearIcon,
  ListIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  TestIcon,
  CoverageIcon,
  TodoIcon,
} from "../../components/Icons";
import { DockToggle } from "./Panel";
import { Sections, useSectionState } from "./Sections";
import { RunAndDebug } from "./RunAndDebug";
import { GitGraph } from "./GitGraph";
import {
  emptySelection,
  select as selectRows,
  type Selection,
} from "../file-manager/model";
import { Todos } from "./TodoView";
import { Testing } from "./TestingView";
import { Coverage } from "./CoverageView";
import {
  ideBackend,
  type GitChange,
  type ProjectSettings,
} from "../../services/ide";
import { defaultCMake } from "../../services/cmake";
import { refresh as refreshCMake } from "./cmake";
import {
  allDocuments,
  getDocument,
  updateDocument,
  useDocuments,
} from "../text-editor/documents";
import {
  current,
  host,
  message,
  reveal,
  setResults,
  useEditors,
  viewOf,
  type ResultItem,
} from "./editors";
import {
  documentSymbols,
  restart,
  serverOf,
  useServers,
  type OutlineSymbol,
} from "./lsp";
import { decorations, ignoredBy, rows, type Entry } from "./model";
import { symbolKind } from "./quick";
import { keysOf, matches } from "../../workspace/keybindings";
import {
  collapseAll,
  openFolder,
  refreshGit,
  reload,
  revealInTree,
  runSearch,
  saveSettings,
  select,
  setSearch,
  setView,
  toggle,
  useProject,
  type Project as ProjectState,
} from "./projects";
import {
  baseName,
  join,
  parent,
  pathKey,
  plainPath,
  relative,
  separator,
  within,
} from "./paths";
import { useFeatures, type Feature } from "./features";

const GIT_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  U: "Untracked",
  C: "Conflict",
};

export default function Project({
  instanceId,
  focused,
  collapsed,
  onCollapse,
}: ViewProps) {
  const project = useProject(instanceId);
  const ref = useRef<HTMLDivElement>(null);
  const commands = useCommands("IDE", instanceId, focused);
  useEffect(() => {
    if (!focused || ref.current?.contains(document.activeElement)) return;
    // The view's own selection first; minimized, the activity bar.
    for (const selector of [
      ".project-main [aria-selected=true]",
      ".project-open",
      ".project-main input",
      "[aria-selected=true]",
      "button",
    ]) {
      const target = ref.current?.querySelector<HTMLElement>(selector);
      if (target) return target.focus();
    }
  }, [focused]);
  if (!project) return null;
  return (
    <div className="project" ref={ref}>
      <Sidebar
        project={project}
        collapsed={!!collapsed}
        onCollapse={onCollapse}
        commands={commands}
      />
    </div>
  );
}

const VIEW_TITLES: Record<ProjectState["view"], string> = {
  explorer: "Explorer",
  search: "Search",
  scm: "Source Control",
  debug: "Run and Debug",
  testing: "Testing",
  coverage: "Coverage",
  todos: "TODOs",
  results: "Results",
};

/** The activity bar and the chosen view; minimized, only the activity bar stays. */
function Sidebar({
  project,
  collapsed,
  onCollapse,
  commands,
}: {
  project: ProjectState;
  collapsed: boolean;
  onCollapse?: (collapsed: boolean) => void;
  commands: RefObject<MenuItem[]>;
}) {
  const { results } = useEditors();
  const [dialog, setDialog] = useState<"settings" | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const report = (e: unknown) => host().report(message(e));
  const open = () => void openFolder(project.id).catch(report);
  const items: MenuItem[] = project.root
    ? [
        {
          label: "Go to File…",
          shortcut: keysOf("palette.files"),
          action: () => host().quickOpen(""),
        },
        { label: "Open Folder…", action: open },
        {
          label: "Refresh",
          action: () => void reload(project.id).catch(report),
        },
        "separator",
        { label: "Problems", action: () => host().showProblems(project.root) },
        { label: "Project Settings…", action: () => setDialog("settings") },
      ]
    : [{ label: "Open Folder…", action: open }];
  items.push("separator", {
    label: "Close IDE",
    action: () => host().closeIde(project.id),
  });
  const on = useFeatures();
  const tabs = (
    [
      ["explorer", FilesIcon],
      ["search", SearchIcon],
      ["scm", BranchIcon, "sourceControl"],
      ["debug", DebugIcon, "debugging"],
      ["testing", TestIcon, "testing"],
      ["coverage", CoverageIcon, "coverage"],
      ["todos", TodoIcon, "todos"],
    ] as [ProjectState["view"], () => React.JSX.Element, Feature?][]
  ).filter(([, , feature]) => !feature || on(feature));
  if (results) tabs.push(["results", ListIcon]);
  // A view whose feature was turned off shows the Explorer.
  const view = tabs.some(([id]) => id === project.view)
    ? project.view
    : "explorer";
  const changes = project.git?.changes.length ?? 0;
  // As in most code editors: the shown view's icon minimizes, another one restores.
  function pick(id: ProjectState["view"]) {
    if (collapsed) {
      setView(project.id, id);
      onCollapse?.(false);
    } else if (id === view) onCollapse?.(true);
    else setView(project.id, id);
  }
  commands.current = [
    ...items,
    ...tabs.map(([id]) => ({
      label: `Show ${VIEW_TITLES[id]}`,
      action: () => {
        setView(project.id, id);
        onCollapse?.(false);
      },
    })),
  ];
  return (
    <div className="project-layout">
      <div className="project-activity">
        <div
          className="project-activity-tabs"
          role="tablist"
          aria-label="Project views"
          aria-orientation="vertical"
        >
          {tabs.map(([id, Glyph]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-label={VIEW_TITLES[id]}
              title={
                id === "scm" && changes
                  ? `${VIEW_TITLES[id]} (${changes} change${changes === 1 ? "" : "s"})`
                  : VIEW_TITLES[id]
              }
              aria-selected={!collapsed && view === id}
              onClick={() => pick(id)}
            >
              <Glyph />
              {id === "scm" && changes > 0 && (
                <span className="activity-badge" aria-hidden>
                  {changes > 99 ? "99+" : changes}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* At the bottom, as in VS Code: Workspace Settings on its IDE tab. */}
        <button
          type="button"
          className="activity-settings"
          aria-label="IDE Settings"
          title="IDE Settings"
          onClick={() => host().openSettings()}
        >
          <GearIcon />
        </button>
      </div>
      {!collapsed && (
        <div className="project-main">
          <div className="project-header ide-bar">
            <span className="ide-bar-title">{VIEW_TITLES[view]}</span>
            <div className="ide-bar-actions">
              <button
                type="button"
                aria-label="Project actions"
                aria-haspopup="menu"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenu(
                    menu ? null : { x: rect.right - 200, y: rect.bottom + 4 },
                  );
                }}
              >
                ⋯
              </button>
              <DockToggle
                collapsed={false}
                label="sidebar"
                onCollapse={onCollapse}
              />
            </div>
          </div>
          {!project.root ? (
            <div className="project-empty">
              <p>Open a project folder to browse, search and edit its code.</p>
              <button className="project-open" onClick={open}>
                Open Folder…
              </button>
            </div>
          ) : view === "explorer" ? (
            <Explorer project={project} />
          ) : view === "search" ? (
            <Search project={project} />
          ) : view === "scm" ? (
            <SourceControl project={project} />
          ) : view === "debug" ? (
            <RunAndDebug project={project} />
          ) : view === "testing" ? (
            <Testing project={project} />
          ) : view === "coverage" ? (
            <Coverage project={project} />
          ) : view === "todos" ? (
            <Todos project={project} />
          ) : (
            results && (
              <ResultList
                title={results.title}
                items={results.items}
                root={project.root}
                lines
                onClear={() => {
                  setResults(null);
                  setView(project.id, "explorer");
                }}
              />
            )
          )}
        </div>
      )}
      {menu && (
        <Menu
          label="Project actions"
          items={items}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
      {dialog === "settings" && (
        <SettingsDialog project={project} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

type GitAction = "stage" | "unstage" | "discard";
/**
 * The project's Git changes in two groups, as in VS Code: Staged Changes and Changes. A row
 * opens its comparison; its buttons open the file, stage, unstage or discard (confirmed;
 * untracked files go to the Trash).
 */
function SourceControl({ project }: { project: ProjectState }) {
  const root = project.root!;
  const { closed, toggle: fold } = useSectionState(project, "scm");
  const [busy, setBusy] = useState(false);
  // Which rows are marked, in one group at a time (a file can be in both groups).
  const [marked, setMarked] = useState<{
    group: string;
    selection: Selection;
  }>({ group: "", selection: emptySelection() });
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    change: GitChange;
    inIndex: boolean;
    list: GitChange[];
  } | null>(null);
  const [graphVersion, setGraphVersion] = useState(0);
  // Each time the view opens: what changed in folders nothing watches shows at once.
  useEffect(() => {
    void refreshGit(project.id);
  }, [project.id]);
  const refreshButton = (
    <button
      type="button"
      aria-label="Refresh Source Control"
      title="Refresh Source Control"
      onClick={() => {
        void refreshGit(project.id);
        setGraphVersion((v) => v + 1);
      }}
    >
      <RefreshIcon />
    </button>
  );
  if (!project.git)
    return (
      <div className="project-scm">
        <div className="todo-bar">
          <span className="muted" />
          {refreshButton}
        </div>
        <p className="project-hint">
          This folder is not in a Git repository, or Git is not available.
        </p>
      </div>
    );
  const sorted = [...project.git.changes].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  const staged = sorted.filter((c) => c.staged);
  const unstaged = sorted.filter((c) => c.unstaged);
  const report = (e: unknown) => host().report(message(e));
  async function act(action: GitAction, list: GitChange[]) {
    if (!list.length || busy) return;
    if (action === "discard") {
      const untracked = list.filter((c) => c.unstaged === "U");
      const name =
        list.length === 1 ? baseName(list[0].path) : `${list.length} files`;
      const choice = await host().ask(
        "Discard changes",
        `Discard the changes in ${name}? ${
          !untracked.length
            ? "Changes that are not staged are lost."
            : untracked.length === list.length
              ? "Untracked files go to the Trash."
              : "Untracked files go to the Trash; the others lose their unstaged changes."
        }`,
        ["Discard", "Cancel"],
      );
      if (choice !== "Discard") return;
    }
    setBusy(true);
    setMarked({ group: "", selection: emptySelection() });
    try {
      const paths = list.map((c) => c.path);
      if (action === "stage") await ideBackend.stage(root, paths);
      else if (action === "unstage") await ideBackend.unstage(root, paths);
      else {
        const tracked = list.filter((c) => c.unstaged !== "U");
        const untracked = list.filter((c) => c.unstaged === "U");
        if (tracked.length)
          await ideBackend.discard(
            root,
            tracked.map((c) => c.path),
          );
        if (untracked.length) {
          const failures = await fileSystem.trash(untracked.map((c) => c.path));
          if (failures.length)
            throw new Error(failures.map((f) => f.error).join("\n"));
          await reload(project.id);
        }
      }
    } finally {
      setBusy(false);
      await refreshGit(project.id);
    }
  }
  function show(change: GitChange, inIndex: boolean) {
    // Untracked items have nothing committed to compare with: the file opens (a folder
    // is shown in the explorer).
    if (inIndex || change.unstaged !== "U")
      return host().showDiff(change.path, inIndex);
    openFile(change.path);
  }
  function openFile(path: string) {
    reveal(path).catch(() => {
      setView(project.id, "explorer");
      void revealInTree(project.id, path);
    });
  }
  const group = (
    id: string,
    title: string,
    list: GitChange[],
    inIndex: boolean,
  ) => {
    const shown = !closed.has(id);
    const run = (action: GitAction, items: GitChange[]) =>
      void act(action, items).catch(report);
    const order = list.map((c) => c.path);
    const selection = marked.group === id ? marked.selection : emptySelection();
    const choose = (next: Selection) =>
      setMarked({ group: id, selection: next });
    /** A marked row's buttons act on every marked row; another row's on itself. */
    const targets = (change: GitChange) =>
      selection.paths.has(change.path)
        ? list.filter((c) => selection.paths.has(c.path))
        : [change];
    const listKey = (event: React.KeyboardEvent<HTMLUListElement>) => {
      const native = event.nativeEvent;
      if (matches(native, "explorer.all")) {
        event.preventDefault();
        choose({
          paths: new Set(order),
          anchor: order[0] ?? null,
          cursor: selection.cursor,
        });
      } else if (event.key === "Escape" && selection.paths.size) {
        event.preventDefault();
        choose(emptySelection());
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const at = selection.cursor ? order.indexOf(selection.cursor) : -1;
        const next = at + (event.key === "ArrowDown" ? 1 : -1);
        const target = order[Math.max(0, Math.min(order.length - 1, next))];
        if (!target) return;
        event.preventDefault();
        choose(selectRows(selection, order, target, { shift: event.shiftKey }));
        event.currentTarget
          .querySelector<HTMLElement>(
            `[data-row="${CSS.escape(target)}"] .project-row`,
          )
          ?.focus();
      }
    };
    const actions = (items: GitChange[], all: boolean) => {
      const many = !all && items.length > 1;
      const label = (verb: string) =>
        all
          ? `${verb} All ${title}`
          : many
            ? `${verb} ${items.length} Files`
            : `${verb} ${baseName(items[0].path)}`;
      const hint = (verb: string) =>
        many
          ? `${verb} ${items.length} Files`
          : `${verb}${all ? " All" : ""} Changes`;
      return (
        <span className="scm-actions">
          {!all && (
            <button
              type="button"
              aria-label={`Open ${baseName(items[0].path)}`}
              title="Open File"
              onClick={() => openFile(items[0].path)}
            >
              <FileIcon />
            </button>
          )}
          {!inIndex && (
            <button
              type="button"
              aria-label={label("Discard")}
              title={hint("Discard")}
              disabled={busy}
              onClick={() => run("discard", items)}
            >
              <DiscardIcon />
            </button>
          )}
          <button
            type="button"
            aria-label={label(inIndex ? "Unstage" : "Stage")}
            title={hint(inIndex ? "Unstage" : "Stage")}
            disabled={busy}
            onClick={() => run(inIndex ? "unstage" : "stage", items)}
          >
            {inIndex ? <MinusIcon /> : <PlusIcon />}
          </button>
        </span>
      );
    };
    return (
      <section className="scm-group" aria-label={title}>
        <div className="scm-group-title">
          <button
            type="button"
            className="project-section"
            aria-expanded={shown}
            onClick={() => fold(id)}
          >
            {shown ? "▾" : "▸"} {title}
          </button>
          {list.length > 0 && actions(list, true)}
          <span className="project-count">{list.length}</span>
        </div>
        {shown && (
          <ul
            className="project-scm-list"
            aria-label={title}
            onKeyDown={listKey}
          >
            {list.map((change) => {
              const folder = relative(root, parent(change.path));
              const status = (inIndex ? change.staged : change.unstaged)!;
              const chosen = selection.paths.has(change.path);
              return (
                <li
                  key={pathKey(change.path)}
                  className={`scm-row${chosen ? " selected" : ""}`}
                  data-row={change.path}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    const next = chosen
                      ? selection
                      : selectRows(selection, order, change.path, {});
                    if (!chosen) choose(next);
                    setMenu({
                      x: event.clientX,
                      y: event.clientY,
                      change,
                      inIndex,
                      list: chosen ? targets(change) : [change],
                    });
                  }}
                >
                  <button
                    type="button"
                    className={`project-row git-${status}`}
                    aria-pressed={chosen}
                    title={`${GIT_LABELS[status]}: ${relative(root, change.path)}`}
                    onClick={(event) => {
                      const ctrl = event.ctrlKey || event.metaKey;
                      choose(
                        selectRows(selection, order, change.path, {
                          ctrl,
                          shift: event.shiftKey,
                        }),
                      );
                      // Ctrl and Shift mark, as in the File Manager; a plain click opens.
                      if (!ctrl && !event.shiftKey) show(change, inIndex);
                    }}
                  >
                    <span className="project-label">
                      {baseName(change.path)}
                    </span>
                    {folder && (
                      <span className="project-scm-folder">{folder}</span>
                    )}
                  </button>
                  {actions(targets(change), false)}
                  <span className={`project-git git-${status}`}>{status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };
  const menuItems = (open: NonNullable<typeof menu>): MenuItem[] => {
    const count = open.list.length;
    const files = count > 1 ? ` ${count} Files` : "";
    const items: MenuItem[] = [];
    if (count === 1)
      items.push(
        {
          label: "Open Changes",
          action: () => show(open.change, open.inIndex),
        },
        { label: "Open File", action: () => openFile(open.change.path) },
        "separator",
      );
    items.push(
      open.inIndex
        ? {
            label: `Unstage${files || " Changes"}`,
            action: () => void act("unstage", open.list).catch(report),
          }
        : {
            label: `Stage${files || " Changes"}`,
            action: () => void act("stage", open.list).catch(report),
          },
    );
    if (!open.inIndex)
      items.push({
        label: `Discard${files || " Changes"}…`,
        action: () => void act("discard", open.list).catch(report),
      });
    return items;
  };
  return (
    <div className="project-scm">
      <Sections
        project={project}
        view="scm"
        sections={[
          {
            id: "list",
            title: project.git.branch,
            label: "Source Control changes",
            size: 3,
            actions: refreshButton,
            body: (
              <div className="scm-lists">
                {staged.length > 0 &&
                  group("staged", "Staged Changes", staged, true)}
                {group("changes", "Changes", unstaged, false)}
                {!sorted.length && <p className="project-hint">No changes.</p>}
              </div>
            ),
          },
          {
            id: "graph",
            title: "Graph",
            size: 2,
            body: <GitGraph project={project} version={graphVersion} />,
          },
        ]}
      />
      {menu && (
        <Menu
          label="Change actions"
          items={menuItems(menu)}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

type Edit =
  | { kind: "create"; parent: string; directory: boolean }
  | { kind: "rename"; entry: Entry };

function Explorer({ project }: { project: ProjectState }) {
  const docs = useDocuments();
  useEditors();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    entry: Entry | null;
  } | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    paths: string[];
    started: boolean;
    target: string | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const [over, setOver] = useState<string | null>(null);
  // The dragged items follow the pointer, as in VS Code.
  const [ghost, setGhost] = useState<{
    x: number;
    y: number;
    name: string;
    directory: boolean;
    count: number;
  } | null>(null);
  // Ctrl/Shift+click marks several rows; without marks the selected row is the selection.
  const [marked, setMarked] = useState<{
    keys: Set<string>;
    anchor: string | null;
  }>({ keys: new Set(), anchor: null });
  const clipboard = useClipboard();
  const history = useFileHistory();
  const cut = new Set(
    clipboard?.mode === "move" ? clipboard.paths.map(pathKey) : [],
  );
  const tree = useRef<HTMLDivElement>(null);
  const root = project.root!;
  const visible = rows(root, project.expanded, project.children);
  const state = useMemo(
    () => decorations(root, project.git?.changes ?? []),
    [root, project.git],
  );
  const ignored = useMemo(
    () => ignoredBy(root, project.git?.ignored ?? []),
    [root, project.git],
  );
  const dirty = new Set(
    docs
      .filter((d) => d.path && d.text !== d.saved)
      .map((d) => pathKey(d.path!)),
  );
  const report = (e: unknown) => host().report(message(e));
  const selected = visible.find(
    (r) =>
      project.selected && pathKey(r.entry.path) === pathKey(project.selected),
  );
  const folderOf = (entry: Entry | null) =>
    !entry ? root : entry.directory ? entry.path : parent(entry.path);
  /** The marked rows, else the selected one, in tree order. */
  const chosen = (): Entry[] => {
    const keys = marked.keys.size
      ? marked.keys
      : new Set(selected ? [pathKey(selected.entry.path)] : []);
    return visible
      .filter((r) => keys.has(pathKey(r.entry.path)))
      .map((r) => r.entry);
  };
  const isMarked = (key: string) =>
    marked.keys.size
      ? marked.keys.has(key)
      : !!selected && pathKey(selected.entry.path) === key;
  /** Ctrl toggles a row, Shift marks the range from the anchor, as in the File Manager. */
  function mark(entry: Entry, how: { ctrl?: boolean; shift?: boolean }) {
    const key = pathKey(entry.path);
    const current = selected ? pathKey(selected.entry.path) : null;
    if (how.shift) {
      const anchor = marked.anchor ?? current ?? key;
      const keys = visible.map((r) => pathKey(r.entry.path));
      const to = keys.indexOf(key);
      const from = keys.indexOf(anchor) < 0 ? to : keys.indexOf(anchor);
      const range = keys.slice(Math.min(from, to), Math.max(from, to) + 1);
      setMarked({
        keys: new Set(how.ctrl ? [...marked.keys, ...range] : range),
        anchor,
      });
    } else if (how.ctrl) {
      const keys = new Set(
        marked.keys.size ? marked.keys : current ? [current] : [],
      );
      if (!keys.delete(key)) keys.add(key);
      setMarked({ keys, anchor: key });
    } else setMarked({ keys: new Set(), anchor: key });
    select(project.id, entry.path);
  }
  function copy(mode: TransferMode) {
    const paths = chosen().map((e) => e.path);
    if (paths.length) setClipboard({ mode, paths });
  }
  /** The chosen rows' paths on the system clipboard, one per line as in VS Code. */
  function copyPaths(fromRoot: boolean) {
    const shown = chosen().map((e) =>
      fromRoot
        ? (relative(root, e.path) ?? e.path).replace(/\//g, separator(root))
        : plainPath(e.path),
    );
    return navigator.clipboard.writeText(shown.join("\n"));
  }
  /** Pastes cut or copied files (also from a File Manager) into `target`. */
  async function paste(target: string) {
    const clip = getClipboard();
    if (!clip) return;
    const sources = clip.paths.filter(
      (s) => clip.mode === "copy" || pathKey(parent(s)) !== pathKey(target),
    );
    if (!sources.length) {
      // Cut and pasted where they are: nothing moves, and they no longer look cut.
      if (clip.mode === "move") setClipboard(null);
      return;
    }
    if (await transfer(sources, target, clip.mode))
      if (clip.mode === "move") setClipboard(null);
  }
  /**
   * Copies or moves files into `target`. A name in use asks Keep Both, Replace or Skip; a
   * file copied onto itself keeps both, as VS Code names a copy.
   */
  async function transfer(
    sources: string[],
    target: string,
    mode: TransferMode,
  ) {
    if (sources.some((s) => within(s, target)))
      throw new Error("A folder cannot be placed inside itself.");
    const { conflicts } = await fileSystem.plan(sources, target, mode);
    const resolutions: Record<string, Resolution> = {};
    for (const c of conflicts) if (c.same) resolutions[c.source] = "keepBoth";
    const others = conflicts.filter((c) => !c.same);
    if (others.length) {
      const names = others.map((c) => c.name).join(", ");
      const choice = await host().ask(
        mode === "copy" ? "Copy" : "Move",
        `${names} already ${others.length === 1 ? "exists" : "exist"} in ${baseName(target)}.`,
        ["Keep Both", "Replace", "Skip", "Cancel"],
      );
      if (choice === "Cancel") return false;
      const resolution: Resolution =
        choice === "Keep Both"
          ? "keepBoth"
          : choice === "Replace"
            ? "replace"
            : "skip";
      for (const c of others) resolutions[c.source] = resolution;
    }
    const report = await fileSystem.transfer(
      {
        id: crypto.randomUUID(),
        sources,
        destination: target,
        mode,
        resolutions,
      },
      () => {},
    );
    recordTransfer(mode, target, resolutions, report);
    // Open tabs follow moved files that kept their name.
    const done = new Set(report.completed.map(pathKey));
    if (mode === "move")
      for (const source of sources) {
        const moved = join(target, baseName(source));
        if (done.has(pathKey(moved))) followRename(source, moved);
      }
    await reload(project.id);
    if (report.completed.length) {
      setMarked({ keys: new Set(done), anchor: null });
      select(project.id, report.completed[0]);
    }
    if (report.failed.length)
      throw new Error(
        report.failed.map((f) => `${f.name}: ${f.error}`).join("\n"),
      );
    return true;
  }

  async function open(entry: Entry, side = false) {
    select(project.id, entry.path);
    if (entry.directory) await toggle(project.id, entry.path);
    else if (!host().showDrawing(entry.path, { side }))
      await reveal(entry.path, undefined, { side });
  }
  /**
   * A click shows the file but keeps the focus in the tree, as in VS Code, so F2, Delete and
   * the clipboard keys act on the row; a double click or Enter goes to the editor.
   */
  async function preview(entry: Entry) {
    await open(entry);
    if (entry.directory) return;
    tree.current
      ?.querySelector<HTMLElement>(`[role=treeitem][tabindex="0"]`)
      ?.focus();
  }
  async function remove(entries: Entry[]) {
    if (!entries.length) return;
    const one = entries.length === 1 ? entries[0] : null;
    const choice = await host().ask(
      "Move to Trash",
      one
        ? `Move ${one.name} to the Trash?${one.directory ? " Everything in the folder goes with it." : ""} Open tabs keep their text.`
        : `Move ${entries.length} items to the Trash? Folders go with everything in them. Open tabs keep their text.`,
      ["Move to Trash", "Cancel"],
    );
    if (choice !== "Move to Trash") return;
    const failures = await fileSystem.trash(entries.map((e) => e.path));
    record({
      kind: "trash",
      paths: entries
        .filter((e) => !failures.some((f) => f.name === e.name))
        .map((e) => e.path),
    });
    setMarked({ keys: new Set(), anchor: null });
    await reload(project.id);
    if (failures.length)
      throw new Error(failures.map((f) => f.error).join("\n"));
  }
  const menuItems = (entry: Entry | null): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: "New File…",
        action: () => void startCreate(entry, false).catch(report),
      },
      {
        label: "New Folder…",
        action: () => void startCreate(entry, true).catch(report),
      },
    ];
    const pasteItem: MenuItem = {
      label: "Paste",
      shortcut: keysOf("explorer.paste"),
      disabled: !clipboard,
      action: () => void paste(folderOf(entry)).catch(report),
    };
    if (!entry)
      return [
        ...items,
        "separator",
        pasteItem,
        {
          label: history.undo ? `Undo ${history.undo}` : "Undo",
          shortcut: keysOf("explorer.undo"),
          disabled: !history.undo,
          action: () => void undo().catch(report),
        },
        {
          label: history.redo ? `Redo ${history.redo}` : "Redo",
          shortcut: keysOf("explorer.redo"),
          disabled: !history.redo,
          action: () => void redo().catch(report),
        },
      ];
    if (!entry.directory)
      items.unshift(
        { label: "Open", action: () => void open(entry).catch(report) },
        {
          label: "Open to the Side",
          action: () => void open(entry, true).catch(report),
        },
        "separator",
      );
    const several = chosen().length > 1;
    items.push(
      "separator",
      {
        label: "Cut",
        shortcut: keysOf("explorer.cut"),
        action: () => copy("move"),
      },
      {
        label: "Copy",
        shortcut: keysOf("explorer.copy"),
        action: () => copy("copy"),
      },
      pasteItem,
      "separator",
      {
        label: "Copy Path",
        action: () => void copyPaths(false).catch(report),
      },
      {
        label: "Copy Relative Path",
        action: () => void copyPaths(true).catch(report),
      },
      "separator",
      {
        label: "Rename",
        shortcut: keysOf("explorer.rename"),
        disabled: several,
        action: () => setEdit({ kind: "rename", entry }),
      },
      {
        label: several ? "Move Selected to Trash…" : "Move to Trash…",
        shortcut: "Delete",
        action: () => void remove(chosen()).catch(report),
      },
    );
    const status = state(entry.path);
    if (!entry.directory && status && status.status !== "D")
      items.push("separator", {
        label: "Open Changes",
        action: () => host().showDiff(entry.path),
      });
    return items;
  };

  /** Starts naming a new file or folder in a row under its folder, as in VS Code. */
  async function startCreate(entry: Entry | null, directory: boolean) {
    const folder = folderOf(entry);
    if (
      pathKey(folder) !== pathKey(root) &&
      !project.expanded.has(pathKey(folder))
    )
      await toggle(project.id, folder);
    setEdit({ kind: "create", parent: folder, directory });
  }
  /** Creates or renames as typed in the row; resolves with the error to show, or null. */
  async function submitName(name: string): Promise<string | null> {
    const current = edit;
    if (!current) return null;
    try {
      if (current.kind === "create") {
        const entry = await fileSystem.create(
          current.parent,
          name,
          current.directory,
        );
        record({
          kind: "create",
          path: entry.path,
          directory: current.directory,
        });
        await reload(project.id);
        select(project.id, entry.path);
        if (!current.directory) await reveal(entry.path);
      } else {
        const entry = await fileSystem.rename(current.entry.path, name);
        record({ kind: "rename", from: current.entry.path, to: entry.path });
        followRename(current.entry.path, entry.path);
        await reload(project.id);
        select(project.id, entry.path);
      }
      return null;
    } catch (e) {
      return message(e);
    }
  }
  function doneNaming() {
    setEdit(null);
    // Back to the tree, unless a new file's editor took the focus.
    requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body)
        return;
      (
        tree.current?.querySelector<HTMLElement>("[aria-selected=true]") ??
        tree.current
      )?.focus();
    });
  }
  const creating = edit?.kind === "create" ? edit : null;
  const naming = (depth: number) =>
    creating && (
      <div
        className="project-row naming"
        style={{ paddingLeft: 8 + depth * 14 }}
        role="presentation"
      >
        <span className="project-twisty" aria-hidden />
        <EntryIcon name="" directory={creating.directory} />
        <InlineName
          label={creating.directory ? "New folder name" : "New file name"}
          initial=""
          submit={submitName}
          onDone={doneNaming}
        />
      </div>
    );

  function keyDown(event: React.KeyboardEvent) {
    if ((event.target as HTMLElement).closest("input")) return;
    const index = visible.findIndex((r) => r === selected);
    // Shift+arrows extend the marked range, as in the File Manager.
    const at = (i: number) => {
      const row = visible[Math.max(0, Math.min(visible.length - 1, i))];
      if (row) mark(row.entry, { shift: event.shiftKey });
    };
    const entry = selected?.entry;
    if (matches(event, "explorer.copy")) copy("copy");
    else if (matches(event, "explorer.cut")) copy("move");
    else if (matches(event, "explorer.paste")) {
      void paste(folderOf(entry ?? null)).catch(report);
    } else if (matches(event, "explorer.undo")) {
      void undo().catch(report);
    } else if (matches(event, "explorer.redo")) {
      void redo().catch(report);
    } else if (matches(event, "explorer.all")) {
      setMarked({
        keys: new Set(visible.map((r) => pathKey(r.entry.path))),
        anchor: null,
      });
    } else if (
      event.key === "Escape" &&
      (marked.keys.size || getClipboard()?.mode === "move")
    ) {
      // As in VS Code: Escape also calls off a cut, and the files look as before.
      setMarked({ keys: new Set(), anchor: null });
      if (getClipboard()?.mode === "move") setClipboard(null);
    } else if (event.key === "ArrowDown") at(index + 1);
    else if (event.key === "ArrowUp") at(index < 0 ? 0 : index - 1);
    else if (event.key === "Home") at(0);
    else if (event.key === "End") at(visible.length - 1);
    else if (event.key === "ArrowRight" && entry?.directory) {
      if (!project.expanded.has(pathKey(entry.path)))
        void toggle(project.id, entry.path);
      else at(index + 1);
    } else if (event.key === "ArrowLeft" && entry) {
      if (entry.directory && project.expanded.has(pathKey(entry.path)))
        void toggle(project.id, entry.path);
      else if (pathKey(parent(entry.path)) !== pathKey(root))
        select(project.id, parent(entry.path));
    } else if (event.key === "Enter" && entry) void open(entry).catch(report);
    else if (matches(event, "explorer.rename") && entry)
      setEdit({ kind: "rename", entry });
    else if (event.key === "Delete" && entry && !event.shiftKey)
      void remove(chosen()).catch(report);
    else return;
    event.preventDefault();
  }
  useEffect(() => {
    tree.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest" });
  }, [project.selected]);

  // The Outline's title names the code file it shows.
  const shownId = current();
  const shown = shownId ? getDocument(shownId) : null;
  const outlined = shown?.path && within(root, shown.path) ? shown : null;
  const files = (
    <div
      className={`project-tree${over === pathKey(root) ? " drop-target" : ""}`}
      role="tree"
      aria-label="Project files"
      tabIndex={visible.length ? -1 : 0}
      ref={tree}
      onKeyDown={keyDown}
      // A click on the empty space below the rows clears the selection, as in VS Code.
      onClick={(event) => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        const target = event.target as HTMLElement;
        if (target.closest("[role=treeitem], .naming")) return;
        setMarked({ keys: new Set(), anchor: null });
        select(project.id, null);
        tree.current?.focus();
      }}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest("[role=treeitem]")) return;
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, entry: null });
      }}
      // Pointer events rather than HTML5 drag: the native file drop handler can swallow
      // HTML5 drags in WebView2 (as in the File Manager).
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d || d.pointer !== event.pointerId) return;
        if (!d.started) {
          if (Math.hypot(event.clientX - d.x, event.clientY - d.y) <= 5) return;
          d.started = true;
          tree.current!.setPointerCapture(event.pointerId);
        }
        const row = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>("[role=treeitem]");
        const target = !row
          ? root
          : row.dataset.directory
            ? row.dataset.path!
            : parent(row.dataset.path!);
        const allowed = d.paths.every(
          (path) =>
            pathKey(parent(path)) !== pathKey(target) && !within(path, target),
        );
        d.target = allowed ? target : null;
        setOver(allowed ? pathKey(target) : null);
        const first = visible.find(
          (r) => pathKey(r.entry.path) === pathKey(d.paths[0]),
        )?.entry;
        setGhost({
          x: event.clientX,
          y: event.clientY,
          name: first?.name ?? baseName(d.paths[0]),
          directory: !!first?.directory,
          count: d.paths.length,
        });
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        setGhost(null);
        if (!d?.started) return;
        suppressClick.current = true;
        setOver(null);
        if (d.target) void transfer(d.paths, d.target, "move").catch(report);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setOver(null);
        setGhost(null);
      }}
    >
      {project.errors.get(pathKey(root)) && (
        <p className="project-error" role="alert">
          {project.errors.get(pathKey(root))}
        </p>
      )}
      {creating && pathKey(creating.parent) === pathKey(root) && naming(0)}
      {visible.map(({ entry, depth }) => {
        const key = pathKey(entry.path);
        const status = state(entry.path);
        const isOpen = entry.directory && project.expanded.has(key);
        const active = selected?.entry === entry;
        return (
          <Fragment key={key}>
            <div
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={entry.directory ? isOpen : undefined}
              aria-selected={isMarked(key)}
              tabIndex={
                active ||
                (!selected && depth === 0 && entry === visible[0].entry)
                  ? 0
                  : -1
              }
              className={`project-row${active ? " focused" : ""}${over === key ? " drop-target" : ""}${cut.has(key) ? " cut" : ""}${status ? ` git-${status.status}` : ""}${ignored(entry.path) ? " git-ignored" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              data-path={entry.path}
              data-directory={entry.directory ? "true" : undefined}
              onPointerDown={(event) => {
                // A marked row drags every marked row; another row drags alone.
                if (event.button === 0 && !event.ctrlKey && !event.shiftKey)
                  drag.current = {
                    pointer: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    paths:
                      marked.keys.size > 1 && marked.keys.has(key)
                        ? chosen().map((e) => e.path)
                        : [entry.path],
                    started: false,
                    target: null,
                  };
              }}
              onClick={(event) => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                const ctrl = event.ctrlKey || event.metaKey;
                mark(entry, { ctrl, shift: event.shiftKey });
                if (!ctrl && !event.shiftKey) void preview(entry).catch(report);
              }}
              onDoubleClick={(event) => {
                if (!entry.directory && !event.ctrlKey && !event.shiftKey)
                  void open(entry).catch(report);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                // Right-clicking outside the marked rows works on that row alone.
                if (!isMarked(key)) mark(entry, {});
                setMenu({ x: event.clientX, y: event.clientY, entry });
              }}
              title={
                status
                  ? status.folder
                    ? "Contains changes"
                    : GIT_LABELS[status.status]
                  : undefined
              }
            >
              <span className="project-twisty" aria-hidden>
                {entry.directory ? (isOpen ? "▾" : "▸") : ""}
              </span>
              <EntryIcon
                name={entry.name}
                directory={entry.directory}
                open={isOpen}
              />
              {edit?.kind === "rename" && pathKey(edit.entry.path) === key ? (
                <InlineName
                  label={`Rename ${entry.name}`}
                  initial={entry.name}
                  stem={!entry.directory}
                  submit={submitName}
                  onDone={doneNaming}
                />
              ) : (
                <span className="project-label">{entry.name}</span>
              )}
              {dirty.has(key) && (
                <span className="project-dirty" aria-label="Unsaved changes">
                  ●
                </span>
              )}
              {status && (
                <span className="project-git" aria-hidden>
                  {status.folder ? "•" : status.status}
                </span>
              )}
            </div>
            {creating && pathKey(creating.parent) === key && naming(depth + 1)}
          </Fragment>
        );
      })}
    </div>
  );
  return (
    <div className="project-explorer">
      <Sections
        project={project}
        view="explorer"
        sections={[
          {
            id: "files",
            title: <span className="project-root">{project.name}</span>,
            label: project.name,
            hint: root,
            size: 3,
            body: files,
            hoverActions: true,
            actions: (
              <>
                <button
                  type="button"
                  aria-label="New File…"
                  title="New File…"
                  onClick={() =>
                    void startCreate(selected?.entry ?? null, false).catch(
                      report,
                    )
                  }
                >
                  <NewFileIcon />
                </button>
                <button
                  type="button"
                  aria-label="New Folder…"
                  title="New Folder…"
                  onClick={() =>
                    void startCreate(selected?.entry ?? null, true).catch(
                      report,
                    )
                  }
                >
                  <NewFolderIcon />
                </button>
                <button
                  type="button"
                  aria-label="Refresh Explorer"
                  title="Refresh Explorer"
                  onClick={() => void reload(project.id).catch(report)}
                >
                  <RefreshIcon />
                </button>
                <button
                  type="button"
                  aria-label="Collapse Folders in Explorer"
                  title="Collapse Folders in Explorer"
                  onClick={() => collapseAll(project.id)}
                >
                  <CollapseAllIcon />
                </button>
              </>
            ),
          },
          {
            id: "outline",
            title: `Outline${outlined ? ` · ${outlined.name}` : ""}`,
            label: "Outline",
            size: 2,
            body: <Outline project={project} />,
          },
        ]}
      />
      {ghost && (
        <div
          className="project-drag-ghost"
          style={{ left: ghost.x + 12, top: ghost.y + 8 }}
          aria-hidden="true"
        >
          <EntryIcon name={ghost.name} directory={ghost.directory} />
          <span className="project-drag-name">
            {ghost.count > 1 ? `${ghost.count} items` : ghost.name}
          </span>
        </div>
      )}
      {menu && (
        <Menu
          label="File actions"
          items={menuItems(menu.entry)}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** The symbols of the current code file; mounted only while its section is open. */
function Outline({ project }: { project: ProjectState }) {
  const editors = useEditors();
  const servers = useServers();
  useDocuments();
  const [symbols, setSymbols] = useState<OutlineSymbol[] | null>(null);
  const [error, setError] = useState("");
  const id = current();
  const doc = id ? getDocument(id) : null;
  const path = doc?.path && within(project.root!, doc.path) ? doc.path : null;
  const server = serverOf(path);
  const text = doc?.text;
  useEffect(() => {
    if (!id || !path || server?.status !== "ready") {
      setSymbols(null);
      return;
    }
    let live = true;
    // Ask again shortly after typing stops, not on every keystroke.
    const timer = setTimeout(() => {
      const view = viewOf(id);
      if (!view) return;
      documentSymbols(view)
        .then((result) => {
          if (live) {
            setSymbols(result);
            setError("");
          }
        })
        .catch((e) => live && setError(message(e)));
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, path, server?.status, text, editors.views.size, servers.version]);
  // This view re-renders with each keystroke; a long file's symbols change only with an answer.
  const tree = useMemo(() => {
    const render = (list: OutlineSymbol[], depth: number): React.ReactNode =>
      list.map((symbol, index) => (
        <li key={`${depth}-${index}-${symbol.name}`}>
          <button
            type="button"
            className="outline-symbol"
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() =>
              path &&
              void reveal(path, symbol.start).catch((e) => host().report(e))
            }
          >
            <span className="outline-kind">{symbolKind(symbol.kind)}</span>
            <span>{symbol.name}</span>
          </button>
          {symbol.children.length > 0 && (
            <ul>{render(symbol.children, depth + 1)}</ul>
          )}
        </li>
      ));
    return symbols && render(symbols, 0);
  }, [symbols, path]);
  return (
    <div className="outline-body">
      {!path ? (
        <p className="muted">Open a file of this project.</p>
      ) : !server ? (
        <p className="muted">No language server for this file type.</p>
      ) : server.status !== "ready" ? (
        <p className="muted">Waiting for the language server.</p>
      ) : error ? (
        <p className="muted">{error}</p>
      ) : symbols?.length ? (
        <ul className="outline-list">{tree}</ul>
      ) : (
        <p className="muted">{symbols ? "No symbols." : "Loading…"}</p>
      )}
    </div>
  );
}

function Search({ project }: { project: ProjectState }) {
  const { query, replacement, result, running, error, showReplace } =
    project.search;
  const docs = useDocuments();
  const [replacing, setReplacing] = useState(false);
  const report = (e: unknown) => host().report(message(e));
  const toggleOption = (
    key: "matchCase" | "wholeWord" | "regex" | "ignored",
    label: string,
    text: React.ReactNode,
  ) => (
    <button
      type="button"
      className="search-toggle"
      aria-label={label}
      aria-pressed={!!query[key]}
      title={label}
      onClick={() =>
        setSearch(project.id, {
          query: { ...query, [key]: !query[key] },
          result: null,
        })
      }
    >
      {text}
    </button>
  );
  const total = result?.files.reduce((n, f) => n + f.matches.length, 0) ?? 0;
  async function replaceAll() {
    if (!result) return;
    const open = result.files.filter((f) =>
      docs.some((d) => d.path && pathKey(d.path) === pathKey(f.path)),
    );
    const closed = result.files.filter((f) => !open.includes(f));
    const choice = await host().ask(
      "Replace in project",
      `Replace ${total} match${total === 1 ? "" : "es"} in ${result.files.length} file${result.files.length === 1 ? "" : "s"}? ${closed.length} closed file${closed.length === 1 ? " is" : "s are"} saved directly; ${open.length} open file${open.length === 1 ? "" : "s"} change in the editor and stay unsaved. A file changed since the search is skipped.`,
      ["Replace", "Cancel"],
    );
    if (choice !== "Replace") return;
    setReplacing(true);
    try {
      const failures: string[] = [];
      for (const file of open) {
        const doc = allDocuments().find(
          (d) => d.path && pathKey(d.path) === pathKey(file.path),
        );
        if (!doc) continue;
        const text = await ideBackend.replaceText(doc.text, query, replacement);
        const view = viewOf(doc.id);
        if (view)
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            userEvent: "input.replace",
          });
        else updateDocument(doc.id, { text });
      }
      if (closed.length) {
        const done = await ideBackend.replace(
          project.root!,
          query,
          replacement,
          closed.map((f) => ({ path: f.path, revision: f.revision })),
        );
        for (const item of done)
          if (item.error)
            failures.push(`${baseName(item.path)}: ${item.error}`);
      }
      await runSearch(project.id);
      void refreshGit(project.id);
      if (failures.length)
        throw new Error(`Some files were not changed:\n${failures.join("\n")}`);
    } finally {
      setReplacing(false);
    }
  }
  return (
    <div className="project-search">
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void runSearch(project.id);
        }}
      >
        <button
          type="button"
          className={`search-twisty${showReplace ? " open" : ""}`}
          aria-label="Toggle Replace"
          title="Toggle Replace"
          aria-expanded={showReplace}
          onClick={() => setSearch(project.id, { showReplace: !showReplace })}
        >
          <ChevronIcon />
        </button>
        <div className="search-fields">
          <div className="search-box">
            <input
              aria-label="Search in project"
              placeholder="Search"
              spellCheck={false}
              value={query.text}
              onKeyDown={(event) => {
                // Two text fields disable implicit form submission.
                if (event.key === "Enter") {
                  event.preventDefault();
                  void runSearch(project.id);
                }
              }}
              onChange={(e) =>
                setSearch(project.id, {
                  query: { ...query, text: e.target.value },
                  result: null,
                })
              }
            />
            {toggleOption("matchCase", "Match Case", "Aa")}
            {toggleOption("wholeWord", "Match Whole Word", "ab")}
            {toggleOption("regex", "Use Regular Expression", ".*")}
            {toggleOption(
              "ignored",
              "Search Files Ignored by Git",
              <IgnoredFilesIcon />,
            )}
          </div>
          {showReplace && (
            <div className="search-replace">
              <div className="search-box">
                <input
                  aria-label="Replace with"
                  placeholder="Replace"
                  spellCheck={false}
                  value={replacement}
                  onChange={(e) =>
                    setSearch(project.id, { replacement: e.target.value })
                  }
                />
              </div>
              <button
                type="button"
                className="search-action"
                aria-label="Replace All"
                title="Replace All"
                disabled={!result || !total || replacing || running}
                onClick={() => void replaceAll().catch(report)}
              >
                <ReplaceAllIcon />
              </button>
            </div>
          )}
        </div>
      </form>
      {running && <p className="muted">Searching…</p>}
      {error && (
        <p className="project-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <ResultList
          title={`${total} result${total === 1 ? "" : "s"} in ${result.files.length} file${result.files.length === 1 ? "" : "s"}${result.truncated ? " (first results only)" : ""}${result.skipped ? ` · ${result.skipped} skipped` : ""}`}
          items={result.files.flatMap((f) =>
            f.matches.map((m) => ({ path: f.path, ...m })),
          )}
          root={project.root!}
          onRefresh={() => void runSearch(project.id)}
          onClear={() => setSearch(project.id, { result: null })}
        />
      )}
    </div>
  );
}

/**
 * Results by file, as in VS Code's Search: a file's row folds its matches and counts them;
 * a project search leaves out line numbers, which `lines` keeps for other answers.
 */
function ResultList({
  title,
  items,
  root,
  lines = false,
  onRefresh,
  onClear,
}: {
  title: string;
  items: ResultItem[];
  root: string;
  lines?: boolean;
  onRefresh?: () => void;
  onClear?: () => void;
}) {
  const groups = new Map<string, ResultItem[]>();
  for (const item of items)
    groups.set(item.path, [...(groups.get(item.path) ?? []), item]);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const allFolded = folded.size > 0 && folded.size >= groups.size;
  const toggleFile = (path: string) => {
    const next = new Set(folded);
    if (!next.delete(path)) next.add(path);
    setFolded(next);
  };
  return (
    <div className="results">
      <div className="results-title">
        <span>{title}</span>
        {onRefresh && (
          <button
            type="button"
            aria-label="Refresh Results"
            title="Refresh"
            onClick={onRefresh}
          >
            <RefreshIcon />
          </button>
        )}
        <button
          type="button"
          aria-label={allFolded ? "Expand All" : "Collapse All"}
          title={allFolded ? "Expand All" : "Collapse All"}
          onClick={() =>
            setFolded(allFolded ? new Set() : new Set(groups.keys()))
          }
        >
          <CollapseAllIcon />
        </button>
        {onClear && (
          <button
            type="button"
            aria-label="Clear results"
            title="Clear Search Results"
            onClick={onClear}
          >
            <ClearAllIcon />
          </button>
        )}
      </div>
      <ul className="results-list" aria-label={title}>
        {[...groups].map(([path, matches]) => {
          const shown = !folded.has(path);
          const folder = relative(root, parent(path));
          return (
            <li key={path}>
              <button
                type="button"
                className="results-file"
                aria-expanded={shown}
                title={path}
                onClick={() => toggleFile(path)}
              >
                <span
                  className={`pane-twisty${shown ? " open" : ""}`}
                  aria-hidden
                >
                  <ChevronIcon />
                </span>
                <EntryIcon name={baseName(path)} directory={false} />
                <span className="results-name">{baseName(path)}</span>
                {folder && <span className="results-folder">{folder}</span>}
                <span className="results-count">{matches.length}</span>
              </button>
              {shown && (
                <ul>
                  {matches.map((m, index) => (
                    <li key={index}>
                      <button
                        type="button"
                        className="results-match"
                        title={`Line ${m.line}`}
                        onClick={() =>
                          void reveal(path, {
                            line: m.line,
                            column: m.column,
                          }).catch((e) => host().report(e))
                        }
                      >
                        {lines && (
                          <span className="results-line">{m.line}</span>
                        )}
                        <span className="results-preview">
                          {m.preview.slice(0, m.offset).trimStart()}
                          <mark>
                            {m.preview.slice(m.offset, m.offset + m.length)}
                          </mark>
                          {m.preview.slice(m.offset + m.length)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SettingsDialog({
  project,
  onClose,
}: {
  project: ProjectState;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<ProjectSettings>(project.settings);
  const [exclude, setExclude] = useState(project.settings.exclude.join("\n"));
  const cmake = { ...defaultCMake, ...project.settings.cmake };
  const target = cmake.runTarget;
  const [source, setSource] = useState(cmake.sourceDirectory);
  const [args, setArgs] = useState(
    (target && cmake.launch[target]?.args.join("\n")) || "",
  );
  const [cwd, setCwd] = useState((target && cmake.launch[target]?.cwd) || "");
  const [error, setError] = useState("");
  return (
    <Dialog title="Project settings" onCancel={onClose}>
      <form
        className="project-settings"
        onSubmit={(event) => {
          event.preventDefault();
          const launch = { ...cmake.launch };
          if (target) {
            const list = args.split("\n").filter((a) => a.trim());
            if (list.length || cwd.trim())
              launch[target] = { args: list, cwd: cwd.trim() };
            else delete launch[target];
          }
          const next = {
            ...settings,
            exclude: exclude
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean),
            cmake: { ...cmake, sourceDirectory: source.trim(), launch },
          };
          void saveSettings(project.id, next)
            .then(() => {
              if (source.trim() !== cmake.sourceDirectory) {
                void refreshCMake(project.id);
                restart(project.root!);
              }
              onClose();
            })
            .catch((e) => setError(message(e)));
        }}
      >
        <p className="muted" title={project.root!}>
          {project.root}
        </p>
        <label>
          <input
            type="checkbox"
            checked={settings.formatOnSave}
            onChange={(e) =>
              setSettings({ ...settings, formatOnSave: e.target.checked })
            }
          />{" "}
          Format on save (with the language server)
        </label>
        <label>
          Tab size{" "}
          <input
            type="number"
            min={1}
            max={16}
            aria-label="Tab size"
            value={settings.tabSize}
            onChange={(e) =>
              setSettings({ ...settings, tabSize: Number(e.target.value) || 4 })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.insertSpaces}
            onChange={(e) =>
              setSettings({ ...settings, insertSpaces: e.target.checked })
            }
          />{" "}
          Indent with spaces
        </label>
        <label className="project-exclude">
          Exclude from quick open and search (one pattern per line, .gitignore
          syntax)
          <textarea
            aria-label="Exclude patterns"
            rows={4}
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>CMake</legend>
          <label className="project-exclude">
            Source folder (with the top CMakeLists.txt; empty is the project)
            <input
              aria-label="CMake source folder"
              placeholder="."
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          {target ? (
            <>
              <label className="project-exclude">
                Run arguments for {target} (one per line)
                <textarea
                  aria-label="Run arguments"
                  rows={3}
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                />
              </label>
              <label className="project-exclude">
                Working folder (relative to the source folder; empty is the
                program's folder)
                <input
                  aria-label="Working folder"
                  value={cwd}
                  onChange={(e) => setCwd(e.target.value)}
                />
              </label>
            </>
          ) : (
            <p className="muted">
              Choose a run target to give it arguments and a working folder.
            </p>
          )}
        </fieldset>
        <fieldset>
          <legend>Language server</legend>
          <p className="muted">
            clangd and CMake programs are chosen in Workspace Settings → IDE.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => restart(project.root!)}>
              Restart server
            </button>
          </div>
        </fieldset>
        {error && (
          <p className="settings-warning" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button>Save</button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
