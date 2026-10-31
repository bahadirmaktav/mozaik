import { test, expect, type Page } from "@playwright/test";

// Browser runs have no native backend. This replaces the typed notes adapter with an
// in-memory notes folder of Markdown files that follows the Rust rules (no replacing names,
// revision checks, groups as folders). It is kept in localStorage so a reload stands in for
// a restart. It covers the panel, not the native files, watcher, dialog or Trash.
async function start(
  page: Page,
  { reset = true, folder: initial = "/notes" as string | null } = {},
) {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.evaluate(
    async ({ reset, initial }) => {
      const loaded = (path: string) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === path) ?? path;
      const module = await import(loaded("/src/services/notes.ts"));
      const prefs = (await import(loaded("/src/services/preferences.ts")))
        .preferencesBackend;
      if (reset)
        localStorage.setItem(
          "fake-notes",
          JSON.stringify({
            groups: ["Linux"],
            files: { "QuickNotes.md": "", "Linux/Shell.md": "# Shell" },
          }),
        );
      const state = () => JSON.parse(localStorage.getItem("fake-notes")!);
      const calls: { name: string; args: unknown[] }[] = [];
      (window as any).__notes = { calls, delay: 0, external: null };
      let folder: string | null = initial;
      await prefs.set({ ...(await prefs.get()), notesFolder: folder });
      prefs.chooseFolder = async () => "/notes";
      const save = (s: any) =>
        localStorage.setItem("fake-notes", JSON.stringify(s));
      const revision = (text: string) => `r${text.length}:${text}`;
      const parent = (p: string) =>
        p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      async function change<T>(name: string, args: unknown[], work: () => T) {
        calls.push({ name, args });
        const delay = (window as any).__notes.delay;
        if (delay) await new Promise((r) => setTimeout(r, delay));
        return work();
      }
      const valid = (name: string, what: string) => {
        if (!name.trim()) throw new Error(`A ${what} needs a title`);
        if (/[\\/]/.test(name)) throw new Error("Names cannot contain /");
        return name.trim();
      };
      const b = module.notesBackend;
      b.snapshot = async () => {
        folder = (await prefs.get()).notesFolder;
        if (!folder)
          return { root: null, groups: [], notes: [], truncated: false };
        const s = state();
        return {
          root: folder,
          groups: [...s.groups].sort(),
          notes: Object.keys(s.files)
            .sort((a, c) => a.toLowerCase().localeCompare(c.toLowerCase()))
            .map((path) => ({
              path,
              title: path.slice(path.lastIndexOf("/") + 1, -3),
              modified: 1,
            })),
          truncated: false,
        };
      };
      b.read = async (path: string) => {
        const text = state().files[path];
        if (text === undefined)
          throw new Error(`The note ${path} no longer exists`);
        return {
          path: `${folder}/${path}`,
          name: path,
          text,
          revision: revision(text),
          bom: false,
          ending: "lf",
        };
      };
      b.write = (path: string, text: string, file: any) =>
        change("write", [path, text], () => {
          const s = state();
          const external = (window as any).__notes.external;
          if (external !== null) {
            s.files[path] = external;
            (window as any).__notes.external = null;
            save(s);
          }
          if (revision(s.files[path]) !== file.revision)
            throw new Error(
              "The file changed or disappeared on disk. Reload it or use Save As; your edits are still in memory.",
            );
          s.files[path] = text;
          save(s);
          return { ...file, text, revision: revision(text) };
        });
      b.create = (group: string, title: string) =>
        change("create", [group, title], () => {
          const s = state();
          const path = `${group ? `${group}/` : ""}${valid(title, "note")}.md`;
          if (path in s.files)
            throw new Error(`A note named “${title}” already exists there`);
          s.files[path] = "";
          save(s);
          return path;
        });
      b.createGroup = (group: string, name: string) =>
        change("createGroup", [group, name], () => {
          const s = state();
          const path = `${group ? `${group}/` : ""}${valid(name, "group")}`;
          if (s.groups.includes(path))
            throw new Error(`A group named “${name}” already exists there`);
          s.groups.push(path);
          save(s);
          return path;
        });
      const relocate = (from: string, to: string) => {
        const s = state();
        const taken = s.groups.includes(to) || to in s.files;
        if (taken) throw new Error("That name already exists there");
        const move = (p: string) =>
          p === from
            ? to
            : p.startsWith(`${from}/`)
              ? to + p.slice(from.length)
              : p;
        s.groups = s.groups.map(move);
        s.files = Object.fromEntries(
          Object.entries(s.files).map(([p, t]) => [move(p), t]),
        );
        save(s);
        return to;
      };
      b.rename = (path: string, name: string) =>
        change("rename", [path, name], () => {
          const base = parent(path);
          const leaf = path.endsWith(".md")
            ? `${valid(name, "note")}.md`
            : valid(name, "group");
          return relocate(path, `${base ? `${base}/` : ""}${leaf}`);
        });
      b.move = (path: string, group: string) =>
        change("move", [path, group], () =>
          relocate(
            path,
            `${group ? `${group}/` : ""}${path.slice(path.lastIndexOf("/") + 1)}`,
          ),
        );
      b.trash = (path: string) =>
        change("trash", [path], () => {
          const s = state();
          const inside = (p: string) => p === path || p.startsWith(`${path}/`);
          s.groups = s.groups.filter((g: string) => !inside(g));
          s.files = Object.fromEntries(
            Object.entries(s.files).filter(([p]) => !inside(p)),
          );
          save(s);
        });
      b.claimPanel = async () => true;
      b.releasePanel = async () => {};
    },
    { reset, initial },
  );
}
async function openNotes(page: Page) {
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("notes");
  await page.keyboard.press("Enter");
  await expect(page.locator(".notes")).toBeVisible();
}
const tree = (page: Page) =>
  page.getByRole("tree", { name: "Notes and groups" });
