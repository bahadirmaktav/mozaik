import { test, expect, type Page } from "@playwright/test";

const EMPTY = { type: "excalidraw", version: 2, elements: [], files: {} };
const rectangle = {
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [
    {
      id: "box",
      type: "rectangle",
      x: 100,
      y: 100,
      width: 120,
      height: 80,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
};

// Browser runs have no native backend. This replaces the typed drawings adapter with
// in-memory files that follow the Rust rules (revision checks, open registry), so it
// covers the module and Excalidraw itself, not native dialogs or disk writes.
async function installFakeBackend(page: Page, files: Record<string, object>) {
  await page.evaluate(async (seed) => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const module = await import(loaded("/src/services/drawings.ts"));
    let revision = 0;
    const disk = new Map<string, { text: string; revision: string }>();
    for (const [path, data] of Object.entries(seed))
      disk.set(path, {
        text: JSON.stringify(data),
        revision: `r${revision++}`,
      });
    const fake = {
      disk,
      saves: [] as Record<string, unknown>[],
      exports: [] as { name: string; extension: string; size: number }[],
      /** Destination a Save As or open dialog picks; `null` cancels. */
      pick: null as string | null,
      pending: [] as string[],
    };
    (window as any).__drawings = fake;
    const data = (path: string) => {
      const file = disk.get(path);
      if (!file) throw new Error("File is missing or inaccessible");
      return {
        path,
        name: path.split("/").pop(),
        text: file.text,
        revision: file.revision,
        bom: false,
        ending: "lf",
      };
    };
    const b = module.drawingsBackend;
    b.open = async (path: string | null) => {
      const target = path ?? fake.pick;
      return target ? { kind: "opened", file: data(target) } : null;
    };
    b.save = async (request: any) => {
      fake.saves.push(request);
      const path = request.path ?? fake.pick;
      if (!path) return { kind: "cancelled" };
      const current = disk.get(path);
      if (request.path && current?.revision !== request.revision)
        return { kind: "conflict", message: "The file changed on disk." };
      disk.set(path, { text: request.text, revision: `r${revision++}` });
      return { kind: "saved", file: data(path) };
    };
    b.check = async (path: string, known: string | null) => {
      const file = data(path);
      return file.revision === known ? null : file;
    };
    b.read = async (path: string) => data(path);
    b.setOpen = async () => {};
    b.takePending = async () => fake.pending.splice(0);
    b.closeWindow = async () => {};
    b.export = async (blob: Blob, name: string, extension: string) => {
      // A native save dialog is never instant; Excalidraw disables its button after 50 ms.
      await new Promise((resolve) => setTimeout(resolve, 100));
      fake.exports.push({ name, extension, size: blob.size });
      return `/exports/${name}`;
    };
  }, files);
}
async function launch(
  page: Page,
  mode: "Enter" | "Control+Enter" | "Control+Shift+Enter" = "Enter",
) {
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("excalidraw");
  await page.keyboard.press(mode);
}
async function start(page: Page, files: Record<string, object> = {}) {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await installFakeBackend(page, files);
}
const fake = (page: Page) => page.evaluate(() => (window as any).__drawings);
/** Elements in the latest serialized scene of the drawing in the given tab. */
async function sceneOf(page: Page, title: string) {
  return page.evaluate(async (title) => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const store = await import(loaded("/src/plugins/excalidraw/drawings.ts"));
    const drawing = store.allDrawings().find((d: any) => d.name === title);
    const text = drawing.text ?? drawing.saved;
    return text
      ? JSON.parse(text).elements.filter((e: any) => !e.isDeleted)
      : [];
  }, title);
}
const canvas = (page: Page, index = 0) =>
  page.locator(".excalidraw .excalidraw__canvas.interactive").nth(index);
/** Clicks an empty spot away from Excalidraw's menus and toolbar. */
async function focusCanvas(page: Page, index = 0) {
  const box = (await canvas(page, index).boundingBox())!;
  await canvas(page, index).click({
    position: { x: box.width - 40, y: box.height / 2 },
  });
}
async function drawRectangle(page: Page, index = 0, at = 0) {
  const box = (await canvas(page, index).boundingBox())!;
  await focusCanvas(page, index);
  await page.keyboard.press("r");
  const x = box.x + box.width / 2 - 60 + at / 2,
    y = box.y + box.height / 2 - 80 + at / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 60, { steps: 5 });
  await page.mouse.up();
}
const tab = (page: Page, name: string | RegExp) =>
  page.getByRole("tab", { name, exact: true });
