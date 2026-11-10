import { useRef, useState } from "react";
import { ChevronIcon } from "../../components/Icons";
import { setSections, type Project } from "./projects";

export interface Section {
  id: string;
  title: React.ReactNode;
  /** The accessible name of the section, when the title is not plain text. */
  label?: string;
  /** The title's tooltip. */
  hint?: string;
  /** Buttons at the right of the title. */
  actions?: React.ReactNode;
  /** The buttons show only while the pointer is over the section (or it has focus). */
  hoverActions?: boolean;
  /** The section's relative height before the user resizes it. */
  size?: number;
  /** Folded until the user opens it. */
  closed?: boolean;
  body: React.ReactNode;
}
/** The smallest body an open section keeps while its neighbours are resized. */
const MIN_BODY = 40;

/** A view's folded sections, kept in the project so they survive switching views. */
export function useSectionState(
  project: Project,
  view: string,
  initial: string[] = [],
) {
  const layout = project.sections[view] ?? { closed: initial, sizes: {} };
  const closed = new Set(layout.closed);
  const save = (next: Set<string>) =>
    setSections(project.id, view, { ...layout, closed: [...next] });
  return {
    closed,
    sizes: layout.sizes,
    toggle(id: string) {
      const next = new Set(closed);
      if (!next.delete(id)) next.add(id);
      save(next);
    },
    /** Closes exactly these sections (or groups), opening the others. */
    setClosed(ids: Iterable<string>) {
      save(new Set(ids));
    },
    open(id: string) {
      if (!closed.has(id)) return;
      const next = new Set(closed);
      next.delete(id);
      save(next);
    },
    setSizes: (sizes: Record<string, number>) =>
      setSections(project.id, view, { ...layout, sizes }),
  };
}

export function SectionTitle({
  title,
  label,
  hint,
  open,
  onToggle,
  actions,
  hoverActions = false,
}: {
  title: React.ReactNode;
  label?: string;
  hint?: string;
  open: boolean;
  onToggle: () => void;
  actions?: React.ReactNode;
  hoverActions?: boolean;
}) {
  return (
    <div className={`pane-title${hoverActions ? " hover-actions" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={label}
        title={hint}
        onClick={onToggle}
      >
        <span className={`pane-twisty${open ? " open" : ""}`} aria-hidden>
          <ChevronIcon />
        </span>
        <span className="pane-name">{title}</span>
      </button>
      {actions && <span className="pane-actions">{actions}</span>}
    </div>
  );
}

/**
 * Sections stacked in a sidebar view, as in VS Code: each folds to its title, open ones share
 * the height, and the edge between two of them drags to resize. A folded section after the
 * open ones stays at the bottom.
 */
export function Sections({
  project,
  view,
  sections,
}: {
  project: Project;
  view: string;
  sections: Section[];
}) {
  const state = useSectionState(
    project,
    view,
    sections.filter((s) => s.closed).map((s) => s.id),
  );
  const elements = useRef(new Map<string, HTMLElement>());
  // Heights while dragging; saved in the project when the pointer is released.
  const [dragging, setDragging] = useState<Record<string, number> | null>(null);
  const sizes = dragging ?? state.sizes;
  const open = sections.filter((s) => !state.closed.has(s.id));
  const sizeOf = (s: Section) => sizes[s.id] ?? s.size ?? 1;

  function startResize(event: React.PointerEvent, index: number) {
    const above = [...sections.slice(0, index)]
      .reverse()
      .find((s) => !state.closed.has(s.id));
    const below = sections.slice(index).find((s) => !state.closed.has(s.id));
    if (!above || !below || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    // In pixels from here on, so the drag follows the pointer exactly.
    const start: Record<string, number> = {};
    for (const s of open)
      start[s.id] = elements.current.get(s.id)?.offsetHeight ?? sizeOf(s);
    const header = (id: string) =>
      elements.current.get(id)?.querySelector(".pane-title")?.clientHeight ?? 0;
    const min = (id: string) => header(id) + MIN_BODY;
    const total = start[above.id] + start[below.id];
    const origin = event.clientY;
    let latest = start;
    const move = (e: PointerEvent) => {
      const top = Math.min(
        Math.max(start[above.id] + e.clientY - origin, min(above.id)),
        total - min(below.id),
      );
      latest = { ...start, [above.id]: top, [below.id]: total - top };
      setDragging(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragging(null);
      state.setSizes({ ...state.sizes, ...latest });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  return (
    <div className="panes">
      {sections.map((section, index) => {
        const shown = !state.closed.has(section.id);
        const resizable =
          index > 0 &&
          sections.slice(0, index).some((s) => !state.closed.has(s.id)) &&
          sections.slice(index).some((s) => !state.closed.has(s.id));
        return (
          <section
            key={section.id}
            className={`pane${shown ? " open" : ""}`}
            aria-label={section.label ?? String(section.title)}
            style={shown ? { flexGrow: sizeOf(section) } : undefined}
            ref={(element) => {
              if (element) elements.current.set(section.id, element);
              else elements.current.delete(section.id);
            }}
          >
            {resizable && (
              <div
                className="pane-sash"
                role="separator"
                aria-orientation="horizontal"
                onPointerDown={(event) => startResize(event, index)}
              />
            )}
            <SectionTitle
              title={section.title}
              label={section.label}
              hint={section.hint}
              open={shown}
              onToggle={() => state.toggle(section.id)}
              actions={section.actions}
              hoverActions={section.hoverActions}
            />
            {shown && <div className="pane-body">{section.body}</div>}
          </section>
        );
      })}
    </div>
  );
}