const rows = (page: Page) => tree(page).getByRole("treeitem");
const row = (page: Page, name: string) =>
  rows(page).filter({ hasText: new RegExp(`^[▸▾]?${name}( •)?$`) });
const files = (page: Page) =>
  page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("fake-notes")!).files as Record<
        string,
        string
      >,
  );
async function create(page: Page, kind: "Note" | "Group", name: string) {
  await page.getByRole("button", { name: `+ ${kind}` }).click();
  const dialog = page.getByRole("dialog", {
    name: `New ${kind.toLowerCase()}`,
  });
  await dialog
    .getByRole("textbox", {
      name: kind === "Note" ? "Note title" : "Group name",
    })
    .fill(name);
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
}
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "Note content (Markdown)" });

test("without a notes folder the panel asks for a folder; its Markdown files are the notes", async ({
  page,
}) => {
  await start(page, { folder: null });
  await openNotes(page);
  await expect(page.locator(".notes")).toContainText("subfolders are groups");
  await page.getByRole("button", { name: "Choose notes folder…" }).click();
  // Groups (subfolders) first, closed; then the notes of the folder's top.
  await expect(rows(page)).toHaveText(["▸Linux", "QuickNotes"]);
  await row(page, "Linux").click();
  await expect(rows(page)).toHaveText(["▾Linux", "Shell", "QuickNotes"]);
  await row(page, "Shell").click();
  await expect(page.getByRole("textbox", { name: "Note title" })).toHaveValue(
    "Shell",
  );
  // A note with text opens in Preview.
  await expect(page.getByLabel("Note preview").locator("h1")).toHaveText(
    "Shell",
  );
  // The panel is application-wide: opening it again focuses it.
  await openNotes(page);
  await expect(page.locator(".notes")).toHaveCount(1);
});

