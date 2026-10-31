import { test, expect, type Page } from "@playwright/test";

// Browser runs have no native backend. This replaces the typed tasks adapter with an
// in-memory document that follows the Rust rules, so it covers the panel, not JSON storage.
async function installFakeBackend(page: Page, seed = false) {
  await page.evaluate(async (seed) => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const module = await import(loaded("/src/services/tasks.ts"));
    type Task = Record<string, any>;
    const doc = {
      schemaVersion: 1,
      revision: 0,
      lists: [{ id: "inbox", name: "Inbox", system: true }],
      tasks: [] as Task[],
      preferences: { selectedListId: "all" },
    };
    const fake = { doc, fail: null as string | null, calls: [] as string[] };
    (window as any).__tasks = fake;
    const task = (
      id: string,
      listId: string,
      status: string,
      orderKey: number,
    ) => ({
      id,
      listId,
      title: id,
      descriptionMarkdown: "",
      status,
      priority: "medium",
      orderKey,
      createdAt: "",
      updatedAt: "",
    });
    if (seed) {
      doc.lists.push({ id: "work", name: "Work", system: false });
      doc.tasks.push(
        task("Alpha", "inbox", "todo", 0),
        task("Beta", "work", "todo", 1),
        task("Gamma", "inbox", "todo", 2),
        task("Delta", "work", "in_progress", 0),
      );
    }
    const ordered = (status: string) =>
      doc.tasks
        .filter((t) => t.status === status)
        .sort((a, b) => a.orderKey - b.orderKey);
    const next = (status: string) =>
      Math.max(-1, ...ordered(status).map((t) => t.orderKey)) + 1;
    const find = (id: string) => {
      const found = doc.tasks.find((t) => t.id === id);
      if (!found) throw new Error("That task no longer exists");
      return found;
    };
    const checkName = (name: string, except?: string) => {
      const key = name.trim().toLowerCase();
      if (!key) throw new Error("A list needs a name");
      if (key === "inbox" || key === "all lists")
        throw new Error(`“${name.trim()}” is reserved`);
      if (
        doc.lists.some((l) => l.id !== except && l.name.toLowerCase() === key)
      )
        throw new Error(`A list named “${name.trim()}” already exists`);
      return name.trim();
    };
    const save = async (name: string, change: () => void) => {
      fake.calls.push(name);
      if (fake.fail) throw new Error(fake.fail);
      change();
      doc.revision++;
      return structuredClone(doc);
    };
    const b = module.tasksBackend;
    b.snapshot = async () => structuredClone(doc);
    b.createList = (name: string) =>
      save("createList", () =>
        doc.lists.push({
          id: crypto.randomUUID(),
          name: checkName(name),
          system: false,
        }),
      );
    b.renameList = (id: string, name: string) =>
      save("renameList", () => {
        doc.lists.find((l) => l.id === id)!.name = checkName(name, id);
      });
    b.deleteList = (id: string) =>
      save("deleteList", () => {
        doc.tasks
          .filter((t) => t.listId === id)
          .forEach((t) => (t.listId = "inbox"));
        doc.lists = doc.lists.filter((l) => l.id !== id);
        if (doc.preferences.selectedListId === id)
          doc.preferences.selectedListId = "inbox";
      });
    b.createTask = (listId: string, status: string, title: string) =>
      save("createTask", () => {
        if (!title.trim()) throw new Error("A task needs a title");
        doc.tasks.push({
          ...task(crypto.randomUUID(), listId, status, next(status)),
          title: title.trim(),
        });
      });
    b.updateTask = (id: string, patch: Task) =>
      save("updateTask", () => {
        const t = find(id);
        if (patch.title !== undefined && !patch.title.trim())
          throw new Error("A task needs a title");
        if (patch.status && patch.status !== t.status)
          t.orderKey = next(patch.status);
        Object.assign(
          t,
          patch,
          patch.title ? { title: patch.title.trim() } : {},
        );
      });
    b.moveTask = (
      id: string,
      status: string,
      before: string | null,
      after: string | null,
    ) =>
      save("moveTask", () => {
        const t = find(id);
        const order = ordered(status).filter((o) => o.id !== id);
        const index = before
          ? order.findIndex((o) => o.id === before)
          : after
            ? order.findIndex((o) => o.id === after) + 1
            : order.length;
        order.splice(index, 0, t);
        const previous = t.status;
        t.status = status;
        order.forEach((o, i) => (o.orderKey = i));
        ordered(previous).forEach((o, i) => (o.orderKey = i));
      });
    b.deleteTask = (id: string) =>
      save("deleteTask", () => {
        find(id);
        doc.tasks = doc.tasks.filter((t) => t.id !== id);
      });
    b.selectList = (id: string) =>
      save("selectList", () => (doc.preferences.selectedListId = id));
  }, seed);
}
async function openTasks(page: Page) {
  await page.keyboard.press("Control+Shift+I");
  await page.getByRole("combobox", { name: "Search tools" }).fill("tasks");
  await page.keyboard.press("Enter");
}
async function start(page: Page, seed = false) {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await installFakeBackend(page, seed);
  await openTasks(page);
  await expect(page.locator(".tasks")).toBeVisible();
}
const section = (page: Page, name: string) =>
  page.locator(".tasks-section", {
    has: page.getByRole("button", { name: new RegExp(`^${name} \\d+$`) }),
  });
