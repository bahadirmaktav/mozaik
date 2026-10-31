import { useEffect, useRef } from "react";
import { rows } from "../ide/model";
import { parent, pathKey } from "../ide/paths";
import { CloseIcon } from "../../components/Icons";
import {
  closeFolder,
  select,
  setWidth,
  toggle,
  useFolder,
  type Folder,
} from "./folders";

/**
 * A Text Editor panel's folder, as in Sublime Text's sidebar: a lazy tree whose files open
 * as tabs of the panel. Its right edge resizes it.
 */
export function FolderSidebar({
  panel,
  onOpen,
}: {
  panel: string;
  onOpen: (path: string) => void;
}) {
  const folder = useFolder(panel);
  const tree = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tree.current
      ?.querySelector("[aria-selected=true]")
      ?.scrollIntoView({ block: "nearest" });
  }, [folder?.selected]);
  if (!folder) return null;
  const visible = rows(folder.root, folder.expanded, folder.children);
  const selected = visible.find((r) => r.entry.path === folder.selected);
  const activate = (path: string, directory: boolean) => {
    if (directory) void toggle(panel, path);
    else {
      select(panel, path);
      onOpen(path);
    }
  };
  function keyDown(event: React.KeyboardEvent) {
    const index = selected ? visible.indexOf(selected) : -1;
    const at = (i: number) => {
      const row = visible[Math.max(0, Math.min(visible.length - 1, i))];
      if (row) select(panel, row.entry.path);
    };
    const entry = selected?.entry;
    const open = (path: string) => folder!.expanded.has(pathKey(path));
    if (event.key === "ArrowDown") at(index + 1);
    else if (event.key === "ArrowUp") at(index < 0 ? 0 : index - 1);
    else if (event.key === "Home") at(0);
    else if (event.key === "End") at(visible.length - 1);
    else if (event.key === "ArrowRight" && entry?.directory) {
      if (!open(entry.path)) void toggle(panel, entry.path);
      else at(index + 1);
    } else if (event.key === "ArrowLeft" && entry) {
      if (entry.directory && open(entry.path)) void toggle(panel, entry.path);
      else if (pathKey(parent(entry.path)) !== pathKey(folder!.root))
        select(panel, parent(entry.path));
    } else if (event.key === "Enter" && entry)
      activate(entry.path, entry.directory);
    else return;
    event.preventDefault();
  }
  return (
    <aside
      className="folder-sidebar"
      aria-label={`Folder ${folder.name}`}
      style={{ width: folder.width }}
    >
      <div className="folder-header" title={folder.root}>
        <span className="folder-name">{folder.name}</span>
        <button
          type="button"
          aria-label="Close folder"
          title="Close folder"
          onClick={() => closeFolder(panel)}
        >
          <CloseIcon />
        </button>
      </div>
      <div
        className="project-tree folder-tree"
        role="tree"
        aria-label="Folder files"
        tabIndex={visible.length ? -1 : 0}
        ref={tree}
        onKeyDown={keyDown}
      >
        {folder.errors.get(pathKey(folder.root)) && (
          <p className="project-error" role="alert">
            {folder.errors.get(pathKey(folder.root))}
          </p>
        )}
        {visible.map(({ entry, depth }) => {
          const isOpen =
            entry.directory && folder.expanded.has(pathKey(entry.path));
          const active = selected?.entry === entry;
          return (
            <div
              key={pathKey(entry.path)}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={entry.directory ? isOpen : undefined}
              aria-selected={active}
              tabIndex={
                active || (!selected && entry === visible[0].entry) ? 0 : -1
              }
              className="project-row"
              style={{ paddingLeft: 8 + depth * 14 }}
              title={entry.path}
              onClick={() => activate(entry.path, entry.directory)}
            >
              <span className="project-twisty" aria-hidden>
                {entry.directory ? (isOpen ? "▾" : "▸") : ""}
              </span>
              <span className="project-label">{entry.name}</span>
            </div>
          );
        })}
      </div>
      <Resizer panel={panel} folder={folder} />
    </aside>
  );
}

/** The sidebar's right edge: dragging it sets the width, kept while the panel lives. */
function Resizer({ panel, folder }: { panel: string; folder: Folder }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      className="folder-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize folder"
      aria-valuenow={folder.width}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width: folder.width };
      }}
      onPointerMove={(event) => {
        const s = start.current;
        if (s) setWidth(panel, s.width + event.clientX - s.x);
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
    />
  );
}
