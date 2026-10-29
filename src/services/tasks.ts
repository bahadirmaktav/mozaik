import { native } from "./native";

export type Status = "todo" | "in_progress" | "done";
export type Priority = "low" | "medium" | "high";
export const statuses: Status[] = ["todo", "in_progress", "done"];
export const priorities: Priority[] = ["low", "medium", "high"];
export const statusLabel: Record<Status, string> = {
  todo: "Todo",
  in_progress: "In Progress",
  done: "Done",
};
export const priorityLabel: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};
export const INBOX = "inbox";
/** The virtual All Lists selection; never a stored list. */
export const ALL = "all";

export interface TaskList {
  id: string;
  name: string;
  system: boolean;
}
export interface Task {
  id: string;
  listId: string;
  title: string;
  descriptionMarkdown: string;
  status: Status;
  priority: Priority;
  orderKey: number;
  createdAt: string;
  updatedAt: string;
}
export interface TasksDocument {
  schemaVersion: number;
  revision: number;
  lists: TaskList[];
  tasks: Task[];
  preferences: { selectedListId: string };
}
export type TaskPatch = Partial<
  Pick<Task, "title" | "descriptionMarkdown" | "status" | "priority" | "listId">
>;

/** Rust owns the tasks file; every mutation resolves with the saved document. Mutable so
 * browser tests can substitute it. */
export const tasksBackend = {
  snapshot: () => native<TasksDocument>("tasks_snapshot"),
  createList: (name: string) =>
    native<TasksDocument>("tasks_create_list", { name }),
  renameList: (id: string, name: string) =>
    native<TasksDocument>("tasks_rename_list", { id, name }),
  deleteList: (id: string) =>
    native<TasksDocument>("tasks_delete_list", { id }),
  createTask: (listId: string, status: Status, title: string) =>
    native<TasksDocument>("tasks_create_task", { listId, status, title }),
  updateTask: (id: string, patch: TaskPatch) =>
    native<TasksDocument>("tasks_update_task", { id, patch }),
  moveTask: (
    id: string,
    status: Status,
    before: string | null,
    after: string | null,
  ) => native<TasksDocument>("tasks_move_task", { id, status, before, after }),
  deleteTask: (id: string) =>
    native<TasksDocument>("tasks_delete_task", { id }),
  selectList: (id: string) =>
    native<TasksDocument>("tasks_select_list", { id }),
  /** False when another window already shows the Tasks panel; that window is focused. */
  claimPanel: () => native<boolean>("tasks_claim_panel"),
  releasePanel: () => native<void>("tasks_release_panel"),
};
