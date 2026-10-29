import { test, expect, type Page } from "@playwright/test";

// Browser runs have no native backend. This replaces the typed notes adapter with an
// in-memory document that follows the Rust rules (seed once, ordering, validation, revisions).
// It is kept in localStorage so a reload stands in for a restart. It covers the panel, not
// the native file, locking or crash behavior.
async function start(page: Page, { reset = true } = {}) {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.evaluate(async (reset) => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const module = await import(loaded("/src/services/notes.ts"));
    if (reset) localStorage.removeItem("fake-notes");
    const stored = localStorage.getItem("fake-notes");
    let doc: any = stored ? JSON.parse(stored) : null;
    const calls: { name: string; args: unknown[] }[] = [];
    (window as any).__notes = { calls, delay: 0 };
    const now = () => new Date().toISOString();
    const load = () =>
      doc ?? {
        schemaVersion: 1,
        revision: 0,
        notes: [
          {
            id: "quick-notes",
            title: "QuickNotes",
            contentMarkdown: "",
            orderKey: 0,
            createdAt: now(),
            updatedAt: now(),
          },
        ],
        preferences: { selectedNoteId: "quick-notes" },
      };
    const order = (d: any) =>
      [...d.notes].sort((a: any, b: any) => a.orderKey - b.orderKey);
    async function change(
      name: string,
      args: unknown[],
      work: (d: any) => void,
    ) {
      calls.push({ name, args });
      const delay = (window as any).__notes.delay;
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const next = structuredClone(load());
      work(next);
      next.revision++;
      doc = next;
      localStorage.setItem("fake-notes", JSON.stringify(doc));
      return structuredClone(doc);
    }
    const find = (d: any, id: string) => {
      const note = d.notes.find((n: any) => n.id === id);
      if (!note) throw new Error("That note no longer exists");
      return note;
    };
    const title = (value: string) => {
      if (!value.trim()) throw new Error("A note needs a title");
      return value.trim();
    };
    const b = module.notesBackend;
    b.snapshot = async () => structuredClone(load());
    b.create = (value: string) =>
      change("create", [value], (d) => {
        const id = crypto.randomUUID();
        d.notes.push({
          id,
          title: title(value),
          contentMarkdown: "",
          orderKey: Math.max(-1, ...d.notes.map((n: any) => n.orderKey)) + 1,
          createdAt: now(),
          updatedAt: now(),
        });
        d.preferences.selectedNoteId = id;
      });
    b.update = (id: string, patch: any) =>
      change("update", [id, patch], (d) => {
        const note = find(d, id);
        if (patch.title !== undefined) note.title = title(patch.title);
        if (patch.contentMarkdown !== undefined)
          note.contentMarkdown = patch.contentMarkdown;
      });
    b.move = (id: string, before: string | null, after: string | null) =>
      change("move", [id, before, after], (d) => {
        const ids = order(d)
          .map((n: any) => n.id)
          .filter((n: string) => n !== id);
        const index = before
          ? ids.indexOf(before)
          : after
            ? ids.indexOf(after) + 1
            : ids.length;
        ids.splice(index, 0, id);
        ids.forEach((n: string, i: number) => (find(d, n).orderKey = i));
      });
    b.remove = (id: string) =>
      change("remove", [id], (d) => {
        const ids = order(d).map((n: any) => n.id);
        const index = ids.indexOf(id);
        d.notes = d.notes.filter((n: any) => n.id !== id);
        const rest = ids.filter((n: string) => n !== id);
        if (d.preferences.selectedNoteId === id)
          d.preferences.selectedNoteId =
            rest[Math.min(index, rest.length - 1)] ?? null;
      });
    b.select = (id: string) =>
      change("select", [id], (d) => {
        find(d, id);
        d.preferences.selectedNoteId = id;
      });
    b.claimPanel = async () => true;
    b.releasePanel = async () => {};
  }, reset);
}
async function openNotes(page: Page) {
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("notes");
  await page.keyboard.press("Enter");
  await expect(page.locator(".notes")).toBeVisible();
}
const rows = (page: Page) => page.locator(".note-open");
const stored = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("fake-notes") ?? "null"));
async function newNote(page: Page, title: string) {
  await page.getByRole("button", { name: "+ New note" }).click();
  await page
    .getByRole("dialog", { name: "New note" })
    .getByRole("textbox", { name: "Note title" })
    .fill(title);
  await page.keyboard.press("Enter");
  await expect(rows(page).filter({ hasText: title })).toBeVisible();
}

test("first use shows one empty QuickNotes; new notes are independent pages", async ({
  page,
}) => {
  await start(page);
  await openNotes(page);
  await expect(rows(page)).toHaveText(["QuickNotes"]);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "QuickNotes",
  );
  // An empty note opens for writing.
  await expect(
    page.getByRole("textbox", { name: "Note content (Markdown)" }),
  ).toHaveValue("");
  await newNote(page, "GitNotes");
  await expect(rows(page)).toHaveText(["QuickNotes", "GitNotes"]);
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "GitNotes",
  );
  // No folders, categories or nested notes.
  await expect(page.locator(".notes select, .notes [role=tree]")).toHaveCount(
    0,
  );
  // Reopening after a restart does not add another QuickNotes.
  await start(page, { reset: false });
  await openNotes(page);
  await expect(rows(page)).toHaveText(["QuickNotes", "GitNotes"]);
  // The panel is application-wide: opening it again focuses it.
  await openNotes(page);
  await expect(page.locator(".notes")).toHaveCount(1);
});

