import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ViewProps } from "../contract";
import { matches } from "../../workspace/keybindings";
import { useCommands } from "../../workspace/commands";
import { Dialog } from "../../components/Dialog";
import { Markdown } from "../../components/Markdown";
import { Menu, type MenuItem } from "../../components/Menu";
import { NewFileIcon, NewFolderIcon } from "../../components/Icons";
import {
  groupOf,
  isNote,
  nameOf,
  type NotesListing,
} from "../../services/notes";
import {
  chooseNotesFolder,
  commit,
  draftOf,
  isExpanded,
  load,
  modeOf,
  notes,
  overwriteNote,
  refresh,
  reloadNote,
  savedText,
  setDraft,
  setMode,
  targetGroup,
  unreadable,
  useNotes,
} from "./store";
import { baseName } from "../ide/paths";

/** A name typed in the tree, as in a file explorer: a new note or group, or a rename. */
type Naming =
  | { kind: "note" | "group"; group: string }
  | { kind: "rename"; path: string }
  | null;
interface Row {
  path: string;
  name: string;
  group: boolean;
  depth: number;
}
/** Groups first, then notes, by name; the contents of open groups follow each group. */
function rowsOf(listing: NotesListing): Row[] {
  const rows: Row[] = [];
  const walk = (group: string, depth: number) => {
    for (const path of listing.groups)
      if (groupOf(path) === group) {
        rows.push({ path, name: nameOf(path), group: true, depth });
        if (isExpanded(path)) walk(path, depth + 1);
      }
    for (const note of listing.notes)
      if (groupOf(note.path) === group)
        rows.push({ path: note.path, name: note.title, group: false, depth });
  };
  walk("", 0);
  return rows;
}
const title = (path: string) => nameOf(path).replace(/\.md$/i, "");

