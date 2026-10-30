import { useEffect, useMemo, useRef, useState } from "react";
import type { ViewProps } from "../contract";
import { Dialog } from "../../components/Dialog";
import { Menu, type MenuItem } from "../../components/Menu";
import { fileSystem } from "../../services/filesystem";
import {
  BranchIcon,
  DebugIcon,
  DiscardIcon,
  FileIcon,
  FilesIcon,
  ListIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  TodoIcon,
} from "../../components/Icons";
import { DockToggle } from "./Panel";
import { Sections, useSectionState } from "./Sections";
import { RunAndDebug } from "./RunAndDebug";
import { Todos } from "./TodoView";
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
import { keysOf } from "../../workspace/keybindings";
import {
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
import { baseName, join, parent, pathKey, relative, within } from "./paths";

const GIT_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  U: "Untracked",
  C: "Conflict",
};

/** Moves open documents along with a renamed or moved file or folder. */
function followRename(from: string, to: string) {
  for (const doc of allDocuments()) {
    if (!doc.path || !within(from, doc.path)) continue;
    const rest = relative(from, doc.path);
    const path = rest ? join(to, rest) : to;
    updateDocument(doc.id, { path, name: baseName(path) });
  }
}

export default function Project({
  instanceId,
  focused,
  collapsed,
  onCollapse,
}: ViewProps) {
  const project = useProject(instanceId);
  const ref = useRef<HTMLDivElement>(null);
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
      />
    </div>
  );
}

const VIEW_TITLES: Record<ProjectState["view"], string> = {
  explorer: "Explorer",
  search: "Search",
  scm: "Source Control",
  debug: "Run and Debug",
  todos: "TODOs",
  results: "Results",
};

