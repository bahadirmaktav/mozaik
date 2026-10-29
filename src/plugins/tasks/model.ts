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
/** Anchors for inserting at `index` of a displayed group that no longer contains the task.
 * Using neighbours, not indices, keeps hidden tasks of other lists in place. */
export function anchors(rest: Task[], index: number) {
  const before = rest[index]?.id ?? null;
  return {
    before,
    after: before ? null : (rest[rest.length - 1]?.id ?? null),
  };
}
/** Anchors for moving a task one step up or down within its displayed group, or null. */
export function step(group: Task[], id: string, direction: -1 | 1) {
  const index = group.findIndex((t) => t.id === id),
    target = index + direction;
  if (index < 0 || target < 0 || target >= group.length) return null;
  return anchors(
    group.filter((t) => t.id !== id),
    target,
  );
}