export default function NotesPanel({ instanceId, focused }: ViewProps) {
  const { listing, loading, loadError, error, selected } = useNotes();
  const commands = useCommands("Notes", instanceId, focused);
  const root = useRef<HTMLDivElement>(null);
  const [trashing, setTrashing] = useState<string | null>(null);
  const [naming, setNaming] = useState<Naming>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: Row } | null>(
    null,
  );
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    if (focused && !root.current?.contains(document.activeElement))
      root.current
        ?.querySelector<HTMLElement>(
          ".note-editor, .notes-tree [aria-selected=true], .notes-tree [role=treeitem]",
        )
        ?.focus();
  }, [focused]);
  function askTrash(path: string) {
    opener.current = document.activeElement;
    setTrashing(path);
  }
  function closeTrash() {
    setTrashing(null);
    setTimeout(() => {
      const previous = opener.current as HTMLElement | null;
      if (previous?.isConnected) previous.focus();
      else root.current?.focus();
    });
  }
  /** A new note or group is named in a row at the top of its group, which opens. */
  function create(kind: "note" | "group", group = targetGroup()) {
    if (group) notes.toggle(group, true);
    setNaming({ kind, group });
  }
  /** Ends naming; focus goes to the named row, or back to the tree. */
  function doneNaming(path: string | null) {
    setNaming(null);
    setTimeout(() => {
      const row =
        (path &&
          root.current?.querySelector<HTMLElement>(
            `[data-path="${CSS.escape(path)}"]`,
          )) ||
        root.current?.querySelector<HTMLElement>(
          ".notes-tree [aria-selected=true], .notes-tree [role=treeitem]",
        );
      (row ?? root.current)?.focus();
    });
  }

  commands.current = listing?.root
    ? [
        { label: "New Note", action: () => create("note") },
        { label: "New Group", action: () => create("group") },
      ]
    : [];
  if (!listing?.root)
    return (
      <div className="notes" ref={root} tabIndex={-1}>
        <div className="tasks-state notes-folder">
          {loadError ? (
            <>
              <p role="alert">{loadError}</p>
              <div className="dialog-actions">
                <button onClick={() => void refresh()}>Try again</button>
                <button onClick={() => void chooseNotesFolder()}>
                  Choose another folder…
                </button>
              </div>
            </>
          ) : listing ? (
            <>
              <p>
                Notes are the Markdown files of a folder you choose; its
                subfolders are groups.
              </p>
              <button onClick={() => void chooseNotesFolder()}>
                Choose notes folder…
              </button>
              {error && (
                <p className="tasks-error" role="alert">
                  {error}
                </p>
              )}
            </>
          ) : (
            <p className="muted">{loading ? "Loading notes…" : ""}</p>
          )}
        </div>
      </div>
    );
  const rows = rowsOf(listing);
  // The row that names a new item goes first in its group.
  const adding =
    naming && naming.kind !== "rename"
      ? {
          ...naming,
          index: naming.group
            ? rows.findIndex((r) => r.path === naming.group) + 1
            : 0,
          depth: naming.group
            ? (rows.find((r) => r.path === naming.group)?.depth ?? -1) + 1
            : 0,
        }
      : null;
  const note = selected && isNote(selected) ? selected : null;
  const focusRow = (path: string) =>
    root.current
      ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)
      ?.focus();
  function rowKey(event: KeyboardEvent<HTMLElement>, row: Row) {
    const index = rows.indexOf(row);
    const plain =
      !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
    const go = (target: Row | undefined) => {
      if (!target) return;
      notes.select(target.path);
      focusRow(target.path);
    };
    if (matches(event, "items.delete")) askTrash(row.path);
    else if (matches(event, "items.rename"))
      setNaming({ kind: "rename", path: row.path });
    else if (!plain) return;
    else if (event.key === "ArrowDown") go(rows[index + 1]);
    else if (event.key === "ArrowUp") go(rows[index - 1]);
    else if (event.key === "Home") go(rows[0]);
    else if (event.key === "End") go(rows[rows.length - 1]);
    else if (event.key === "ArrowRight" && row.group) {
      if (!isExpanded(row.path)) notes.toggle(row.path, true);
      else go(rows[index + 1]);
    } else if (event.key === "ArrowLeft") {
      if (row.group && isExpanded(row.path)) notes.toggle(row.path, false);
      else go(rows.find((r) => r.path === groupOf(row.path)));
    } else if (event.key === "Enter") {
      if (row.group) notes.toggle(row.path);
      else notes.select(row.path);
    } else return;
    event.preventDefault();
  }
  function menuItems(row: Row): MenuItem[] {
    return [
      ...(row.group
        ? ([
            { label: "New Note", action: () => create("note", row.path) },
            { label: "New Group", action: () => create("group", row.path) },
            "separator",
          ] as MenuItem[])
        : []),
      {
        label: "Rename",
        shortcut: "F2",
        action: () => setNaming({ kind: "rename", path: row.path }),
      },
      {
        label: "Move to Trash…",
        shortcut: "Delete",
        action: () => askTrash(row.path),
      },
    ];
  }
  const shownIndex = rows.findIndex((r) => r.path === selected);
  return (
    <div className="notes" ref={root} tabIndex={-1}>
      <div className="notes-layout">
        <nav className="notes-list" aria-label="Notes">
          <div className="notes-list-header" title={listing.root}>
            <span className="notes-folder-name">{baseName(listing.root)}</span>
            <button
              className="icon-button"
              title="New note in the selected group"
              aria-label="New note"
              onClick={() => create("note")}
            >
              <NewFileIcon />
            </button>
            <button
              className="icon-button"
              title="New group in the selected group"
              aria-label="New group"
              onClick={() => create("group")}
            >
              <NewFolderIcon />
            </button>
          </div>
          <div
            className="notes-tree"
            role="tree"
            aria-label="Notes and groups"
            onClick={(e) => {
              // A click on the free space selects the folder: new items go to its top.
              if (e.target === e.currentTarget) notes.select(null);
            }}
          >
            {rows.map((row, index) => {
              const draft = !row.group && draftOf(row.path);
              const active = row.path === selected;
              const renaming =
                naming?.kind === "rename" && naming.path === row.path;
              const item = (
                <div
                  key={row.path}
                  role="treeitem"
                  data-path={row.path}
                  aria-level={row.depth + 1}
                  aria-expanded={row.group ? isExpanded(row.path) : undefined}
                  aria-selected={active}
                  tabIndex={active || (shownIndex < 0 && index === 0) ? 0 : -1}
                  className={`note-row${active ? " selected" : ""}${row.group ? " group" : ""}`}
                  style={{ paddingLeft: 6 + row.depth * 14 }}
                  onClick={() => {
                    notes.select(row.path);
                    if (row.group) notes.toggle(row.path);
                  }}
                  onKeyDown={(e) => rowKey(e, row)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    notes.select(row.path);
                    setMenu({ x: e.clientX, y: e.clientY, row });
                  }}
                >
                  <span className="project-twisty" aria-hidden>
                    {row.group ? (isExpanded(row.path) ? "▾" : "▸") : ""}
                  </span>
                  {renaming ? (
                    <InlineName
                      label={`Rename ${row.name}`}
                      initial={row.group ? row.name : title(row.path)}
                      submit={(name) => notes.rename(row.path, name)}
                      onDone={(done) =>
                        doneNaming(
                          done
                            ? pathFor(
                                row.group ? "group" : "note",
                                groupOf(row.path),
                                done,
                              )
                            : row.path,
                        )
                      }
                    />
                  ) : (
                    <span className="note-label">
                      {row.name}
                      {draft ? " •" : ""}
                    </span>
                  )}
                </div>
              );
              return adding?.index === index ? (
                <Fragment key={row.path}>
                  <NewRow {...adding} onDone={doneNaming} />
                  {item}
                </Fragment>
              ) : (
                item
              );
            })}
            {adding && adding.index >= rows.length && (
              <NewRow {...adding} onDone={doneNaming} />
            )}
            {!rows.length && !adding && (
              <p className="muted notes-empty">
                No notes yet. Create one above.
              </p>
            )}
          </div>
          {listing.truncated && (
            <p className="muted notes-empty">
              This folder is too large to list completely.
            </p>
          )}
        </nav>
        <section className="note-page" aria-label="Note">
          {(error || loadError) && (
            <div className="tasks-notice" role="alert">
              <span>{error ?? loadError}</span>
              <button
                onClick={() => (error ? notes.dismissError() : void refresh())}
              >
                {error ? "Dismiss" : "Retry"}
              </button>
            </div>
          )}
          {note ? (
            <NotePage
              key={note}
              path={note}
              groups={listing.groups}
              onTrash={() => askTrash(note)}
            />
          ) : (
            <p className="muted notes-empty">Select or create a note.</p>
          )}
        </section>
      </div>
      {menu && (
        <Menu
          label="Note actions"
          items={menuItems(menu.row)}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
      {trashing && (
        <Dialog
          title={
            isNote(trashing) ? "Move note to Trash" : "Move group to Trash"
          }
          onCancel={closeTrash}
        >
          <p>
            {isNote(trashing)
              ? `Move “${title(trashing)}” to the Trash?`
              : `Move the group “${nameOf(trashing)}” and the ${
                  listing.notes.filter((n) => n.path.startsWith(`${trashing}/`))
                    .length
                } notes in it to the Trash?`}{" "}
            Unsaved changes in it are discarded.
          </p>
          <div className="dialog-actions">
            <button
              className="danger"
              onClick={() => {
                void notes.trash(trashing);
                closeTrash();
              }}
            >
              Move to Trash
            </button>
            <button data-autofocus onClick={closeTrash}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function NotePage({
  path,
  groups,
  onTrash,
}: {
  path: string;
  groups: string[];
  onTrash: () => void;
}) {
  useNotes();
  useEffect(() => void load(path), [path]);
  const [name, setName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const saved = savedText(path);
  const failure = unreadable(path);
  const draft = draftOf(path);
  async function rename() {
    if (name === null) return;
    if (!name.trim()) return setNameError("A note needs a title");
    const error =
      name.trim() === title(path) ? null : await notes.rename(path, name);
    setNameError(error);
    if (!error) setName(null);
  }
  if (failure)
    return (
      <div className="note">
        <p role="alert">{failure}</p>
        <button onClick={() => void load(path, true)}>Try again</button>
      </div>
    );
  if (saved === undefined) return <p className="muted notes-empty">Opening…</p>;
  const text = draft?.value ?? saved;
  const mode = modeOf(path);
  return (
    <div className="note">
      <div className="note-header">
        <input
          className="note-title"
          aria-label="Note title"
          maxLength={120}
          value={name ?? title(path)}
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
          onBlur={() => void rename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void rename();
            } else if (e.key === "Escape" && name !== null) {
              e.preventDefault();
              e.stopPropagation();
              setName(null);
              setNameError(null);
            }
          }}
        />
        <select
          aria-label="Group"
          className="note-group"
          value={groupOf(path)}
          onChange={(e) => void notes.move(path, e.target.value)}
        >
          <option value="">(No group)</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <div className="task-modes" role="group" aria-label="Note mode">
          <button
            aria-pressed={mode === "edit"}
            onClick={() => setMode(path, "edit")}
          >
            Edit
          </button>
          <button
            aria-pressed={mode === "preview"}
            onClick={() => {
              void commit(path);
              setMode(path, "preview");
            }}
          >
            Preview
          </button>
        </div>
        <button className="note-delete" onClick={onTrash}>
          Move to Trash
        </button>
      </div>
      {nameError && (
        <div className="tasks-notice" role="alert">
          <span>Not renamed: {nameError}</span>
        </div>
      )}
      {draft?.error && (
        <div className="tasks-notice" role="alert">
          <span>Not saved: {draft.error}</span>
          {draft.conflict ? (
            <>
              <button onClick={() => void reloadNote(path)}>
                Reload from Disk
              </button>
              <button onClick={() => void overwriteNote(path)}>
                Overwrite
              </button>
            </>
          ) : (
            <button onClick={() => void commit(path)}>Retry</button>
          )}
        </div>
      )}
      {mode === "edit" ? (
        <textarea
          className="note-editor"
          aria-label="Note content (Markdown)"
          placeholder="Write in Markdown"
          spellCheck={false}
          value={text}
          onChange={(e) => setDraft(path, e.target.value)}
          onBlur={() => void commit(path)}
        />
      ) : (
        <Markdown
          source={text}
          className="note-preview"
          label="Note preview"
          empty="This note is empty. Choose Edit to write."
        />
      )}
    </div>
  );
}

/** The path of a note or group named `name` in `group`. */
function pathFor(kind: "note" | "group", group: string, name: string) {
  const base = kind === "note" ? `${name.trim()}.md` : name.trim();
  return group ? `${group}/${base}` : base;
}

/** The row that names a new note or group, at the top of its group. */
function NewRow({
  kind,
  group,
  depth,
  onDone,
}: {
  kind: "note" | "group";
  group: string;
  depth: number;
  onDone: (path: string | null) => void;
}) {
  return (
    <div
      className="note-row naming"
      style={{ paddingLeft: 6 + depth * 14 }}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="project-twisty" aria-hidden>
        {kind === "group" ? "▸" : ""}
      </span>
      <InlineName
        label={kind === "note" ? "New note title" : "New group name"}
        initial=""
        submit={(name) =>
          kind === "note"
            ? notes.create(name, group)
            : notes.createGroup(name, group)
        }
        onDone={(name) => onDone(name && pathFor(kind, group, name))}
      />
    </div>
  );
}

/**
 * A name typed in place: Enter or leaving the field submits, Escape cancels. A refused
 * name keeps the field open with the reason; an empty or unchanged one cancels.
 */
function InlineName({
  label,
  initial,
  submit,
  onDone,
}: {
  label: string;
  initial: string;
  submit: (name: string) => Promise<string | null>;
  /** The submitted name, or null when cancelled. */
  onDone: (name: string | null) => void;
}) {
  const [name, setName] = useState(initial),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  async function send() {
    if (busy.current) return;
    if (!name.trim() || name.trim() === initial) return onDone(null);
    busy.current = true;
    const failure = await submit(name);
    busy.current = false;
    if (failure) setError(failure);
    else onDone(name);
  }
  return (
    <span className="note-naming">
      <input
        autoFocus
        className="note-name-input"
        aria-label={label}
        aria-invalid={!!error}
        maxLength={120}
        spellCheck={false}
        value={name}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // The tree's keys (F2, Delete, arrows) stay out of the field.
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            void send();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onDone(null);
          }
        }}
        onBlur={() => void send()}
      />
      {error && (
        <span className="note-naming-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