/** The active tool of every visible drawing. */
const tools = (page: Page) =>
  page
    .locator('.excalidraw input[name="editor-current-shape"]:checked')
    .evaluateAll((inputs) => inputs.map((i) => i.getAttribute("aria-label")));

test("a new drawing opens as Untitled without a dialog, and names stay distinct", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1"].includes(url.hostname))
      external.push(url.origin);
  });
  await start(page);
  await launch(page);
  await expect(canvas(page)).toBeVisible();
  await expect(tab(page, "Untitled")).toBeVisible();
  await expect(page.locator(".excalidraw.theme--dark")).toBeVisible();
  await launch(page, "Control+Enter");
  await expect(tab(page, "Untitled 2")).toBeVisible();
  expect((await fake(page)).saves).toEqual([]);
  // Excalidraw's own UI is intact: its toolbar and shortcuts.
  await focusCanvas(page);
  await page.keyboard.press("r");
  await expect(
    page
      .locator(".excalidraw")
      .first()
      .getByRole("radio", {
        name: /Rectangle/,
      }),
  ).toBeChecked();
  await page.waitForTimeout(500);
  expect(
    await page.evaluate(() => document.fonts.check("20px Excalifont")),
  ).toBe(true);
  expect(external).toEqual([]);
});

/** Reads a file of the fake disk. */
const diskScene = (page: Page, path: string) =>
  page.evaluate((path) => {
    const file = (window as any).__drawings.disk.get(path);
    return file
      ? {
          revision: file.revision as string,
          elements: JSON.parse(file.text).elements.filter(
            (e: any) => !e.isDeleted,
          ).length as number,
        }
      : null;
  }, path);
const pick = (page: Page, path: string | null) =>
  page.evaluate((path) => ((window as any).__drawings.pick = path), path);
async function withStore(page: Page, work: string, arg?: unknown) {
  return page.evaluate(
    async ([work, arg]) => {
      const loaded = (path: string) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === path) ?? path;
      const store = await import(loaded("/src/plugins/excalidraw/drawings.ts"));
      return new Function("store", "arg", `return (${work})(store, arg)`)(
        store,
        arg,
      );
    },
    [work, arg] as const,
  );
}

test("the first save asks for a file, a cancelled Save As keeps the drawing, then edits autosave", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  await drawRectangle(page);
  await expect(tab(page, "Untitled •")).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await fake(page)).saves.length).toBe(1);
  expect((await fake(page)).saves[0]).toMatchObject({ path: null });
  await expect(tab(page, "Untitled •")).toBeVisible();
  expect(await sceneOf(page, "Untitled")).toHaveLength(1);

  await pick(page, "/d/plan.excalidraw");
  await page.keyboard.press("Control+s");
  await expect(tab(page, "plan.excalidraw")).toBeVisible();
  expect(await diskScene(page, "/d/plan.excalidraw")).toMatchObject({
    elements: 1,
  });

  await drawRectangle(page, 0, 100);
  await expect(tab(page, "plan.excalidraw •")).toBeVisible();
  // Autosave writes once after the pause, to the same file with its revision.
  await expect(tab(page, "plan.excalidraw")).toBeVisible({ timeout: 5000 });
  expect(await diskScene(page, "/d/plan.excalidraw")).toMatchObject({
    elements: 2,
  });
  const saves = (await fake(page)).saves;
  expect(saves).toHaveLength(3);
  expect(saves[2]).toMatchObject({ path: "/d/plan.excalidraw" });

  // Ctrl+Shift+S always asks for a destination and moves the drawing there.
  await pick(page, "/d/copy.excalidraw");
  await page.keyboard.press("Control+Shift+S");
  await expect(tab(page, "copy.excalidraw")).toBeVisible();
  expect((await fake(page)).saves.at(-1)).toMatchObject({
    path: null,
    current: "/d/plan.excalidraw",
  });
});