test("notes and groups are created in the selected group and content autosaves", async ({
  page,
}) => {
  await start(page);
  await openNotes(page);
  await row(page, "Linux").click();
  await create(page, "Group", "Kernel");
  await expect(rows(page)).toHaveText([
    "▾Linux",
    "▸Kernel",
    "Shell",
    "QuickNotes",
  ]);
  // The new group is selected: the new note goes into it.
  await create(page, "Note", "Modules");
  await expect(rows(page)).toHaveText([
    "▾Linux",
    "▾Kernel",
    "Modules",
    "Shell",
    "QuickNotes",
  ]);
  await editor(page).fill(
    ["# Modules", "- `lsmod`", "See <script>window.__pwned=1</script>"].join(
      "\n",
    ),
  );
  await expect
    .poll(async () => (await files(page))["Linux/Kernel/Modules.md"])
    .toContain("lsmod");
  await expect(row(page, "Modules")).not.toContainText("•");
  await page.getByRole("button", { name: "Preview" }).click();
  const preview = page.getByLabel("Note preview");
  await expect(preview.locator("h1")).toHaveText("Modules");
  await expect(preview.locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined();
  // Names are never replaced.
  await create(page, "Group", "Other");
  await row(page, "Modules").click();
  await page.getByRole("button", { name: "+ Group" }).click();
  const dialog = page.getByRole("dialog", { name: "New group" });
  await dialog.getByRole("textbox", { name: "Group name" }).fill("Other");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await page.keyboard.press("Escape");
  // Reopening after a restart shows the same files.
  await start(page, { reset: false });
  await openNotes(page);
  await row(page, "Linux").click();
  await expect(rows(page)).toContainText(["Kernel"]);
});

test("titles rename the file, the group select moves it and Trash asks first", async ({
  page,
}) => {
  await start(page);
  await openNotes(page);
  await row(page, "QuickNotes").click();
  const title = page.getByRole("textbox", { name: "Note title" });
  await title.fill("Scratch");
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveText(["▸Linux", "Scratch"]);
  expect(Object.keys(await files(page))).toContain("Scratch.md");
  await title.fill("   ");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("A note needs a title");
  await page.keyboard.press("Escape");
  await expect(title).toHaveValue("Scratch");

  // Unsaved text is saved before the note moves.
  await editor(page).fill("draft text");
  await page.getByRole("combobox", { name: "Group" }).selectOption("Linux");
  await expect(rows(page)).toHaveText(["▾Linux", "Scratch", "Shell"]);
  expect((await files(page))["Linux/Scratch.md"]).toBe("draft text");

  await page.getByRole("button", { name: "Move to Trash" }).click();
  const dialog = page.getByRole("dialog", { name: "Move note to Trash" });
  await expect(dialog).toContainText("Scratch");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(rows(page)).toHaveText(["▾Linux", "Scratch", "Shell"]);
  // F2 renames a row, Delete asks to move it to the Trash.
  await row(page, "Shell").focus();
  await page.keyboard.press("F2");
  const rename = page.getByRole("dialog", { name: "Rename note" });
  await rename.getByRole("textbox", { name: "Note title" }).fill("Bash");
  await page.keyboard.press("Enter");
  await expect(rows(page)).toHaveText(["▾Linux", "Bash", "Scratch"]);
  await row(page, "Linux").focus();
  await page.keyboard.press("Delete");
  const group = page.getByRole("dialog", { name: "Move group to Trash" });
  await expect(group).toContainText("2 notes");
  await group.getByRole("button", { name: "Move to Trash" }).click();
  await expect(rows(page)).toHaveCount(0);
  expect(await files(page)).toEqual({});
});

test("a note changed on disk is never overwritten without a decision", async ({
  page,
}) => {
  await start(page);
  await openNotes(page);
  await row(page, "QuickNotes").click();
  await page.evaluate(() => ((window as any).__notes.external = "from vim"));
  await editor(page).fill("mine");
  const notice = page.getByRole("alert").filter({ hasText: "Not saved" });
  await expect(notice).toContainText("changed or disappeared on disk");
  expect((await files(page))["QuickNotes.md"]).toBe("from vim");
  await expect(row(page, "QuickNotes")).toContainText("•");
  await notice.getByRole("button", { name: "Overwrite" }).click();
  await expect
    .poll(async () => (await files(page))["QuickNotes.md"])
    .toBe("mine");
  await expect(notice).toHaveCount(0);

  await page.evaluate(() => ((window as any).__notes.external = "theirs"));
  await editor(page).fill("mine again");
  await notice.getByRole("button", { name: "Reload from Disk" }).click();
  await expect(editor(page)).toHaveValue("theirs");
  await expect(row(page, "QuickNotes")).not.toContainText("•");
});

test("fast switching and closing keep every keystroke", async ({ page }) => {
  await start(page);
  await openNotes(page);
  await create(page, "Note", "GitNotes");
  // Slow saves make switches happen while writes are still in flight.
  await page.evaluate(() => ((window as any).__notes.delay = 150));
  for (let round = 0; round < 3; round++) {
    await row(page, "QuickNotes").click();
    await page.getByRole("button", { name: "Edit" }).click();
    await editor(page).press("End");
    await editor(page).pressSequentially(`q${round} `);
    await row(page, "GitNotes").click();
    await page.getByRole("button", { name: "Edit" }).click();
    await editor(page).press("End");
    await editor(page).pressSequentially(`g${round} `);
  }
  // Closing waits for pending saves instead of asking or dropping them.
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await expect(page.locator(".notes")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await files(page);
  expect(saved["QuickNotes.md"]).toBe("q0 q1 q2 ");
  expect(saved["GitNotes.md"]).toBe("g0 g1 g2 ");
});

test("a narrow Notes panel stacks the list above the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 440, height: 600 });
  await start(page);
  await openNotes(page);
  await row(page, "QuickNotes").click();
  const list = (await page.locator(".notes-list").boundingBox())!;
  const note = (await page.locator(".note-page").boundingBox())!;
  expect(note.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
  await editor(page).fill("small panel");
  await expect
    .poll(async () => (await files(page))["QuickNotes.md"])
    .toBe("small panel");
  await expect(page.getByRole("button", { name: "+ Note" })).toBeVisible();
});