/** The activity bar and the chosen view; minimized, only the activity bar stays. */
function Sidebar({
  project,
  collapsed,
  onCollapse,
}: {
  project: ProjectState;
  collapsed: boolean;
  onCollapse?: (collapsed: boolean) => void;
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
  const tabs: [ProjectState["view"], () => React.JSX.Element][] = [
    ["explorer", FilesIcon],
    ["search", SearchIcon],
    ["scm", BranchIcon],
    ["debug", DebugIcon],
    ["todos", TodoIcon],
  ];
  if (results) tabs.push(["results", ListIcon]);
  const view =
    project.view === "results" && !results ? "explorer" : project.view;
  const changes = project.git?.changes.length ?? 0;
  // As in most code editors: the shown view's icon minimizes, another one restores.
  function pick(id: ProjectState["view"]) {
    if (collapsed) {
      setView(project.id, id);
      onCollapse?.(false);
    } else if (id === view) onCollapse?.(true);
    else setView(project.id, id);
  }
  return (
    <div className="project-layout">
      <div
        className="project-activity"
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
          ) : view === "todos" ? (
            <Todos project={project} />
          ) : (
            results && (
              <ResultList
                title={results.title}
                items={results.items}
                root={project.root}
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
  useEffect(() => {
    void refreshGit(project.id);
  }, [project.id]);
  if (!project.git)
    return (
      <p className="project-hint">
        This folder is not in a Git repository, or Git is not available.
      </p>
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
    open(change.path);
  }
  function open(path: string) {
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
    const actions = (items: GitChange[], all: boolean) => {
      const label = (verb: string) =>
        all ? `${verb} All ${title}` : `${verb} ${baseName(items[0].path)}`;
      const hint = (verb: string) => `${verb}${all ? " All" : ""} Changes`;
      return (
        <span className="scm-actions">
          {!all && (
            <button
              type="button"
              aria-label={`Open ${baseName(items[0].path)}`}
              title="Open File"
              onClick={() => open(items[0].path)}
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
          <ul className="project-scm-list" aria-label={title}>
            {list.map((change) => {
              const folder = relative(root, parent(change.path));
              const status = (inIndex ? change.staged : change.unstaged)!;
              return (
                <li key={pathKey(change.path)} className="scm-row">
                  <button
                    type="button"
                    className={`project-row git-${status}`}
                    title={`${GIT_LABELS[status]}: ${relative(root, change.path)}`}
                    onClick={() => show(change, inIndex)}
                  >
                    <span className="project-label">
                      {baseName(change.path)}
                    </span>
                    {folder && (
                      <span className="project-scm-folder">{folder}</span>
                    )}
                  </button>
                  {actions([change], false)}
                  <span className={`project-git git-${status}`}>{status}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };
  return (
    <div className="project-scm">
      <div className="project-branch muted" title="Branch">
        {project.git.branch}
      </div>
      {staged.length > 0 && group("staged", "Staged Changes", staged, true)}
      {group("changes", "Changes", unstaged, false)}
      {!sorted.length && <p className="project-hint">No changes.</p>}
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
    path: string;
    started: boolean;
    target: string | null;
  } | null>(null);
  const suppressClick = useRef(false);
  const [over, setOver] = useState<string | null>(null);
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

  async function open(entry: Entry, side = false) {
    select(project.id, entry.path);
    if (entry.directory) await toggle(project.id, entry.path);
    else await reveal(entry.path, 0, { side });
  }
  async function remove(entry: Entry) {
    const choice = await host().ask(
      "Move to Trash",
      `Move ${entry.name} to the Trash?${entry.directory ? " Everything in the folder goes with it." : ""} Open tabs keep their text.`,
      ["Move to Trash", "Cancel"],
    );
    if (choice !== "Move to Trash") return;
    const failures = await fileSystem.trash([entry.path]);
    if (failures.length)
      throw new Error(failures.map((f) => f.error).join("\n"));
    await reload(project.id);
  }
  async function move(source: string, target: string) {
    if (pathKey(parent(source)) === pathKey(target) || within(source, target))
      return;
    const plan = await fileSystem.plan([source], target, "move");
    if (plan.conflicts.length)
      throw new Error(
        `${baseName(source)} already exists in ${baseName(target)}. Nothing was moved.`,
      );
    const report = await fileSystem.transfer(
      {
        id: crypto.randomUUID(),
        sources: [source],
        destination: target,
        mode: "move",
        resolutions: {},
      },
      () => {},
    );
    if (report.failed.length)
      throw new Error(
        report.failed.map((f) => `${f.name}: ${f.error}`).join("\n"),
      );
    followRename(source, join(target, baseName(source)));
    await reload(project.id);
  }
  const menuItems = (entry: Entry | null): MenuItem[] => {
    const items: MenuItem[] = [
      {
        label: "New File…",
        action: () =>
          setEdit({
            kind: "create",
            parent: folderOf(entry),
            directory: false,
          }),
      },
      {
        label: "New Folder…",
        action: () =>
          setEdit({ kind: "create", parent: folderOf(entry), directory: true }),
      },
    ];
    if (!entry) return items;
    if (!entry.directory)
      items.unshift(
        { label: "Open", action: () => void open(entry).catch(report) },
        {
          label: "Open to the Side",
          action: () => void open(entry, true).catch(report),
        },
        "separator",
      );
    items.push(
      "separator",
      {
        label: "Rename…",
        shortcut: "F2",
        action: () => setEdit({ kind: "rename", entry }),
      },
      {
        label: "Move to Trash…",
        shortcut: "Delete",
        action: () => void remove(entry).catch(report),
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

  function keyDown(event: React.KeyboardEvent) {
    if ((event.target as HTMLElement).closest("input")) return;
    const index = visible.findIndex((r) => r === selected);
    const at = (i: number) => {
      const row = visible[Math.max(0, Math.min(visible.length - 1, i))];
      if (row) select(project.id, row.entry.path);
    };
    const entry = selected?.entry;
    if (event.key === "ArrowDown") at(index + 1);
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
    else if (event.key === "F2" && entry) setEdit({ kind: "rename", entry });
    else if (event.key === "Delete" && entry && !event.shiftKey)
      void remove(entry).catch(report);
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
        const allowed =
          pathKey(parent(d.path)) !== pathKey(target) &&
          !within(d.path, target);
        d.target = allowed ? target : null;
        setOver(allowed ? pathKey(target) : null);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d?.started) return;
        suppressClick.current = true;
        setOver(null);
        if (d.target) void move(d.path, d.target).catch(report);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setOver(null);
      }}
    >
      {project.errors.get(pathKey(root)) && (
        <p className="project-error" role="alert">
          {project.errors.get(pathKey(root))}
        </p>
      )}
      {visible.map(({ entry, depth }) => {
        const key = pathKey(entry.path);
        const status = state(entry.path);
        const isOpen = entry.directory && project.expanded.has(key);
        const active = selected?.entry === entry;
        return (
          <div
            key={key}
            role="treeitem"
            aria-level={depth + 1}
            aria-expanded={entry.directory ? isOpen : undefined}
            aria-selected={active}
            tabIndex={
              active || (!selected && depth === 0 && entry === visible[0].entry)
                ? 0
                : -1
            }
            className={`project-row${over === key ? " drop-target" : ""}${status ? ` git-${status.status}` : ""}${ignored(entry.path) ? " git-ignored" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            data-path={entry.path}
            data-directory={entry.directory ? "true" : undefined}
            onPointerDown={(event) => {
              if (event.button === 0)
                drag.current = {
                  pointer: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  path: entry.path,
                  started: false,
                  target: null,
                };
            }}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              void open(entry).catch(report);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              select(project.id, entry.path);
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
            <span className="project-label">{entry.name}</span>
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
      {menu && (
        <Menu
          label="File actions"
          items={menuItems(menu.entry)}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
      {edit && (
        <NameDialog
          edit={edit}
          onCancel={() => setEdit(null)}
          onDone={async (name) => {
            if (edit.kind === "create") {
              const entry = await fileSystem.create(
                edit.parent,
                name,
                edit.directory,
              );
              if (
                !project.expanded.has(pathKey(edit.parent)) &&
                pathKey(edit.parent) !== pathKey(root)
              )
                await toggle(project.id, edit.parent);
              await reload(project.id);
              select(project.id, entry.path);
              if (!edit.directory) await reveal(entry.path);
            } else {
              const entry = await fileSystem.rename(edit.entry.path, name);
              followRename(edit.entry.path, entry.path);
              await reload(project.id);
              select(project.id, entry.path);
            }
            setEdit(null);
          }}
        />
      )}
    </div>
  );
}

function NameDialog({
  edit,
  onCancel,
  onDone,
}: {
  edit: Edit;
  onCancel: () => void;
  onDone: (name: string) => Promise<void>;
}) {
  const initial = edit.kind === "rename" ? edit.entry.name : "";
  const [name, setName] = useState(initial);
  const [error, setError] = useState("");
  const title =
    edit.kind === "rename"
      ? `Rename ${edit.entry.name}`
      : edit.directory
        ? "New folder"
        : "New file";
  return (
    <Dialog title={title} onCancel={onCancel}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || name === initial) return onCancel();
          void onDone(name.trim()).catch((e) => setError(message(e)));
        }}
      >
        <label>
          Name{" "}
          <input
            aria-label="Name"
            autoFocus
            value={name}
            onFocus={(event) => {
              // Select the name without its extension, as file managers do.
              const dot = event.currentTarget.value.lastIndexOf(".");
              event.currentTarget.setSelectionRange(
                0,
                dot > 0 ? dot : event.currentTarget.value.length,
              );
            }}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && (
          <p className="settings-warning" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button>{edit.kind === "rename" ? "Rename" : "Create"}</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
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
        <ul className="outline-list">{render(symbols, 0)}</ul>
      ) : (
        <p className="muted">{symbols ? "No symbols." : "Loading…"}</p>
      )}
    </div>
  );
}

function Search({ project }: { project: ProjectState }) {
  const { query, replacement, result, running, error } = project.search;
  const docs = useDocuments();
  const [replacing, setReplacing] = useState(false);
  const report = (e: unknown) => host().report(message(e));
  const toggleOption = (
    key: "matchCase" | "wholeWord" | "regex",
    label: string,
    text: string,
  ) => (
    <button
      type="button"
      className="search-toggle"
      aria-label={label}
      aria-pressed={query[key]}
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
        <div className="search-row">
          <input
            aria-label="Search in project"
            placeholder="Search"
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
          {toggleOption("matchCase", "Match case", "Aa")}
          {toggleOption("wholeWord", "Whole word", "ab")}
          {toggleOption("regex", "Regular expression", ".*")}
        </div>
        <div className="search-row">
          <input
            aria-label="Replace with"
            placeholder="Replace"
            value={replacement}
            onChange={(e) =>
              setSearch(project.id, { replacement: e.target.value })
            }
          />
          <button
            type="button"
            disabled={!result || !total || replacing || running}
            onClick={() => void replaceAll().catch(report)}
          >
            Replace All
          </button>
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
        />
      )}
    </div>
  );
}

function ResultList({
  title,
  items,
  root,
  onClear,
}: {
  title: string;
  items: ResultItem[];
  root: string;
  onClear?: () => void;
}) {
  const groups = new Map<string, ResultItem[]>();
  for (const item of items)
    groups.set(item.path, [...(groups.get(item.path) ?? []), item]);
  return (
    <div className="results">
      <div className="results-title">
        <span>{title}</span>
        {onClear && (
          <button type="button" aria-label="Clear results" onClick={onClear}>
            ×
          </button>
        )}
      </div>
      <ul className="results-list" aria-label={title}>
        {[...groups].map(([path, matches]) => (
          <li key={path}>
            <div className="results-file" title={path}>
              {relative(root, path) ?? path}
            </div>
            <ul>
              {matches.map((m, index) => (
                <li key={index}>
                  <button
                    type="button"
                    className="results-match"
                    onClick={() =>
                      void reveal(path, {
                        line: m.line,
                        column: m.column,
                      }).catch((e) => host().report(e))
                    }
                  >
                    <span className="results-line">{m.line}</span>
                    <span className="results-preview">
                      {m.preview.slice(0, m.offset)}
                      <mark>
                        {m.preview.slice(m.offset, m.offset + m.length)}
                      </mark>
                      {m.preview.slice(m.offset + m.length)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
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