const titles = (page: Page, name: string) =>
  section(page, name).locator(".task-title");
const fake = (page: Page) => page.evaluate(() => (window as any).__tasks.doc);

test("Tasks is a single panel with an empty state, quick add and default sections", async ({
  page,
}) => {
  await start(page);
  // Without tasks the three sections are already there.
  await expect(page.locator(".tasks-section")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "+ Add Task" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add task to Todo" }).click();
  const input = page.getByRole("textbox", { name: "New task in Todo" });
  await input.press("Enter");
  expect((await fake(page)).tasks).toHaveLength(0);
  await input.fill("Write plan");
  await input.press("Enter");
  await expect(titles(page, "Todo")).toHaveText(["Write plan"]);
  // The quick add stays open for the next task, appended at the end.
  await page.getByRole("textbox", { name: "New task in Todo" }).fill("Review");
  await page.keyboard.press("Enter");
  await expect(titles(page, "Todo")).toHaveText(["Write plan", "Review"]);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("textbox", { name: "New task in Todo" }),
  ).toHaveCount(0);
  await expect(
    section(page, "Todo").locator(".task-priority").first(),
  ).toHaveText("Medium");
  await expect(
    page.getByRole("button", { name: /^Todo \d+$/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: /^In Progress \d+$/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("button", { name: /^Done \d+$/ }),
  ).toHaveAttribute("aria-expanded", "false");

  // Opening Tasks again focuses the existing panel instead of adding one.
  await openTasks(page);
  await expect(page.locator(".tasks")).toHaveCount(1);
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await page.keyboard.press("Control+n");
  await expect(page.locator("[data-panel] [role=tab]")).toHaveCount(2);
  await openTasks(page);
  await expect(page.locator(".tasks")).toHaveCount(1);
  await expect(page.locator(".tasks")).toBeVisible();
});

test("lists are created, selected, renamed and deleted into the Inbox", async ({
  page,
}) => {
  await start(page);
  const picker = page.locator(".tasks-picker");
  await expect(picker).toHaveAccessibleName("List: All Lists");
  await picker.click();
  await page.getByRole("menuitem", { name: "+ New List" }).click();
  await page.getByRole("textbox", { name: "List name" }).fill("Work");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(picker).toHaveAccessibleName("List: Work");
  expect((await fake(page)).preferences.selectedListId).not.toBe("all");

  await picker.click();
  await page.getByRole("menuitem", { name: "+ New List" }).click();
  await page.getByRole("textbox", { name: "List name" }).fill(" work ");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Add task to Todo" }).click();
  await page.getByRole("textbox", { name: "New task in Todo" }).fill("Ship");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(titles(page, "Todo")).toHaveText(["Ship"]);

  await picker.click();
  await page.getByRole("menuitemcheckbox", { name: "All Lists" }).click();
  await expect(section(page, "Todo").locator(".task-list-name")).toHaveText([
    "Work",
  ]);
  await page.getByRole("button", { name: "Add task to Todo" }).click();
  await expect(
    page.getByRole("combobox", { name: "List for new task" }),
  ).toHaveValue("inbox");
  await page
    .getByRole("textbox", { name: "New task in Todo" })
    .fill("Loose end");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(section(page, "Todo").locator(".task-list-name")).toHaveText([
    "Work",
    "Inbox",
  ]);

  await picker.click();
  await page.getByRole("menuitem", { name: "Manage Lists…" }).click();
  await expect(page.getByRole("button", { name: "Delete Inbox" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Rename Work" }).click();
  await page
    .getByRole("textbox", { name: "New name for Work" })
    .fill("Projects");
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Delete Projects" }).click();
  await expect(page.getByRole("dialog", { name: "Delete list" })).toContainText(
    "Its 1 task moves to Inbox",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  expect((await fake(page)).lists).toHaveLength(2);
  await page.getByRole("button", { name: "Delete Projects" }).click();
  await page.getByRole("button", { name: "Delete list" }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  const doc = await fake(page);
  expect(doc.lists.map((l: any) => l.name)).toEqual(["Inbox"]);
  expect(doc.tasks.map((t: any) => t.listId)).toEqual(["inbox", "inbox"]);
  await expect(section(page, "Todo").locator(".task-list-name")).toHaveText([
    "Inbox",
    "Inbox",
  ]);
});

test("task details edit fields, render Markdown safely and confirm deletion", async ({
  page,
}) => {
  await start(page, true);
  await section(page, "Todo")
    .getByRole("button", { name: /^Alpha/ })
    .click();
  const title = page.getByRole("textbox", { name: "Task title" });
  await expect(title).toBeFocused();
  await title.fill("Alpha renamed");
  await title.press("Escape");
  await expect(title).toHaveValue("Alpha");
  await title.press("Delete");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await title.fill("   ");
  await title.press("Enter");
  await expect(page.getByRole("alert")).toHaveText("A task needs a title");
  await title.fill("Alpha 2");
  await title.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.getByRole("combobox", { name: "Priority" }).selectOption("high");
  await page.getByRole("combobox", { name: "Status" }).selectOption("done");
  await page.getByRole("combobox", { name: "List" }).selectOption("work");
  let task = (await fake(page)).tasks.find((t: any) => t.title === "Alpha 2");
  expect(task).toMatchObject({
    priority: "high",
    status: "done",
    listId: "work",
  });

  const editor = page.getByRole("textbox", { name: "Description (Markdown)" });
  await editor.fill(
    "Some **bold** <script>window.__hacked = 1</script> [x](javascript:alert(1))",
  );
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByLabel("Description preview");
  await expect(preview.locator("strong")).toHaveText("bold");
  await expect(preview).toContainText("<script>window.__hacked = 1</script>");
  await expect(preview.locator("a, script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__hacked)).toBeUndefined();
  await expect(page.getByRole("status")).toHaveText("Saved");
  task = (await fake(page)).tasks.find((t: any) => t.title === "Alpha 2");
  expect(task.descriptionMarkdown).toContain("**bold**");
  // Preview stays until Edit is chosen explicitly.
  await page.getByRole("button", { name: "Back to tasks" }).click();
  await expect(section(page, "Done")).toBeVisible();
  await page.getByRole("button", { name: /^Done \d+$/ }).click();
  await section(page, "Done")
    .getByRole("button", { name: /^Alpha 2/ })
    .click();
  await expect(page.getByLabel("Description preview")).toBeVisible();

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog", { name: "Delete task" })).toContainText(
    "deleted permanently",
  );
  await page.getByRole("button", { name: "Cancel" }).click();
  expect((await fake(page)).tasks).toHaveLength(4);
  await page.getByRole("button", { name: "Back to tasks" }).click();
  const row = section(page, "Todo").getByRole("button", { name: /^Beta/ });
  await row.focus();
  await page.keyboard.press("Delete");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(titles(page, "Todo")).toHaveText(["Gamma"]);
});

test("dragging reorders within a status and changes status without changing the list", async ({
  page,
}) => {
  await start(page, true);
  await expect(titles(page, "Todo")).toHaveText(["Alpha", "Beta", "Gamma"]);
  const handle = (name: string) =>
    page.locator(".task-row", { hasText: name }).locator(".task-handle");
  const row = (name: string) =>
    page.locator(".tasks-section .task-row", { hasText: name });
  /** Grabs a task, then moves to a place measured once its row left the list. */
  async function drag(
    name: string,
    target: () => Promise<{ x: number; y: number }>,
    release = true,
  ) {
    const box = (await handle(name).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2, {
      steps: 3,
    });
    // The grabbed card follows the pointer, out of the list.
    await expect(page.locator(".task-ghost")).toContainText(name);
    await expect(row(name)).toBeHidden();
    const { x, y } = await target();
    await page.mouse.move(x, y, { steps: 6 });
    if (release) await page.mouse.up();
  }
  const near = (name: string, dy: (height: number) => number) => async () => {
    const box = (await row(name).boundingBox())!;
    return { x: box.x + 40, y: box.y + dy(box.height) };
  };
  await drag(
    "Gamma",
    near("Alpha", () => 4),
  );
  await expect(page.locator(".task-ghost")).toHaveCount(0);
  await expect(titles(page, "Todo")).toHaveText(["Gamma", "Alpha", "Beta"]);
  await expect(page.locator(".task-detail")).toHaveCount(0);

  await drag(
    "Beta",
    near("Delta", (h) => h - 3),
  );
  await expect(titles(page, "In Progress")).toHaveText(["Delta", "Beta"]);
  const beta = (await fake(page)).tasks.find((t: any) => t.id === "Beta");
  expect(beta).toMatchObject({ status: "in_progress", listId: "work" });

  // Escape cancels a drag without a change; so does dropping outside the sections.
  const calls = async () =>
    (await page.evaluate(() => (window as any).__tasks.calls)).length;
  const before = await calls();
  await drag(
    "Alpha",
    near("Delta", () => 2),
    false,
  );
  await expect(page.locator(".task-slot")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".task-ghost")).toHaveCount(0);
  await page.mouse.up();
  await drag("Alpha", async () => ({ x: 5, y: 5 }));
  expect(await calls()).toBe(before);
  await expect(titles(page, "Todo")).toHaveText(["Gamma", "Alpha"]);

  // Keyboard alternative: Ctrl+Arrow moves the focused task inside its section.
  await section(page, "Todo")
    .getByRole("button", { name: /^Gamma/ })
    .focus();
  await page.keyboard.press("Control+ArrowDown");
  await expect(titles(page, "Todo")).toHaveText(["Alpha", "Gamma"]);
  await expect(
    section(page, "Todo").getByRole("button", { name: /^Gamma/ }),
  ).toBeFocused();

  // In a single list, a drop is placed among that list's tasks without moving others.
  await page.locator(".tasks-picker").click();
  await page.getByRole("menuitemcheckbox", { name: "Work" }).click();
  await expect(titles(page, "In Progress")).toHaveText(["Delta", "Beta"]);
  await drag(
    "Beta",
    near("Delta", () => 3),
  );
  await expect(titles(page, "In Progress")).toHaveText(["Beta", "Delta"]);
  // Dropping on a collapsed section appends to it. Its header moves up once the slot
  // leaves In Progress, so the pointer follows it there.
  const done = async () => {
    const box = (await page
      .getByRole("button", { name: /^Done \d+$/ })
      .boundingBox())!;
    return { x: box.x + 20, y: box.y + box.height / 2 };
  };
  await drag("Delta", done, false);
  const settled = await done();
  await page.mouse.move(settled.x, settled.y, { steps: 2 });
  await expect(page.locator(".tasks-section.drop-end")).toHaveCount(1);
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /^Done \d+$/ })).toHaveText(
    /Done1/,
  );
  expect(
    (await fake(page)).tasks.find((t: any) => t.id === "Delta").listId,
  ).toBe("work");
});

test("reopening resets the view, keeps the list, and unsaved edits block a silent close", async ({
  page,
}) => {
  await start(page, true);
  await page.locator(".tasks-picker").click();
  await page.getByRole("menuitemcheckbox", { name: "Work" }).click();
  await page.getByRole("button", { name: /^Done \d+$/ }).click();
  await section(page, "Todo").getByRole("button", { name: /^Beta/ }).click();
  await expect(page.locator(".task-detail")).toBeVisible();
  await page.keyboard.press("Control+w");
  await expect(page.locator(".tasks")).toHaveCount(0);
  await openTasks(page);
  await expect(page.locator(".tasks-picker")).toHaveAccessibleName(
    "List: Work",
  );
  await expect(page.locator(".task-detail")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^Done \d+$/ }),
  ).toHaveAttribute("aria-expanded", "false");

  await section(page, "Todo").getByRole("button", { name: /^Beta/ }).click();
  await page.evaluate(
    () => ((window as any).__tasks.fail = "Tasks were not saved: disk full"),
  );
  await page.getByRole("button", { name: "Edit" }).click();
  await page
    .getByRole("textbox", { name: "Description (Markdown)" })
    .fill("notes");
  await expect(page.getByRole("status")).toHaveText("Not saved");
  await expect(page.getByRole("alert")).toContainText("disk full");
  await page.getByRole("button", { name: "Back to tasks" }).click();
  await expect(page.locator(".task-detail")).toBeVisible();
  await page.keyboard.press("Control+w");
  await expect(
    page.getByRole("dialog", { name: "Unsaved changes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("textbox", { name: "Description (Markdown)" }),
  ).toHaveValue("notes");
  await page.evaluate(() => ((window as any).__tasks.fail = null));
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  expect(
    (await fake(page)).tasks.find((t: any) => t.id === "Beta")
      .descriptionMarkdown,
  ).toBe("notes");
  await page.keyboard.press("Control+w");
  await expect(page.locator(".tasks")).toHaveCount(0);
});
test("the command palette offers Tasks commands while Tasks is in the workspace", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await installFakeBackend(page);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("tasks");
  // Without the panel only the command that adds it is listed.
  await expect(palette.getByRole("option")).toHaveText([
    "Add to Workspace: Tasks",
  ]);
  await page.keyboard.press("Enter");
  await expect(page.locator(".tasks")).toBeVisible();
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("tasks: new task");
  await page.keyboard.press("Enter");
  const input = page.getByRole("textbox", { name: "New task in Todo" });
  await expect(input).toBeFocused();
  await input.fill("From the palette");
  await input.press("Enter");
  await expect(titles(page, "Todo")).toHaveText(["From the palette"]);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("tasks: new list");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "New list" })).toBeVisible();
});
