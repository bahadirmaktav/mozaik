import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import type { ViewProps } from "../contract";
import { Dialog } from "../../components/Dialog";
import { Menu, type MenuItem } from "../../components/Menu";
import { BackIcon, ChevronIcon, GripIcon } from "../../components/Icons";
import {
  ALL,
  INBOX,
  priorities,
  priorityLabel,
  statuses,
  statusLabel,
  type Status,
  type Task,
  type TaskList,
  type TasksDocument,
} from "../../services/tasks";
import { anchors, groups, listName, selectedList, step } from "./model";
import { Markdown } from "../../components/Markdown";
import {
  commit,
  current,
  discardDraft,
  draftOf,
  navigate,
  refresh,
  setDraft,
  tasks,
  toggleSection,
  useTasks,
  type TasksView,
} from "./store";

type Prompt =
  | { kind: "new-list" }
  | { kind: "manage" }
  | { kind: "delete-task"; task: Task }
  | null;
type DropTarget = { status: Status; index: number };
interface Drag {
  id: string;
  from: Status;
  pointer: number;
  x: number;
  y: number;
  started: boolean;
  target: DropTarget | null;
}

export default function TasksPanel({ instanceId, focused }: ViewProps) {
  const {
    document: doc,
    loading,
    loadError,
    error,
    view,
  } = useTasks(instanceId);
  const root = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const opener = useRef<Element | null>(null);
  // The task whose row gets focus when the list is shown again.
  const returnTo = useRef<string | null>(null);

  function focusDefault() {
    const target =
      root.current?.querySelector<HTMLElement>("[data-autofocus]") ??
      root.current;
    target?.focus();
  }
  useEffect(() => {
    if (focused && !root.current?.contains(document.activeElement))
      focusDefault();
  }, [focused]);
  function ask(next: Prompt) {
    opener.current = document.activeElement;
    setPrompt(next);
  }
  function closePrompt() {
    setPrompt(null);
    // Return focus after the dialog has closed and the screen has settled.
    setTimeout(() => {
      const previous = opener.current as HTMLElement | null;
      if (previous?.isConnected && root.current?.contains(previous))
        previous.focus();
      else focusDefault();
    });
  }

  if (!view) return null;
  if (!doc)
    return (
      <div className="tasks" ref={root} tabIndex={-1}>
        <div className="tasks-state">
          {loadError ? (
            <>
              <p role="alert">{loadError}</p>
              <button onClick={() => void refresh()}>Try again</button>
            </>
          ) : (
            <p className="muted">{loading ? "Loading tasks…" : ""}</p>
          )}
        </div>
      </div>
    );
  const task =
    view.screen.kind === "task"
      ? doc.tasks.find(
          (t) => view.screen.kind === "task" && t.id === view.screen.id,
        )
      : undefined;
  return (
    <div className="tasks" ref={root} tabIndex={-1}>
      {loadError && (
        <div className="tasks-notice" role="alert">
          <span>{loadError}</span>
          <button onClick={() => void refresh()}>Retry</button>
        </div>
      )}
      {error && (
        <div className="tasks-notice" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss message" onClick={tasks.dismissError}>
            ×
          </button>
        </div>
      )}
      {task ? (
        <TaskDetail
          key={task.id}
          doc={doc}
          task={task}
          back={() => {
            returnTo.current = task.id;
            navigate(instanceId, { kind: "list" });
          }}
          remove={() => ask({ kind: "delete-task", task })}
        />
      ) : (
        <ListScreen
          doc={doc}
          view={view}
          instanceId={instanceId}
          root={root}
          returnTo={returnTo}
          ask={ask}
        />
      )}
      {prompt?.kind === "new-list" && (
        <NewListDialog
          onClose={closePrompt}
          onCreated={() => {
            // Show the new list right away; the panel focus returns to the picker.
            opener.current = null;
          }}
        />
      )}
      {prompt?.kind === "manage" && (
        <ManageLists doc={doc} onClose={closePrompt} />
      )}
      {prompt?.kind === "delete-task" && (
        <Dialog title="Delete task" onCancel={closePrompt}>
          <p>
            “{prompt.task.title}” will be deleted permanently. This cannot be
            undone.
          </p>
          <div className="dialog-actions">
            <button autoFocus onClick={closePrompt}>
              Cancel
            </button>
            <button
              className="danger"
              onClick={() => {
                const id = prompt.task.id;
                closePrompt();
                void tasks.remove(id);
              }}
            >
              Delete
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ListScreen({
  doc,
  view,
  instanceId,
  root,
  returnTo,
  ask,
}: {
  doc: TasksDocument;
  view: TasksView;
  instanceId: string;
  root: RefObject<HTMLDivElement | null>;
  returnTo: RefObject<string | null>;
  ask: (prompt: Prompt) => void;
}) {
  const list = selectedList(doc);
  const grouped = useMemo(() => groups(doc, list), [doc, list]);
  const total = statuses.reduce((n, s) => n + grouped[s].length, 0);
  const [picker, setPicker] = useState<{ x: number; y: number } | null>(null);
  const [adding, setAdding] = useState<Status | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<{
    id: string;
    target: DropTarget | null;
  } | null>(null);

  const focusRow = (id: string) =>
    root.current
      ?.querySelector<HTMLElement>(`[data-task="${CSS.escape(id)}"] .task-open`)
      ?.focus();
  useEffect(() => {
    const id = returnTo.current;
    returnTo.current = null;
    if (id) focusRow(id);
  }, []);
  // Adding moves with the selection: a new list starts without an open quick add.
  useEffect(() => setAdding(null), [list]);

  function cancelDrag() {
    drag.current = null;
    setDragView(null);
  }
  useEffect(() => {
    if (!dragView) return;
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelDrag();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [!!dragView]);
  function targetAt(x: number, y: number, id: string): DropTarget | null {
    const section = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-status]");
    if (!section || !root.current?.contains(section)) return null;
    const status = section.dataset.status as Status;
    // A collapsed section accepts drops at its end.
    if (view.collapsed[status]) return { status, index: Infinity };
    const rows = [
      ...section.querySelectorAll<HTMLElement>("[data-task]"),
    ].filter((row) => row.dataset.task !== id);
    const index = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return { status, index: index < 0 ? rows.length : index };
  }
  function handleDown(event: PointerEvent<HTMLElement>, task: Task) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: task.id,
      from: task.status,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      started: false,
      target: null,
    };
  }
  function handleMove(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    if (!d.started && Math.hypot(event.clientX - d.x, event.clientY - d.y) <= 4)
      return;
    d.started = true;
    d.target = targetAt(event.clientX, event.clientY, d.id);
    setDragView({ id: d.id, target: d.target });
  }
  function handleUp(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    cancelDrag();
    if (!d.started || !d.target) return;
    const group = grouped[d.target.status],
      rest = group.filter((t) => t.id !== d.id);
    const index = Math.min(d.target.index, rest.length);
    if (
      d.target.status === d.from &&
      group.findIndex((t) => t.id === d.id) === index
    )
      return;
    const { before, after } = anchors(rest, index);
    void tasks.move(d.id, d.target.status, before, after);
  }
  function rowKey(event: KeyboardEvent<HTMLButtonElement>, task: Task) {
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    if (event.key === "Delete" && plain && !event.shiftKey) {
      event.preventDefault();
      ask({ kind: "delete-task", task });
    } else if (
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      const target = step(
        grouped[task.status],
        task.id,
        event.key === "ArrowUp" ? -1 : 1,
      );
      if (target)
        void tasks
          .move(task.id, task.status, target.before, target.after)
          .then(() => requestAnimationFrame(() => focusRow(task.id)));
    } else if (
      plain &&
      !event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      const rows = [
        ...(root.current?.querySelectorAll<HTMLElement>(".task-open") ?? []),
      ];
      const index = rows.indexOf(event.currentTarget);
      rows[index + (event.key === "ArrowUp" ? -1 : 1)]?.focus();
    }
  }

  const pickerItems: MenuItem[] = [
    {
      label: "All Lists",
      checked: list === ALL,
      action: () => void tasks.selectList(ALL),
    },
    ...doc.lists.map((l) => ({
      label: l.name,
      checked: list === l.id,
      action: () => void tasks.selectList(l.id),
    })),
    "separator",
    { label: "+ New List", action: () => ask({ kind: "new-list" }) },
    { label: "Manage Lists…", action: () => ask({ kind: "manage" }) },
  ];
  const label = list === ALL ? "All Lists" : listName(doc, list);
  const rest = (status: Status) =>
    grouped[status].filter((t) => t.id !== dragView?.id);
  const dropBefore =
    dragView?.target && rest(dragView.target.status)[dragView.target.index]?.id;
  const quickAdd = (status: Status) => (
    <QuickAdd
      status={status}
      list={list}
      lists={doc.lists}
      onClose={() => setAdding(null)}
    />
  );
  return (
    <div className={`tasks-list${dragView ? " dragging" : ""}`}>
      <div className="tasks-toolbar">
        <button
          className="tasks-picker"
          data-autofocus
          aria-haspopup="menu"
          aria-expanded={!!picker}
          aria-label={`List: ${label}`}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setPicker({ x: box.left, y: box.bottom + 2 });
          }}
        >
          <span>{label}</span>
          <ChevronIcon />
        </button>
      </div>
      {picker && (
        <Menu
          label="Lists"
          items={pickerItems}
          x={picker.x}
          y={picker.y}
          onClose={() => setPicker(null)}
        />
      )}
      {total === 0 ? (
        <div className="tasks-empty">
          <p className="muted">No tasks yet</p>
          {adding ? (
            quickAdd("todo")
          ) : (
            <button className="tasks-add" onClick={() => setAdding("todo")}>
              + Add Task
            </button>
          )}
        </div>
      ) : (
        <div className="tasks-sections">
          {statuses.map((status) => {
            const collapsed = view.collapsed[status];
            const heading = `tasks-${status}`;
            const dropEnd =
              dragView?.target?.status === status &&
              dragView.target.index >= rest(status).length;
            return (
              <section
                key={status}
                className={`tasks-section${dropEnd ? " drop-end" : ""}`}
                data-status={status}
                aria-labelledby={heading}
              >
                <header className="tasks-section-header">
                  <button
                    id={heading}
                    className="tasks-toggle"
                    aria-expanded={!collapsed}
                    onClick={() => toggleSection(instanceId, status)}
                  >
                    <ChevronIcon />
                    <span>{statusLabel[status]}</span>
                    <span className="tasks-count">
                      {grouped[status].length}
                    </span>
                  </button>
                  <button
                    className="tasks-add-icon"
                    aria-label={`Add task to ${statusLabel[status]}`}
                    title="Add task"
                    onClick={() => {
                      if (collapsed) toggleSection(instanceId, status);
                      setAdding(status);
                    }}
                  >
                    +
                  </button>
                </header>
                {!collapsed && (
                  <>
                    <ul className="tasks-rows">
                      {grouped[status].map((task) => (
                        <li
                          key={task.id}
                          data-task={task.id}
                          className={`task-row${
                            dragView?.id === task.id ? " dragged" : ""
                          }${dropBefore === task.id ? " drop-before" : ""}`}
                        >
                          <span
                            className="task-handle"
                            aria-hidden="true"
                            title="Drag to reorder or change status"
                            onPointerDown={(e) => handleDown(e, task)}
                            onPointerMove={handleMove}
                            onPointerUp={handleUp}
                            onPointerCancel={cancelDrag}
                            onLostPointerCapture={cancelDrag}
                          >
                            <GripIcon />
                          </span>
                          <button
                            className="task-open"
                            title={task.title}
                            onClick={() =>
                              navigate(instanceId, {
                                kind: "task",
                                id: task.id,
                              })
                            }
                            onKeyDown={(e) => rowKey(e, task)}
                          >
                            <span className="task-title">{task.title}</span>
                            {list === ALL && (
                              <span className="task-list-name">
                                {listName(doc, task.listId)}
                              </span>
                            )}
                            <span
                              className={`task-priority priority-${task.priority}`}
                            >
                              {priorityLabel[task.priority]}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {adding === status ? (
                      quickAdd(status)
                    ) : (
                      <button
                        className="tasks-add"
                        onClick={() => setAdding(status)}
                      >
                        + Add Task
                      </button>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuickAdd({
  status,
  list,
  lists,
  onClose,
}: {
  status: Status;
  list: string;
  lists: TaskList[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState(""),
    [owner, setOwner] = useState(INBOX),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // All Lists is not a list: a new task there needs an owner, Inbox by default.
  const target = list === ALL ? owner : list;
  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const failure = await tasks.createTask(target, status, title);
    setBusy(false);
    setError(failure);
    if (!failure) setTitle("");
  }
  return (
    <form
      ref={form}
      className="tasks-quick-add"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onBlur={(event) => {
        if (!title.trim() && !form.current?.contains(event.relatedTarget))
          onClose();
      }}
      onKeyDown={(event) => {
        // Keys that confirm or cancel an IME composition are not commands.
        if (event.nativeEvent.isComposing) {
          if (event.key === "Enter") event.preventDefault();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <input
        autoFocus
        aria-label={`New task in ${statusLabel[status]}`}
        placeholder="Task title"
        value={title}
        maxLength={500}
        onChange={(event) => setTitle(event.target.value)}
      />
      {list === ALL && (
        <select
          aria-label="List for new task"
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p className="tasks-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function TaskDetail({
  doc,
  task,
  back,
  remove,
}: {
  doc: TasksDocument;
  task: Task;
  back: () => void;
  remove: () => void;
}) {
  const title = draftOf(task.id, "title"),
    description = draftOf(task.id, "descriptionMarkdown");
  const [mode, setMode] = useState<"edit" | "preview">(
    task.descriptionMarkdown ? "preview" : "edit",
  );
  const titleField = useRef<HTMLInputElement>(null);
  useEffect(() => titleField.current?.focus(), []);
  async function leave() {
    // An empty title cannot be saved; leaving keeps the previous one.
    if (title && !title.value.trim()) discardDraft(task.id, "title");
    const saved = await Promise.all([
      commit(task.id, "title"),
      commit(task.id, "descriptionMarkdown"),
    ]);
    if (saved.every(Boolean)) back();
  }
  const saving = !!(title?.saving || description?.saving);
  const state = saving
    ? "Saving…"
    : description?.error
      ? "Not saved"
      : title || description
        ? "Unsaved changes"
        : "Saved";
  const select = (
    label: string,
    value: string,
    options: [string, string][],
    change: (value: string) => void,
  ) => (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => change(event.target.value)}>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="task-detail">
      <div className="tasks-toolbar">
        <button
          className="task-back"
          data-autofocus
          aria-label="Back to tasks"
          onClick={() => void leave()}
        >
          <BackIcon />
          <span>Tasks</span>
        </button>
        <span className="task-save-state" role="status">
          {state}
        </span>
        {description?.error && (
          <button onClick={() => void commit(task.id, "descriptionMarkdown")}>
            Retry
          </button>
        )}
        <button className="danger" onClick={remove}>
          Delete
        </button>
      </div>
      <div className="task-body">
        <input
          ref={titleField}
          className="task-title-input"
          aria-label="Task title"
          aria-invalid={!!title?.error}
          maxLength={500}
          value={title?.value ?? task.title}
          onChange={(event) => setDraft(task.id, "title", event.target.value)}
          onBlur={() => void commit(task.id, "title")}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void commit(task.id, "title");
            } else if (event.key === "Escape") {
              event.preventDefault();
              discardDraft(task.id, "title");
            }
          }}
        />
        {title?.error && (
          <p className="tasks-error" role="alert">
            {title.error}
          </p>
        )}
        <div className="task-fields">
          {select(
            "List",
            task.listId,
            doc.lists.map((l) => [l.id, l.name]),
            (listId) => void tasks.update(task.id, { listId }),
          )}
          {select(
            "Status",
            task.status,
            statuses.map((s) => [s, statusLabel[s]]),
            (status) =>
              void tasks.update(task.id, { status: status as Status }),
          )}
          {select(
            "Priority",
            task.priority,
            priorities.map((p) => [p, priorityLabel[p]]),
            (priority) =>
              void tasks.update(task.id, {
                priority: priority as Task["priority"],
              }),
          )}
        </div>
        <div className="task-description">
          <div className="task-modes" role="group" aria-label="Description">
            <button
              aria-pressed={mode === "edit"}
              onClick={() => setMode("edit")}
            >
              Edit
            </button>
            <button
              aria-pressed={mode === "preview"}
              onClick={() => setMode("preview")}
            >
              Preview
            </button>
          </div>
          {mode === "edit" ? (
            <textarea
              className="task-markdown"
              aria-label="Description (Markdown)"
              placeholder="Add a description in Markdown"
              spellCheck={false}
              value={description?.value ?? task.descriptionMarkdown}
              onChange={(event) =>
                setDraft(task.id, "descriptionMarkdown", event.target.value)
              }
              onBlur={() => void commit(task.id, "descriptionMarkdown")}
            />
          ) : (
            <Markdown
              source={description?.value ?? task.descriptionMarkdown}
              className="task-preview"
              label="Description preview"
              empty="No description"
            />
          )}
          {description?.error && (
            <p className="tasks-error" role="alert">
              {description.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function NewListDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState(""),
    [error, setError] = useState<string | null>(null);
  async function submit() {
    const failure = await tasks.createList(name);
    if (failure) return setError(failure);
    const key = name.trim().toLowerCase();
    const created = current()?.lists.find((l) => l.name.toLowerCase() === key);
    onCreated();
    onClose();
    if (created) void tasks.selectList(created.id);
  }
  return (
    <Dialog title="New list" onCancel={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void submit();
        }}
      >
        <input
          autoFocus
          className="tasks-name-input"
          aria-label="List name"
          maxLength={80}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        {error && (
          <p className="tasks-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!name.trim()}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ManageLists({
  doc,
  onClose,
}: {
  doc: TasksDocument;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TaskList | null>(null);
  if (confirming) {
    const count = doc.tasks.filter((t) => t.listId === confirming.id).length;
    return (
      <Dialog title="Delete list" onCancel={() => setConfirming(null)}>
        <p>
          Delete the list “{confirming.name}”?{" "}
          {count
            ? `Its ${count} ${count === 1 ? "task moves" : "tasks move"} to Inbox.`
            : "It has no tasks."}{" "}
          The list itself cannot be restored.
        </p>
        <div className="dialog-actions">
          <button autoFocus onClick={() => setConfirming(null)}>
            Cancel
          </button>
          <button
            className="danger"
            onClick={() => {
              setConfirming(null);
              void tasks.deleteList(confirming.id);
            }}
          >
            Delete list
          </button>
        </div>
      </Dialog>
    );
  }
  async function rename() {
    if (!editing) return;
    const failure = await tasks.renameList(editing.id, editing.name);
    setError(failure);
    if (!failure) setEditing(null);
  }
  return (
    <Dialog title="Manage lists" onCancel={onClose}>
      <ul className="tasks-manage">
        <li>
          <span className="tasks-manage-name">Inbox</span>
          <span className="muted">Always kept</span>
        </li>
        {doc.lists
          .filter((l) => !l.system)
          .map((l) =>
            editing?.id === l.id ? (
              <li key={l.id}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void rename();
                  }}
                >
                  <input
                    autoFocus
                    className="tasks-name-input"
                    aria-label={`New name for ${l.name}`}
                    maxLength={80}
                    value={editing.name}
                    onChange={(event) =>
                      setEditing({ id: l.id, name: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        // Cancel the rename only, not the whole dialog.
                        event.preventDefault();
                        event.stopPropagation();
                        setEditing(null);
                        setError(null);
                      }
                    }}
                  />
                  <button type="submit" disabled={!editing.name.trim()}>
                    Save
                  </button>
                </form>
              </li>
            ) : (
              <li key={l.id}>
                <span className="tasks-manage-name" title={l.name}>
                  {l.name}
                </span>
                <button
                  aria-label={`Rename ${l.name}`}
                  onClick={() => {
                    setError(null);
                    setEditing({ id: l.id, name: l.name });
                  }}
                >
                  Rename
                </button>
                <button
                  className="danger"
                  aria-label={`Delete ${l.name}`}
                  onClick={() => setConfirming(l)}
                >
                  Delete
                </button>
              </li>
            ),
          )}
      </ul>
      {error && (
        <p className="tasks-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}
