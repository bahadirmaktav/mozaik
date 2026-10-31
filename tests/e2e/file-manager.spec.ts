import { test, expect, type Page } from "@playwright/test";

// Browser runs have no native backend. These tests replace the typed service adapters with an
// in-memory POSIX-like tree, so they cover the panel's behavior, not native filesystem I/O.
async function installFakeBackend(page: Page) {
  await page.evaluate(async () => {
    type Node = {
      kind: "file" | "directory" | "symlink";
      size?: number;
      modified: number;
      targetKind?: "directory" | "file" | "unknown";
      broken?: boolean;
    };
    // Import the instance the app loaded; a long-running dev server adds HMR query strings.
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    (window as any).__loaded = loaded;
    const fs = await import(loaded("/src/services/filesystem.ts"));
    const pinModule = await import(loaded("/src/services/pins.ts"));
    const nodes = new Map<string, Node>();
    const calls: Record<string, unknown[]> = {};
    const delays: Record<string, number> = {};
    const record = (name: string, value: unknown) =>
      (calls[name] ??= []).push(value);
    (window as any).__fm = { nodes, calls, delays };
    const add = (path: string, node: Partial<Node> = {}) =>
      nodes.set(path, { kind: "file", size: 12, modified: 1.7e12, ...node });
    const dir = (path: string) => add(path, { kind: "directory" });
    ["/", "/home", "/home/user", "/home/user/Documents"].forEach(dir);
    ["/home/user/Projects", "/home/user/.config", "/home/user/big"].forEach(
      dir,
    );
    add("/home/user/notes.txt", { size: 2048 });
    add("/home/user/Documents/notes.txt");
    add("/home/user/old-link", {
      kind: "symlink",
      targetKind: "unknown",
      broken: true,
    });
    for (let i = 0; i < 5000; i++) add(`/home/user/big/file-${i}.log`);
    const parent = (p: string) =>
      p === "/" ? null : p.slice(0, p.lastIndexOf("/")) || "/";
    const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
    const join = (d: string, n: string) => (d === "/" ? `/${n}` : `${d}/${n}`);
    const isDir = (p: string) => nodes.get(p)?.kind === "directory";
    const entry = (path: string) => {
      const n = nodes.get(path)!;
      return {
        path,
        name: base(path),
        kind: n.kind,
        targetKind: n.targetKind ?? null,
        hidden: base(path).startsWith("."),
        size: n.kind === "file" ? (n.size ?? 0) : null,
        modified: n.modified,
        broken: !!n.broken,
        unsupported: false,
      };
    };
    const subtree = (p: string) =>
      [...nodes.keys()].filter((k) => k === p || k.startsWith(`${p}/`));
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    fs.fileSystem.list = async (path: string | null) => {
      const directory = path ?? "/home/user";
      await sleep(delays[directory] ?? 0);
      if (!isDir(directory)) throw new Error(`${directory} does not exist`);
      const crumbs = [{ name: "/", path: "/" }];
      for (const part of directory.split("/").filter(Boolean))
        crumbs.push({
          name: part,
          path: join(crumbs[crumbs.length - 1].path, part),
        });
      return {
        directory,
        parent: parent(directory),
        crumbs,
        separator: "/",
        entries: [...nodes.keys()]
          .filter((k) => k !== "/" && parent(k) === directory)
          .map(entry),
        unreadable: 0,
        fallbackFrom: null,
      };
    };
    fs.fileSystem.watch = async () => {};
    fs.fileSystem.open = async (path: string) => record("open", path);
    // Text files open in a Text Editor; a file that is not text is refused as in Rust.
    const files = (await import(loaded("/src/services/native.ts"))).fileBackend;
    files.open = async (path: string | null) => {
      record("text", path);
      if (path!.endsWith(".bin"))
        throw new Error(
          "This appears to be a binary file; it was not opened as text",
        );
      return {
        path,
        name: base(path!),
        text: `text of ${base(path!)}`,
        revision: "1",
        bom: false,
        ending: "lf",
      };
    };
    fs.fileSystem.create = async (p: string, name: string, d: boolean) => {
      const path = join(p, name);
      if (nodes.has(path))
        throw new Error(`An item named “${name}” already exists`);
      d ? dir(path) : add(path, { size: 0 });
      return entry(path);
    };
    fs.fileSystem.rename = async (path: string, name: string) => {
      const target = join(parent(path)!, name);
      for (const k of subtree(path)) {
        nodes.set(target + k.slice(path.length), nodes.get(k)!);
        nodes.delete(k);
      }
      return entry(target);
    };
    fs.fileSystem.plan = async (
      sources: string[],
      destination: string,
      mode: string,
    ) => {
      record("plan", { sources, destination, mode });
      for (const s of sources)
        if (destination === s || destination.startsWith(`${s}/`))
          throw new Error(`“${base(s)}” cannot be placed inside itself`);
      return {
        conflicts: sources
          .filter(
            (s) =>
              nodes.has(join(destination, base(s))) &&
              !(mode === "move" && parent(s) === destination),
          )
          .map((s) => ({
            source: s,
            target: join(destination, base(s)),
            name: base(s),
            sourceDirectory: isDir(s),
            targetDirectory: isDir(join(destination, base(s))),
            same: join(destination, base(s)) === s,
          })),
      };
    };
    fs.fileSystem.transfer = async (request: any) => {
      record("transfer", request);
      const report = {
        completed: [] as string[],
        skipped: 0,
        failed: [] as unknown[],
        cancelled: false,
      };
      for (const source of request.sources) {
        let target = join(request.destination, base(source));
        if (request.mode === "move" && target === source) {
          report.skipped++;
          continue;
        }
        if (nodes.has(target)) {
          const decision = request.resolutions[source];
          if (decision === "skip" || !decision) {
            report.skipped++;
            continue;
          }
          if (decision === "keepBoth") {
            const name = base(source),
              dot = name.lastIndexOf(".");
            const [stem, ext] =
              dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
            const series = stem.replace(/ \(\d+\)$/, "");
            for (let n = 2; nodes.has(target); n++)
              target = join(request.destination, `${series} (${n})${ext}`);
          } else subtree(target).forEach((k) => nodes.delete(k));
        }
        for (const k of subtree(source)) {
          nodes.set(target + k.slice(source.length), { ...nodes.get(k)! });
          if (request.mode === "move") nodes.delete(k);
        }
        report.completed.push(target);
      }
      return report;
    };
    const remove = (name: string) => async (paths: string[]) => {
      record(name, paths);
      paths.forEach((p) => subtree(p).forEach((k) => nodes.delete(k)));
      return [];
    };
    fs.fileSystem.trash = remove("trash");
    fs.fileSystem.deletePermanently = remove("deletePermanently");
    fs.fileSystem.setShowHidden = async () => {};
    let pins: any[] = [];
    const view = () => pins.map((p) => ({ ...p, missing: !nodes.has(p.path) }));
    pinModule.pinBackend.list = async () => view();
    pinModule.pinBackend.add = async (path: string) => {
      if (!pins.some((p) => p.path === path))
        pins.push({
          id: crypto.randomUUID(),
          path,
          name: base(path),
          kind: isDir(path) ? "directory" : "file",
        });
      return view();
    };
    pinModule.pinBackend.remove = async (id: string) => {
      pins = pins.filter((p) => p.id !== id);
      return view();
    };
    pinModule.pinBackend.reorder = async (ids: string[]) => {
      pins = ids.map((id) => pins.find((p) => p.id === id));
      return view();
    };
  });
}
async function openFileManager(page: Page, mode: "split" | "tab" = "split") {
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("file");
  await page.keyboard.press(mode === "tab" ? "Control+Enter" : "Enter");
}
const location = (page: Page, panel = 0) =>
  page
    .locator(".file-manager")
    .nth(panel)
    .locator('.fm-crumb[aria-current="location"]');
