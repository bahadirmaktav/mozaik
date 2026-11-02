import {
  ALL,
  statuses,
  type Status,
  type Task,
  type TasksDocument,
} from "../../services/tasks";

export type Collapsed = Record<Status, boolean>;
/** Every newly opened panel starts with Done collapsed. */
export const defaultCollapsed = (): Collapsed => ({
  todo: false,
  in_progress: false,
  done: true,
});

// Theme colors (`workspace/themes.ts`), so labels read on light and dark themes.
const LIST_COLORS = [
  "var(--syntax-function)",
  "var(--syntax-type)",
  "var(--syntax-keyword)",
  "var(--syntax-string)",
  "var(--syntax-number)",
  "var(--syntax-meta)",
];
/** A list's label color: Inbox muted, the others a stable pick by their ID (nothing stored). */
export function listColor(document: TasksDocument, id: string) {
  if (document.lists.find((l) => l.id === id)?.system) return "var(--muted)";
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return LIST_COLORS[Math.abs(hash) % LIST_COLORS.length];
}
/** The stored selection, or All Lists when it no longer names a list. */
export function selectedList(document: TasksDocument) {
  const id = document.preferences.selectedListId;
  return id === ALL || document.lists.some((l) => l.id === id) ? id : ALL;
}
const byOrder = (a: Task, b: Task) =>
  a.orderKey - b.orderKey || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Tasks of the selection grouped by status, each group in the shared status order. */
export function groups(document: TasksDocument, list: string) {
  const visible = document.tasks.filter(
    (t) => list === ALL || t.listId === list,
  );
  return Object.fromEntries(
    statuses.map((s) => [
      s,
      visible.filter((t) => t.status === s).sort(byOrder),
    ]),
  ) as Record<Status, Task[]>;
}
export function listName(document: TasksDocument, id: string) {
  return document.lists.find((l) => l.id === id)?.name ?? "";
}
export { anchors, step } from "../shared/order";