test("an open drawing is focused instead of opened twice, and File Manager opens drawings", async ({
  page,
}) => {
  await start(page, { "/d/box.excalidraw": rectangle });
  await launch(page);
  await expect(canvas(page)).toBeVisible();
  await pick(page, "/d/box.excalidraw");
  // Ctrl+O in a drawing opens a drawing, through Mozaik.
  await focusCanvas(page);
  await page.keyboard.press("Control+o");
  await expect(tab(page, "box.excalidraw")).toBeVisible();
  expect(await sceneOf(page, "box.excalidraw")).toHaveLength(1);
  await tab(page, "Untitled").click();
  await page.locator(".excalidraw .dropdown-menu-button").first().click();
  await page.getByRole("button", { name: "Open… Ctrl+O" }).click();
  await expect(tab(page, "box.excalidraw")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab")).toHaveCount(2);
  // The File Manager hands .excalidraw files to the same flow.
  await tab(page, "Untitled").click();
  await withStore(page, "(store) => store.requestOpen('/d/box.excalidraw')");
  await expect(tab(page, "box.excalidraw")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab")).toHaveCount(2);
});

test("two drawings keep separate scenes and undo, and other modules never get drawing keys", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  await launch(page);
  await expect(canvas(page, 1)).toBeVisible();
  await drawRectangle(page, 0);
  await drawRectangle(page, 1);
  await drawRectangle(page, 1, 100);
  await expect.poll(() => sceneOf(page, "Untitled 2")).toHaveLength(2);
  await page.keyboard.press("Control+z");
  await expect.poll(() => sceneOf(page, "Untitled 2")).toHaveLength(1);
  expect(await sceneOf(page, "Untitled")).toHaveLength(1);

  // A Text Editor next to the drawings receives its own keys only.
  const before = await tools(page);
  await page.keyboard.press("Control+Shift+N");
  await page.locator(".cm-content").click();
  await page.keyboard.type("r1 ");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Control+a");
  await expect(page.locator(".cm-content")).toHaveText("r1 ");
  await page.waitForTimeout(500);
  expect(await sceneOf(page, "Untitled")).toHaveLength(1);
  expect(await sceneOf(page, "Untitled 2")).toHaveLength(1);
  expect(await tools(page)).toEqual(before);
});

test("closing an unsaved drawing asks Save, Discard or Cancel", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  await drawRectangle(page);
  await expect(tab(page, "Untitled •")).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Unsaved changes" });
  await page.keyboard.press("Control+w");
  await expect(dialog).toContainText("Save changes to Untitled?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(tab(page, "Untitled •")).toBeVisible();
  // Save opens Save As; cancelling it keeps the drawing open.
  await page.keyboard.press("Control+w");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(tab(page, "Untitled •")).toBeVisible();
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Control+w");
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("Excalidraw reopens the last session's drawing; external changes reload or conflict", async ({
  page,
}) => {
  await start(page, { "/d/box.excalidraw": EMPTY });
  await page.evaluate(
    () => ((window as any).__drawings.pending = ["/d/box.excalidraw"]),
  );
  await launch(page);
  await expect(tab(page, "box.excalidraw")).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(1);
  // Only once per session: the next Excalidraw is a new drawing.
  await launch(page, "Control+Enter");
  await expect(tab(page, "Untitled")).toBeVisible();
  await tab(page, "box.excalidraw").click();

  const check = () =>
    withStore(
      page,
      "async (store) => { for (const d of store.allDrawings()) await store.checkDrawing(d.id); }",
    );
  await page.evaluate(
    (text) =>
      (window as any).__drawings.disk.set("/d/box.excalidraw", {
        text,
        revision: "external",
      }),
    JSON.stringify(rectangle),
  );
  await check();
  await expect.poll(() => sceneOf(page, "box.excalidraw")).toHaveLength(1);
  await expect(tab(page, "box.excalidraw")).toBeVisible();

  await drawRectangle(page, 0, 150);
  await page.evaluate(() =>
    (window as any).__drawings.disk.set("/d/box.excalidraw", {
      text: '{"type":"excalidraw","elements":[]}',
      revision: "external-2",
    }),
  );
  await check();
  await expect(page.locator(".drawing-alert")).toContainText("changed on disk");
  await page.waitForTimeout(1500);
  // Neither the autosave nor anything else overwrote the external version.
  expect(await diskScene(page, "/d/box.excalidraw")).toEqual({
    revision: "external-2",
    elements: 0,
  });
  expect(await sceneOf(page, "box.excalidraw")).toHaveLength(2);
});

test("PNG and SVG export go through Mozaik and leave the drawing unchanged", async ({
  page,
}) => {
  await start(page, { "/d/box.excalidraw": rectangle });
  await page.evaluate(
    () => ((window as any).__drawings.pending = ["/d/box.excalidraw"]),
  );
  await launch(page);
  await expect(tab(page, "box.excalidraw")).toBeVisible();
  const before = await diskScene(page, "/d/box.excalidraw");
  for (const [index, format] of ["PNG", "SVG"].entries()) {
    await focusCanvas(page);
    await page.keyboard.press("Control+Shift+E");
    const dialog = page.locator(".ImageExportModal");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: `Export to ${format}` }).click();
    await expect
      .poll(async () => (await fake(page)).exports.length)
      .toBe(index + 1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
  const { exports, saves } = await fake(page);
  expect(exports.map((e: any) => [e.name, e.extension])).toEqual([
    ["box.png", "png"],
    ["box.svg", "svg"],
  ]);
  expect(exports.every((e: any) => e.size > 0)).toBe(true);
  expect(saves).toEqual([]);
  expect(await diskScene(page, "/d/box.excalidraw")).toEqual(before);
  await expect(tab(page, "box.excalidraw")).toBeVisible();
});

test("a dropped image is saved inside the drawing and comes back when it is reopened", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  const box = (await canvas(page).boundingBox())!;
  // The OS drop handler reads the file natively; this hands the same File to Excalidraw.
  await page.evaluate(
    async ([x, y]) => {
      const loaded = (path: string) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === path) ?? path;
      const store = await import(loaded("/src/plugins/excalidraw/drawings.ts"));
      const runtime = await import(
        loaded("/src/plugins/excalidraw/runtime.tsx")
      );
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 40;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#c4554a";
      context.fillRect(0, 0, 40, 40);
      const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!)));
      const id = store.allDrawings()[0].id;
      runtime.dropFiles(
        id,
        [new File([blob], "red.png", { type: "image/png" })],
        x,
        y,
      );
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  await expect
    .poll(async () => (await sceneOf(page, "Untitled")).map((e: any) => e.type))
    .toEqual(["image"]);
  await pick(page, "/d/image.excalidraw");
  await page.keyboard.press("Control+s");
  await expect(tab(page, "image.excalidraw")).toBeVisible();
  const text = await page.evaluate(
    () => (window as any).__drawings.disk.get("/d/image.excalidraw").text,
  );
  const saved = JSON.parse(text);
  const fileId = saved.elements[0].fileId;
  expect(saved.files[fileId].dataURL).toMatch(/^data:image\/png;base64,/);

  // A new session opens the file with the image data intact.
  await start(page, { "/d/image.excalidraw": saved });
  await page.evaluate(
    () => ((window as any).__drawings.pending = ["/d/image.excalidraw"]),
  );
  await launch(page);
  await expect(tab(page, "image.excalidraw")).toBeVisible();
  await focusCanvas(page);
  await drawRectangle(page);
  await expect
    .poll(async () => {
      const text = await page.evaluate(
        () => (window as any).__drawings.disk.get("/d/image.excalidraw").text,
      );
      const data = JSON.parse(text);
      return [data.elements.length, !!data.files[fileId]?.dataURL];
    })
    .toEqual([2, true]);
});

