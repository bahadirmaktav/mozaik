import { useEffect } from "react";
import { ListIcon, RestartIcon } from "../../components/Icons";
import { host, reveal } from "./editors";
import { scanTodos, setByTag, useTodos, type TodoFile } from "./todos";
import { tagColor, type TodoItem } from "./todoModel";
import { useSectionState } from "./Sections";
import { baseName } from "./paths";
import type { Project } from "./projects";

/**
 * Tagged comments of the project, after VS Code's Todo Tree: by file or by tag, each row
 * opening its line. The tags are chosen in Workspace Settings → IDE.
 */
export function Todos({ project }: { project: Project }) {
  const store = useTodos();
  const state = store.projects.get(project.id);
  const { closed, toggle } = useSectionState(project, "todos");
  useEffect(() => {
    if (!state) void scanTodos(project.id);
  }, [project.id, project.root]);
  const total = state?.files.reduce((n, file) => n + file.items.length, 0) ?? 0;
  const groups: { id: string; title: string; hint?: string; rows: Row[] }[] =
    store.byTag
      ? byTag(state?.files ?? [], store.tags)
      : (state?.files ?? []).map((file) => ({
          id: `file:${file.relative}`,
          title: file.relative,
          hint: file.path,
          rows: file.items.map((item) => ({ item, path: file.path })),
        }));
  return (
    <div className="todo-view">
      <div className="todo-bar">
        <span className="muted">
          {state?.running && !total
            ? "Searching…"
            : `${total} item${total === 1 ? "" : "s"}${state?.truncated ? " (first results only)" : ""}`}
        </span>
        <button
          type="button"
          aria-label={store.byTag ? "Group by File" : "Group by Tag"}
          title={store.byTag ? "Group by File" : "Group by Tag"}
          aria-pressed={store.byTag}
          onClick={() => setByTag(!store.byTag)}
        >
          <ListIcon />
        </button>
        <button
          type="button"
          aria-label="Refresh"
          title="Refresh"
          disabled={state?.running}
          onClick={() => void scanTodos(project.id)}
        >
          <RestartIcon />
        </button>
      </div>
      {state?.error && (
        <p className="project-error" role="alert">
          {state.error}
        </p>
      )}
      {!store.tags.length ? (
        <p className="project-hint">
          No tags are set: add some in Workspace Settings → IDE.
        </p>
      ) : (
        state &&
        !state.running &&
        !state.error &&
        !total && (
          <p className="project-hint">
            No {store.tags.join(", ")} comments in this project.
          </p>
        )
      )}
      <ul className="todo-list" aria-label="TODOs">
        {groups.map((group) => {
          const open = !closed.has(group.id);
          return (
            <li key={group.id}>
              <button
                type="button"
                className="todo-group"
                aria-expanded={open}
                title={group.hint}
                onClick={() => toggle(group.id)}
              >
                <span className="project-twisty" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
                <span className="todo-group-name">{group.title}</span>
                <span className="project-count">{group.rows.length}</span>
              </button>
              {open && (
                <ul>
                  {group.rows.map(({ item, path }) => (
                    <li key={`${path}:${item.line}:${item.column}`}>
                      <button
                        type="button"
                        className="todo-item"
                        title={`${item.tag} ${item.text}`}
                        onClick={() =>
                          void reveal(path, {
                            line: item.line,
                            column: item.column,
                          }).catch((e) => host().report(e))
                        }
                      >
                        <span
                          className="todo-tag"
                          style={{ color: tagColor(item.tag) }}
                        >
                          {item.tag}
                        </span>
                        <span className="todo-text">
                          {item.text || (store.byTag ? baseName(path) : "")}
                        </span>
                        <span className="todo-place">
                          {store.byTag
                            ? `${baseName(path)}:${item.line}`
                            : item.line}
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

interface Row {
  item: TodoItem;
  path: string;
}
/** Groups in the order of the settings' tags. */
function byTag(files: TodoFile[], tags: string[]) {
  const rows = new Map<string, Row[]>();
  for (const file of files)
    for (const item of file.items)
      rows.set(item.tag, [
        ...(rows.get(item.tag) ?? []),
        { item, path: file.path },
      ]);
  return tags
    .filter((tag) => rows.has(tag))
    .map((tag) => ({ id: `tag:${tag}`, title: tag, rows: rows.get(tag)! }));
}