const row = (page: Page, name: string, panel = 0) =>
  page
    .locator(".file-manager")
    .nth(panel)
    .locator(".fm-row", { has: page.locator(".fm-label", { hasText: name }) })
    .first();
async function start(page: Page) {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await installFakeBackend(page);
  await openFileManager(page);
  await expect(location(page)).toHaveText("user");
}

test("browser build reports that the file manager needs the desktop app", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await openFileManager(page);
  await expect(page.locator(".fm-state")).toContainText(
    "requires the Mozaik desktop app",
  );
  await expect(page.getByRole("tab", { name: "File Manager" })).toBeVisible();
});

test("opens home, navigates with history, path entry, filter, sort and hidden toggle", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await expect(page.getByRole("tab", { name: "user" })).toBeVisible();
  await expect(row(page, "notes.txt")).toBeVisible();
  await expect(row(page, ".config")).toHaveCount(0);
  await expect(page.locator(".fm-status")).toContainText("5 items · 1 hidden");
  await expect(row(page, "old-link")).toHaveClass(/broken/);
  await expect(row(page, "notes.txt").locator(".fm-size")).toHaveText("2.0 KB");
  await expect(row(page, "Documents").locator(".fm-size")).toHaveText("—");

  await row(page, "Documents").dblclick();
  await expect(location(page)).toHaveText("Documents");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(location(page)).toHaveText("user");
  await page.getByRole("button", { name: "Forward", exact: true }).click();
  await expect(location(page)).toHaveText("Documents");
  await page.locator(".fm-list").focus();
  await page.keyboard.press("Backspace");
  await expect(location(page)).toHaveText("user");
  await expect(
    page.getByRole("button", { name: "Forward", exact: true }),
  ).toBeDisabled();

  await page.getByRole("searchbox", { name: "Filter this folder" }).fill("pro");
  await expect(page.locator(".fm-row")).toHaveCount(1);
  // Keys typed into the filter stay there: Backspace edits text instead of going up.
  await page.keyboard.press("Backspace");
  await expect(location(page)).toHaveText("user");
  await row(page, "Projects").dblclick();
  await expect(location(page)).toHaveText("Projects");
  await expect(
    page.getByRole("searchbox", { name: "Filter this folder" }),
  ).toHaveValue("");

  await page.locator(".fm-list").focus();
  await page.keyboard.press("Control+l");
  const path = page.getByRole("textbox", { name: "Folder path" });
  await expect(path).toHaveValue("/home/user/Projects");
  await path.fill("/home/user");
  await page.keyboard.press("Enter");
  await expect(location(page)).toHaveText("user");
  await page.keyboard.press("Control+l");
  await path.fill("/nowhere");
  await page.keyboard.press("Enter");
  await expect(page.locator(".fm-notice")).toContainText(
    "/nowhere does not exist",
  );
  await expect(location(page)).toHaveText("user");

  await page.getByRole("columnheader", { name: "Name" }).click();
  const names = await page.locator(".fm-label").allTextContents();
  expect(names).toEqual([
    "Projects",
    "Documents",
    "big",
    "old-link",
    "notes.txt",
  ]);
  await page.getByRole("button", { name: "More actions" }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Show hidden files" })
    .click();
  await expect(row(page, ".config")).toBeVisible();
  await row(page, "notes.txt").click({ button: "right" });
  await page.screenshot({ path: "test-results/file-manager.png" });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("large folders are virtualized and stale listings never win", async ({
  page,
}) => {
  await start(page);
  await row(page, "big").dblclick();
  await expect(page.locator(".fm-status")).toContainText("5000 items");
  expect(await page.locator(".fm-row").count()).toBeLessThan(80);
  await page
    .locator(".fm-list")
    .evaluate((n) => (n.scrollTop = n.scrollHeight));
  await expect(row(page, "file-4999.log")).toBeVisible();
  await page.locator(".fm-list").focus();
  await page.keyboard.press("Control+a");
  await expect(page.locator(".fm-status")).toContainText("5000 selected");

  await page.evaluate(
    () => ((window as any).__fm.delays["/home/user/Documents"] = 600),
  );
  await page.getByRole("button", { name: "user" }).click();
  await expect(location(page)).toHaveText("user");
  await row(page, "Documents").dblclick();
  await page.keyboard.press("Control+l");
  await page
    .getByRole("textbox", { name: "Folder path" })
    .fill("/home/user/Projects");
  await page.keyboard.press("Enter");
  await expect(location(page)).toHaveText("Projects");
  await page.waitForTimeout(900);
  await expect(location(page)).toHaveText("Projects");
});

test("panels keep independent history but share pins", async ({ page }) => {
  await start(page);
  await openFileManager(page);
  await expect(page.locator(".file-manager")).toHaveCount(2);
  await row(page, "Documents", 0).dblclick();
  await expect(location(page, 0)).toHaveText("Documents");
  await expect(location(page, 1)).toHaveText("user");
  await expect(
    page
      .locator(".file-manager")
      .nth(1)
      .getByRole("button", { name: "Back", exact: true }),
  ).toBeDisabled();

  await row(page, "notes.txt", 1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await row(page, "Projects", 1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await page
    .locator(".file-manager")
    .nth(0)
    .getByRole("button", { name: "Pinned items" })
    .click();
  const pinsMenu = page.getByRole("dialog", { name: "Pinned items" });
  await expect(pinsMenu.locator(".pin-open")).toHaveText([
    "notes.txt",
    "Projects",
  ]);
  await pinsMenu.getByRole("button", { name: "Move Projects up" }).click();
  await expect(pinsMenu.locator(".pin-open")).toHaveText([
    "Projects",
    "notes.txt",
  ]);
  await pinsMenu.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(location(page, 0)).toHaveText("Projects");
  await expect(location(page, 1)).toHaveText("user");

  // A pin whose target disappeared stays listed as missing until it is unpinned.
  await page.evaluate(() =>
    (window as any).__fm.nodes.delete("/home/user/notes.txt"),
  );
  await page.evaluate(async () => {
    const m = await import((window as any).__loaded("/src/services/pins.ts"));
    await m.pins.refresh();
  });
  await page
    .locator(".file-manager")
    .nth(1)
    .getByRole("button", { name: "Pinned items" })
    .click();
  await expect(pinsMenu.locator(".pin-missing")).toHaveText("Missing");
  await pinsMenu.getByRole("button", { name: "Unpin notes.txt" }).click();
  await expect(pinsMenu.locator(".pin-open")).toHaveText(["Projects"]);
});

test("paste conflicts require Replace, Keep Both or Skip", async ({ page }) => {
  await start(page);
  await row(page, "notes.txt").click();
  await page.keyboard.press("Control+c");
  await row(page, "Documents").dblclick();
  await page.locator(".fm-list").focus();
  await page.keyboard.press("Control+v");
  const dialog = page.getByRole("dialog", { name: "Item already exists" });
  await expect(dialog).toContainText(
    "Replace moves the existing file to the Trash",
  );
  await dialog.getByRole("button", { name: "Skip" }).click();
  await expect(row(page, "notes (2).txt")).toHaveCount(0);
  await page.keyboard.press("Control+v");
  await dialog.getByRole("button", { name: "Keep both" }).click();
  await expect(row(page, "notes (2).txt")).toHaveClass(/selected/);
  await page.keyboard.press("Control+v");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  const transfers = await page.evaluate(
    () => (window as any).__fm.calls.transfer,
  );
  expect(transfers).toHaveLength(2);
  expect(transfers[0].resolutions).toEqual({ "/home/user/notes.txt": "skip" });

  // Pasting into the item's own folder offers no Replace.
  await row(page, "notes (2).txt").click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(dialog).toContainText("is already in this folder");
  await expect(dialog.getByRole("button", { name: "Replace" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Keep both" }).click();
  await expect(row(page, "notes (3).txt")).toBeVisible();
});

test("delete uses the Trash and permanent delete needs confirmation", async ({
  page,
}) => {
  await start(page);
  await row(page, "notes.txt").click();
  await page.keyboard.press("Delete");
  await expect(row(page, "notes.txt")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__fm.calls.trash)).toEqual([
    ["/home/user/notes.txt"],
  ]);
  await row(page, "Projects").click();
  await page.keyboard.press("Shift+Delete");
  const confirm = page.getByRole("dialog", { name: "Delete permanently" });
  await expect(confirm).toContainText("cannot be undone");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(row(page, "Projects")).toBeVisible();
  // Focus returns to the list after the dialog closes.
  await expect(page.locator(".fm-list")).toBeFocused();
  await page.keyboard.press("Shift+Delete");
  await confirm.getByRole("button", { name: "Delete permanently" }).click();
  await expect(row(page, "Projects")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).__fm.calls.deletePermanently),
  ).toEqual([["/home/user/Projects"]]);
});

test("keyboard context menu, rename, create and open", async ({ page }) => {
  await start(page);
  await page.locator(".fm-list").focus();
  await page.keyboard.press("End");
  await expect(row(page, "old-link")).toHaveClass(/selected/);
  await page.keyboard.press("ArrowUp");
  await expect(row(page, "notes.txt")).toHaveClass(/selected/);
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu", { name: "File actions" });
  await expect(
    menu.getByRole("menuitem", { name: /^Open( Enter)?$/ }),
  ).toBeFocused();
  await expect(menu.getByRole("menuitem", { name: "Paste" })).toBeDisabled();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Cut" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".fm-list")).toBeFocused();

  // F2 renames in the row itself, as in a file explorer.
  await page.keyboard.press("F2");
  const name = page
    .getByRole("listbox", { name: "Folder contents" })
    .getByRole("textbox", { name: "Rename notes.txt" });
  expect(
    await name.evaluate((n: HTMLInputElement) => [
      n.selectionStart,
      n.selectionEnd,
    ]),
  ).toEqual([0, 5]);
  await page.keyboard.type("renamed");
  await page.keyboard.press("Enter");
  await expect(row(page, "renamed.txt")).toHaveClass(/selected/);
  // Without a Text Editor in the workspace, a text file opens in a new one beside.
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "renamed.txt" })).toBeVisible();
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  expect(
    await page.evaluate(() => (window as any).__fm.calls.open),
  ).toBeUndefined();
  await page.locator(".fm-list").click({ position: { x: 5, y: 5 } });

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  // A new folder is named in a row at the top of the list, without a dialog.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const folder = page
    .getByRole("listbox", { name: "Folder contents" })
    .getByRole("textbox", { name: "New folder name" });
  await expect(folder).toBeFocused();
  // A name in use keeps the field open with the reason.
  await folder.fill("Projects");
  await folder.press("Enter");
  await expect(page.locator(".inline-name-error")).toContainText(
    "already exists",
  );
  await folder.fill("Fresh");
  await folder.press("Enter");
  await expect(row(page, "Fresh")).toHaveClass(/selected/);
  await expect(folder).toHaveCount(0);

  // The right-click menu creates too; a file's name is typed with its extension.
  const list = page.getByRole("listbox", { name: "Folder contents" });
  const box = (await list.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: "New file" }).click();
  const file = page.getByRole("textbox", { name: "New file name" });
  await expect(file).toHaveValue("");
  // Escape leaves nothing behind.
  await file.press("Escape");
  await expect(file).toHaveCount(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: "New file" }).click();
  await file.fill("todo.md");
  await file.press("Enter");
  await expect(row(page, "todo.md")).toHaveClass(/selected/);
});