test("a drawing keeps its scene and undo history across tab switches", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  await drawRectangle(page);
  await drawRectangle(page, 0, 120);
  await expect.poll(() => sceneOf(page, "Untitled")).toHaveLength(2);
  await page.keyboard.press("Control+n");
  await expect(page.locator(".cm-content")).toBeVisible();
  await tab(page, "Untitled •").click();
  await expect(canvas(page)).toBeVisible();
  await focusCanvas(page);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect.poll(() => sceneOf(page, "Untitled")).toHaveLength(1);
});

test("a moved floating drawing still draws under the pointer", async ({
  page,
}) => {
  await start(page);
  await launch(page, "Control+Shift+Enter");
  const floating = page.locator(".panel.floating");
  await expect(floating).toHaveCount(1);
  /** A rectangle from a point given from the canvas corner. */
  const draw = async (x: number, y: number) => {
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 80, box.y + y + 60, { steps: 5 });
    await page.mouse.up();
  };
  await focusCanvas(page);
  await page.keyboard.press("r");
  await draw(200, 150);
  await expect.poll(() => sceneOf(page, "Untitled")).toHaveLength(1);
  const size = (await canvas(page).boundingBox())!;
  // A moved panel may keep its size, so Excalidraw would not measure its canvas again.
  const grip = floating.getByRole("button", { name: "Move panel" });
  const g = (await grip.boundingBox())!;
  const [cx, cy] = [g.x + g.width / 2, g.y + g.height / 2];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy + 30, { steps: 4 });
  await page.mouse.up();
  expect((await canvas(page).boundingBox())!.width).toBe(size.width);
  await focusCanvas(page);
  await page.keyboard.press("r");
  await draw(230, 180);
  await expect.poll(() => sceneOf(page, "Untitled")).toHaveLength(2);
  const [first, second] = await sceneOf(page, "Untitled");
  expect(Math.round(second.x - first.x)).toBe(30);
  expect(Math.round(second.y - first.y)).toBe(30);
});