test("content autosaves without a file dialog and previews safe Markdown", async ({
  page,
}) => {
  await start(page);
  await openNotes(page);
  const editor = page.getByRole("textbox", { name: "Note content (Markdown)" });
  await editor.fill(
    [
      "# Git",
      "",
      "- status",
      "- [x] commit",
      "",
      "```sh",
      "git log --oneline",
      "```",
      "",
      "See [docs](https://git-scm.com) and <script>window.__pwned=1</script>",
      '<img src=x onerror="window.__pwned=1">',
    ].join("\n"),
  );
  await expect
    .poll(async () => (await stored(page))?.notes[0].contentMarkdown)
    .toContain("git log --oneline");
  await expect(page.locator(".note-open")).not.toContainText("•");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByLabel("Note preview");
  await expect(preview.locator("h1")).toHaveText("Git");
  await expect(preview.locator("li")).toHaveCount(2);
  await expect(preview.locator("pre")).toContainText("git log --oneline");
  await expect(preview.locator(".md-link")).toHaveText("docs");
  await expect(preview.locator("a, script, img")).toHaveCount(0);
  await preview.locator(".md-link").click();
  expect(page.url()).toMatch(/localhost/);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  // Edit and Preview are explicit: clicking the preview does not start editing.
  await preview.click();
  await expect(
    page.getByRole("textbox", { name: "Note content (Markdown)" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(editor).toHaveValue(/# Git/);
});

test("drag and keyboard reorder persist across a restart", async ({ page }) => {
  await start(page);
  await openNotes(page);
  await newNote(page, "GitNotes");
  await newNote(page, "LinuxNotes");
  await expect(rows(page)).toHaveText(["QuickNotes", "GitNotes", "LinuxNotes"]);
  const handle = page.getByRole("button", { name: "Reorder LinuxNotes" });
  const target = (await rows(page).first().boundingBox())!;
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 4, target.y + 2, { steps: 6 });
  await expect(page.locator(".note-row.drop-before")).toHaveCount(1);
  await page.mouse.up();
  await expect(rows(page)).toHaveText(["LinuxNotes", "QuickNotes", "GitNotes"]);
  await rows(page).filter({ hasText: "QuickNotes" }).focus();
  await page.keyboard.press("Control+ArrowDown");
  await expect(rows(page)).toHaveText(["LinuxNotes", "GitNotes", "QuickNotes"]);
  await start(page, { reset: false });
  await openNotes(page);
  await expect(rows(page)).toHaveText(["LinuxNotes", "GitNotes", "QuickNotes"]);
});

test("title edits save on Enter; deleting asks first", async ({ page }) => {
  await start(page);
  await openNotes(page);
  await newNote(page, "Scratch");
  const title = page.getByRole("textbox", { name: "Note title" });
  await title.fill("LinuxNotes");
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveText(["QuickNotes", "LinuxNotes"]);
  expect((await stored(page)).notes[1].title).toBe("LinuxNotes");
  await title.fill("   ");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("A note needs a title");
  await page.keyboard.press("Escape");
  await expect(title).toHaveValue("LinuxNotes");

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete note" });
  await expect(dialog).toContainText("LinuxNotes");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(rows(page)).toHaveText(["QuickNotes", "LinuxNotes"]);
  await rows(page).filter({ hasText: "LinuxNotes" }).focus();
  await page.keyboard.press("Delete");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(rows(page)).toHaveText(["QuickNotes"]);
  await expect(title).toHaveValue("QuickNotes");
});

test("fast switching and closing keep every keystroke", async ({ page }) => {
  await start(page);
  await openNotes(page);
  await newNote(page, "GitNotes");
  // Slow saves make switches happen while writes are still in flight.
  await page.evaluate(() => ((window as any).__notes.delay = 150));
  const editor = page.getByRole("textbox", { name: "Note content (Markdown)" });
  for (let round = 0; round < 3; round++) {
    await rows(page).filter({ hasText: "QuickNotes" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await editor.press("End");
    await editor.pressSequentially(`q${round} `);
    await rows(page).filter({ hasText: "GitNotes" }).click();
    await page.getByRole("button", { name: "Edit" }).click();
    await editor.press("End");
    await editor.pressSequentially(`g${round} `);
  }
  // Closing waits for pending saves instead of asking or dropping them.
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await expect(page.locator(".notes")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const notes = (await stored(page)).notes;
  const content = (title: string) =>
    notes.find((n: any) => n.title === title).contentMarkdown;
  expect(content("QuickNotes")).toBe("q0 q1 q2 ");
  expect(content("GitNotes")).toBe("g0 g1 g2 ");
});

test("a narrow Notes panel stacks the list above the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 440, height: 600 });
  await start(page);
  await openNotes(page);
  const list = (await page.locator(".notes-list").boundingBox())!;
  const note = (await page.locator(".note-page").boundingBox())!;
  expect(note.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
  await page
    .getByRole("textbox", { name: "Note content (Markdown)" })
    .fill("small panel");
  await expect
    .poll(async () => (await stored(page))?.notes[0].contentMarkdown)
    .toBe("small panel");
  await expect(page.getByRole("button", { name: "+ New note" })).toBeVisible();
});