test("drag moves into folders and rejects a folder onto itself", async ({
  page,
}) => {
  await start(page);
  const drag = async (from: string, to: string) => {
    const a = await row(page, from).boundingBox();
    const b = await row(page, to).boundingBox();
    await page.mouse.move(a!.x + 30, a!.y + a!.height / 2);
    await page.mouse.down();
    await page.mouse.move(b!.x + 40, b!.y + b!.height / 2, { steps: 6 });
  };
  await drag("Projects", "Projects");
  await expect(page.locator(".fm-drag")).toHaveText(
    "Drop on a different folder",
  );
  await page.mouse.up();
  expect(
    await page.evaluate(() => (window as any).__fm.calls.transfer),
  ).toBeUndefined();
  await drag("notes.txt", "Projects");
  await expect(page.locator(".fm-drag")).toHaveText("Move 1 item");
  await expect(row(page, "Projects")).toHaveClass(/drop-ok/);
  await page.mouse.up();
  await expect(row(page, "notes.txt")).toHaveCount(0);
  await row(page, "Projects").dblclick();
  await expect(row(page, "notes.txt")).toBeVisible();
  // The drag gesture must not have started a workspace panel drag.
  await expect(page.locator("[data-panel]")).toHaveCount(1);
});

test("files open as tabs of the workspace's text editor, by double click or drag", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(() => {
    const { nodes } = (window as any).__fm;
    nodes.set("/home/user/photo.png", { kind: "file", size: 9, modified: 1 });
    nodes.set("/home/user/data.bin", { kind: "file", size: 9, modified: 1 });
    nodes.set("/home/user/todo.md", { kind: "file", size: 9, modified: 1 });
  });
  await page.keyboard.press("F5");
  // A Text Editor beside the File Manager: files join it as tabs.
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("text");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await row(page, "notes.txt").dblclick();
  await expect(page.getByRole("tab", { name: "notes.txt" })).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveText("text of notes.txt");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  // Media and files that are not text go to their default application.
  await row(page, "photo.png").dblclick();
  await row(page, "data.bin").dblclick();
  await expect
    .poll(() => page.evaluate(() => (window as any).__fm.calls.open))
    .toEqual(["/home/user/photo.png", "/home/user/data.bin"]);
  // A file dragged onto the editor opens there.
  const source = (await row(page, "todo.md").boundingBox())!;
  const editor = (await page.locator(".cm-editor").boundingBox())!;
  await page.mouse.move(source.x + 20, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(editor.x + 80, editor.y + 80, { steps: 6 });
  await expect(page.locator(".fm-drag")).toHaveText("Open 1 file here");
  await page.mouse.up();
  await expect(page.getByRole("tab", { name: "todo.md" })).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(3);
  // The editor's status bar shows the active file's path at its left.
  const status = page.getByRole("group", { name: "Text editor status" });
  await expect(status.locator(".editor-path")).toHaveText("/home/user/todo.md");
  await page.getByRole("tab", { name: "notes.txt" }).click();
  await expect(status.locator(".editor-path")).toHaveText(
    "/home/user/notes.txt",
  );
  // A folder is never opened in an editor.
  const folder = (await row(page, "Projects").boundingBox())!;
  await page.mouse.move(folder.x + 20, folder.y + 10);
  await page.mouse.down();
  await page.mouse.move(editor.x + 80, editor.y + 80, { steps: 6 });
  await expect(page.locator(".fm-drag")).toHaveText(
    "Only files open in an editor",
  );
  await page.mouse.up();
  await expect(page.getByRole("tab")).toHaveCount(3);
});

