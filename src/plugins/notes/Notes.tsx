import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { ViewProps } from "../contract";
import { matches } from "../../workspace/keybindings";
import { Dialog } from "../../components/Dialog";
import { Markdown } from "../../components/Markdown";
import { GripIcon } from "../../components/Icons";
import { ordered, type Note } from "../../services/notes";
import { anchors, step } from "../shared/order";
import {
  commit,
  discardDraft,
  draftOf,
  modeOf,
  notes,
  refresh,
  selectedId,
  setDraft,
  setMode,
  useNotes,
} from "./store";

type Prompt = { kind: "new" } | { kind: "delete"; note: Note } | null;
interface Drag {
  id: string;
  pointer: number;
  y: number;
  started: boolean;
  index: number | null;
}

export default function NotesPanel({ focused }: ViewProps) {
  const { document: doc, loading, loadError, error } = useNotes();
  const root = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const opener = useRef<Element | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragView, setDragView] = useState<{
    id: string;
    index: number | null;
  } | null>(null);

  useEffect(() => {
    if (focused && !root.current?.contains(document.activeElement))
      root.current
        ?.querySelector<HTMLElement>(".note-editor, .note-row.selected button")
        ?.focus();
  }, [focused]);
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
  function ask(next: Prompt) {
    opener.current = document.activeElement;
    setPrompt(next);
  }
  function closePrompt() {
    setPrompt(null);
    setTimeout(() => {
      const previous = opener.current as HTMLElement | null;
      if (previous?.isConnected) previous.focus();
      else root.current?.focus();
    });
  }

  if (!doc)
    return (
      <div className="notes" ref={root} tabIndex={-1}>
        <div className="tasks-state">
          {loadError ? (
            <>
              <p role="alert">{loadError}</p>
              <button onClick={() => void refresh()}>Try again</button>
            </>
          ) : (
            <p className="muted">{loading ? "Loading notes…" : ""}</p>
          )}
        </div>
      </div>
    );
  const list = ordered(doc);
  const selected = list.find((n) => n.id === selectedId(doc));
  const titleOf = (note: Note) =>
    draftOf(note.id, "title")?.value ?? note.title;

  function cancelDrag() {
    drag.current = null;
    setDragView(null);
  }
  function indexAt(y: number, id: string) {
    const rows = [
      ...(root.current?.querySelectorAll<HTMLElement>("[data-note]") ?? []),
    ].filter((row) => row.dataset.note !== id);
    const index = rows.findIndex((row) => {
      const box = row.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
    return index < 0 ? rows.length : index;
  }
  function handleDown(event: PointerEvent<HTMLElement>, note: Note) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: note.id,
      pointer: event.pointerId,
      y: event.clientY,
      started: false,
      index: null,
    };
  }
  function handleMove(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    if (!d.started && Math.abs(event.clientY - d.y) <= 4) return;
    d.started = true;
    d.index = indexAt(event.clientY, d.id);
    setDragView({ id: d.id, index: d.index });
  }
  function handleUp(event: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || d.pointer !== event.pointerId) return;
    cancelDrag();
    if (!d.started || d.index === null) return;
    const rest = list.filter((n) => n.id !== d.id);
    if (list.findIndex((n) => n.id === d.id) === d.index) return;
    const { before, after } = anchors(rest, d.index);
    void notes.move(d.id, before, after);
  }
  const focusRow = (id: string) =>
    root.current
      ?.querySelector<HTMLElement>(`[data-note="${CSS.escape(id)}"] .note-open`)
      ?.focus();
  function rowKey(event: KeyboardEvent<HTMLButtonElement>, note: Note) {
    const plain = !event.ctrlKey && !event.altKey && !event.metaKey;
    const up = matches(event, "items.up");
    if (matches(event, "items.delete")) {
      event.preventDefault();
      ask({ kind: "delete", note });
    } else if (up || matches(event, "items.down")) {
      event.preventDefault();
      const target = step(list, note.id, up ? -1 : 1);
      if (target)
        void notes
          .move(note.id, target.before, target.after)
          .then(() => requestAnimationFrame(() => focusRow(note.id)));
    } else if (
      plain &&
      !event.shiftKey &&
      (event.key === "ArrowUp" || event.key === "ArrowDown")
    ) {
      event.preventDefault();
      const index = list.findIndex((n) => n.id === note.id);
      const next = list[index + (event.key === "ArrowUp" ? -1 : 1)];
      if (next) focusRow(next.id);
    }
  }
  const rest = list.filter((n) => n.id !== dragView?.id);
  const dropBefore =
    dragView?.index !== null && dragView ? rest[dragView.index]?.id : undefined;
  return (
    <div className="notes" ref={root} tabIndex={-1}>
      <div className="notes-layout">
        <nav
          className={`notes-list${dragView ? " dragging" : ""}`}
          aria-label="Notes"
        >
          <div className="notes-list-header">
            <span>Notes</span>
            <button onClick={() => ask({ kind: "new" })}>+ New note</button>
          </div>
          <ul>
            {list.map((note) => (
              <li
                key={note.id}
                data-note={note.id}
                className={`note-row${note.id === selected?.id ? " selected" : ""}${
                  dragView?.id === note.id ? " dragged" : ""
                }${dropBefore === note.id ? " drop-before" : ""}`}
              >
                <span
                  className="task-handle"
                  role="button"
                  aria-label={`Reorder ${note.title}`}
                  title="Drag to reorder (Ctrl+Up/Down)"
                  onPointerDown={(e) => handleDown(e, note)}
                  onPointerMove={handleMove}
                  onPointerUp={handleUp}
                  onPointerCancel={cancelDrag}
                  onLostPointerCapture={cancelDrag}
                >
                  <GripIcon />
                </span>
                <button
                  className="note-open"
                  aria-current={note.id === selected?.id ? "page" : undefined}
                  onClick={() => {
                    if (note.id !== selected?.id) void notes.select(note.id);
                  }}
                  onKeyDown={(e) => rowKey(e, note)}
                >
                  {titleOf(note)}
                  {draftOf(note.id, "contentMarkdown") ||
                  draftOf(note.id, "title")
                    ? " •"
                    : ""}
                </button>
              </li>
            ))}
            {dragView && dragView.index !== null && !dropBefore && (
              <li className="note-drop-end" aria-hidden />
            )}
          </ul>
          {!list.length && (
            <p className="muted notes-empty">No notes yet. Create one above.</p>
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
          {selected ? (
            <NotePage
              key={selected.id}
              note={selected}
              onDelete={() => ask({ kind: "delete", note: selected })}
            />
          ) : (
            <p className="muted notes-empty">Select or create a note.</p>
          )}
        </section>
      </div>
      {prompt?.kind === "new" && <NewNoteDialog onClose={closePrompt} />}
      {prompt?.kind === "delete" && (
        <Dialog title="Delete note" onCancel={closePrompt}>
          <p>
            Delete “{prompt.note.title}” and all of its content? This cannot be
            undone.
          </p>
          <div className="dialog-actions">
            <button
              className="danger"
              onClick={() => {
                discardDraft(prompt.note.id, "title");
                discardDraft(prompt.note.id, "contentMarkdown");
                void notes.remove(prompt.note.id);
                closePrompt();
              }}
            >
              Delete
            </button>
            <button autoFocus onClick={closePrompt}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function NotePage({ note, onDelete }: { note: Note; onDelete: () => void }) {
  useNotes();
  const title = draftOf(note.id, "title"),
    content = draftOf(note.id, "contentMarkdown");
  const text = content?.value ?? note.contentMarkdown;
  const mode = modeOf(note.id, note.contentMarkdown);
  return (
    <div className="note">
      <div className="note-header">
        <input
          className="note-title"
          aria-label="Note title"
          maxLength={120}
          value={title?.value ?? note.title}
          onChange={(e) => setDraft(note.id, "title", e.target.value)}
          onBlur={() => void commit(note.id, "title")}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commit(note.id, "title");
            } else if (e.key === "Escape" && title) {
              e.preventDefault();
              e.stopPropagation();
              discardDraft(note.id, "title");
            }
          }}
        />
        <div className="task-modes" role="group" aria-label="Note mode">
          <button
            aria-pressed={mode === "edit"}
            onClick={() => setMode(note.id, "edit")}
          >
            Edit
          </button>
          <button
            aria-pressed={mode === "preview"}
            onClick={() => {
              void commit(note.id, "contentMarkdown");
              setMode(note.id, "preview");
            }}
          >
            Preview
          </button>
        </div>
        <button className="note-delete" onClick={onDelete}>
          Delete
        </button>
      </div>
      {(title?.error || content?.error) && (
        <div className="tasks-notice" role="alert">
          <span>Not saved: {title?.error ?? content?.error}</span>
          <button
            onClick={() => {
              if (title?.error) void commit(note.id, "title");
              if (content?.error) void commit(note.id, "contentMarkdown");
            }}
          >
            Retry
          </button>
        </div>
      )}
      {mode === "edit" ? (
        <textarea
          className="note-editor"
          aria-label="Note content (Markdown)"
          placeholder="Write in Markdown"
          spellCheck={false}
          value={text}
          onChange={(e) => setDraft(note.id, "contentMarkdown", e.target.value)}
          onBlur={() => void commit(note.id, "contentMarkdown")}
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

function NewNoteDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState(""),
    [error, setError] = useState<string | null>(null);
  async function submit() {
    const failure = await notes.create(title);
    if (failure) return setError(failure);
    onClose();
  }
  return (
    <Dialog title="New note" onCancel={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) void submit();
        }}
      >
        <input
          autoFocus
          className="tasks-name-input"
          aria-label="Note title"
          placeholder="For example GitNotes"
          maxLength={120}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
        />
        {error && (
          <p className="tasks-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" disabled={!title.trim()}>
            Create
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  );
}