test("the context menu opens a folder in a terminal or in an IDE in a new window", async ({
  page,
}) => {
  await start(page);
  await page.evaluate(async () => {
    const windows = await import(
      (window as any).__loaded("/src/services/windows.ts")
    );
    const { calls } = (window as any).__fm;
    windows.windowBackend.open = async (ide: string | null) => {
      (calls.window ??= []).push(ide);
    };
  });
  // Without a Terminal, a right-clicked folder opens in a new one beside.
  await row(page, "Projects").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in Terminal" }).click();
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: /^Terminal/ })).toHaveCount(1);
  // The next one, from the folder shown, joins it as a tab.
  const list = page.getByRole("listbox", { name: "Folder contents" });
  const box = (await list.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, {
    button: "right",
  });
  await page.getByRole("menuitem", { name: "Open in Terminal" }).click();
  await expect(page.getByRole("tab", { name: /^Terminal/ })).toHaveCount(2);
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  // Open in IDE asks for a new window on the folder.
  await row(page, "Projects").click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Open in IDE (New Window)" })
    .click();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 10, {
    button: "right",
  });
  await page
    .getByRole("menuitem", { name: "Open in IDE (New Window)" })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__fm.calls.window))
    .toEqual(["/home/user/Projects", "/home/user"]);
});
