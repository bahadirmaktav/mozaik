import { test, expect, type Page } from "@playwright/test";

// Browser runs have no native backend. This replaces the typed drawings adapter with
// in-memory files that follow the Rust rules (revision checks, per-kind session list), so it
// covers the module and Mermaid rendering, not native dialogs or disk writes.
async function start(page: Page, files: Record<string, string> = {}) {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.evaluate(async (seed) => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const module = await import(loaded("/src/services/drawings.ts"));
    let revision = 0;
    const disk = new Map<string, { text: string; revision: string }>();
    for (const [path, text] of Object.entries(seed))
      disk.set(path, { text, revision: `r${revision++}` });
    const fake = {
      disk,
      saves: [] as Record<string, unknown>[],
      exports: [] as { name: string; extension: string; size: number }[],
      kinds: [] as string[],
      pick: null as string | null,
      pending: { mermaid: [] as string[], excalidraw: [] as string[] },
    };
    (window as any).__diagrams = fake;
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
    b.open = async (path: string | null, kind: string) => {
      fake.kinds.push(kind);
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
    b.takePending = async (kind: "mermaid" | "excalidraw") =>
      fake.pending[kind].splice(0);
    b.closeWindow = async () => {};
    b.export = async (blob: Blob, name: string, extension: string) => {
      fake.exports.push({ name, extension, size: blob.size });
      return `/exports/${name}`;
    };
  }, files);
}
const fake = (page: Page) => page.evaluate(() => (window as any).__diagrams);
async function launch(page: Page, mode: "Enter" | "Control+Enter" = "Enter") {
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("mermaid");
  await page.keyboard.press(mode);
  await expect(source(page)).toBeVisible();
}
const source = (page: Page) =>
  page.getByRole("textbox", { name: "Mermaid source" }).last();
const preview = (page: Page) =>
  page.getByLabel("Diagram preview").last().locator(".diagram-svg");
async function replace(page: Page, text: string) {
  await source(page).click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(text);
}
/** Runs a function of the Mermaid store in the page. */
async function withStore<T>(page: Page, fn: string, arg?: unknown): Promise<T> {
  return page.evaluate(
    async ({ fn, arg }) => {
      const loaded = (path: string) =>
        performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .find((url) => new URL(url).pathname === path) ?? path;
      const { diagramFiles } = await import(
        loaded("/src/plugins/mermaid/diagrams.ts")
      );
      return new Function("files", "arg", `return (${fn})(files, arg)`)(
        diagramFiles,
        arg,
      );
    },
    { fn, arg },
  );
}
async function menu(page: Page, item: string | RegExp) {
  await page.getByRole("button", { name: "Diagram actions" }).last().click();
  await page.getByRole("menuitem", { name: item }).click();
}

test("Mermaid opens as source and live preview with a resizable split", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await launch(page);
  await expect(page.getByRole("tab", { name: "Untitled" })).toBeVisible();
  await expect(preview(page).locator("svg")).toBeVisible();
  const code = await source(page).boundingBox(),
    view = await page.getByLabel("Diagram preview").boundingBox();
  expect(code!.x).toBeLessThan(view!.x);

  await replace(
    page,
    "sequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi",
  );
  await expect(preview(page)).toContainText("Alice");
  await replace(
    page,
    "classDiagram\n  class Animal {\n    +name: string\n    +speak()\n  }\n  Animal <|-- Dog",
  );
  await expect(preview(page)).toContainText("Animal");
  await replace(page, "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy");
  await expect(preview(page)).toContainText("Busy");

  const splitter = page.getByRole("separator", {
    name: "Resize source and preview",
  });
  const before = (await page.locator(".diagram-source").boundingBox())!.width;
  const bar = (await splitter.boundingBox())!;
  await page.mouse.move(bar.x + 2, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(bar.x - 150, bar.y + bar.height / 2, { steps: 5 });
  await page.mouse.up();
  const after = (await page.locator(".diagram-source").boundingBox())!.width;
  expect(before - after).toBeGreaterThan(100);
  await splitter.focus();
  await page.keyboard.press("ArrowRight");
  expect(
    (await page.locator(".diagram-source").boundingBox())!.width,
  ).toBeGreaterThan(after);
  // Far past the edge still leaves both panes usable.
  await page.mouse.move(bar.x - 150, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(0, bar.y + bar.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(
    (await page.locator(".diagram-source").boundingBox())!.width,
  ).toBeGreaterThanOrEqual(119);
  expect(errors).toEqual([]);
});

test("a syntax error keeps the text and the last good diagram, marked outdated", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  await replace(page, "flowchart LR\n  A[First] --> B[Second]");
  await expect(preview(page)).toContainText("Second");
  await replace(page, "flowchart LR\n  A[First] --> -->");
  const error = page.getByRole("alert").filter({ hasText: "Syntax error" });
  await expect(error).toBeVisible();
  await expect(source(page)).toContainText("A[First] --> -->");
  await expect(preview(page)).toHaveClass(/stale/);
  await expect(preview(page)).toContainText("Second");
  // Exports are refused while the preview is outdated.
  await page.getByRole("button", { name: "Diagram actions" }).click();
  await expect(
    page.getByRole("menuitem", { name: "Export SVG…" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await replace(page, "flowchart LR\n  A[First] --> C[Third]");
  await expect(error).toHaveCount(0);
  await expect(preview(page)).not.toHaveClass(/stale/);
  await expect(preview(page)).toContainText("Third");
});

test("the latest source wins when renders finish out of order", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  // Type quickly through several versions; only the last one may end up shown.
  await source(page).click();
  await page.keyboard.press("Control+a");
  for (let n = 1; n <= 6; n++) {
    await page.keyboard.insertText(`flowchart LR\n  A --> N${n}[Step ${n}]`);
    await page.keyboard.press("Control+a");
  }
  await page.keyboard.press("End");
  await expect(preview(page)).toContainText("Step 6");
  await page.waitForTimeout(800);
  await expect(preview(page)).toContainText("Step 6");
  await expect(preview(page)).not.toContainText("Step 5");
});

test("untrusted diagrams cannot run scripts or load content", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost")) requests.push(r.url());
  });
  await start(page);
  await launch(page);
  await page.evaluate(() => ((window as any).__pwned = false));
  await replace(
    page,
    [
      "flowchart LR",
      '  A["<img src=x onerror=window.__pwned=true>"] --> B["<script>window.__pwned=true</script>"]',
      '  click A call alert("x")',
      '  click B "javascript:window.__pwned=true"',
      "  C[https://example.com/image.png]",
    ].join("\n"),
  );
  await expect(preview(page).locator("svg")).toBeVisible();
  await page.waitForTimeout(500);
  await preview(page)
    .locator("svg")
    .click({ position: { x: 5, y: 5 } });
  expect(await page.evaluate(() => (window as any).__pwned)).toBe(false);
  await expect(preview(page).locator("img, script, foreignObject")).toHaveCount(
    0,
  );
  await expect(preview(page).locator("[onerror], [onclick]")).toHaveCount(0);
  // A directive cannot lower the security level.
  await replace(
    page,
    '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n  A --> B\n  click A call alert("x")',
  );
  await expect(preview(page).locator("svg")).toBeVisible();
  await expect(preview(page).locator("[onclick]")).toHaveCount(0);
  expect(requests).toEqual([]);
});

test("Untitled is saved through Save As, then autosaves; Save As never writes the old file", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  await replace(page, "flowchart LR\n  A --> B");
  await expect(page.getByRole("tab", { name: "Untitled •" })).toBeVisible();
  // Nothing is written until a destination is chosen.
  await page.waitForTimeout(1300);
  expect((await fake(page)).saves).toEqual([]);
  // A cancelled dialog keeps the diagram.
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await fake(page)).saves.length).toBe(1);
  await expect(page.getByRole("tab", { name: "Untitled •" })).toBeVisible();
  await page.evaluate(() => ((window as any).__diagrams.pick = "/d/flow.mmd"));
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("tab", { name: "flow.mmd" })).toBeVisible();
  let state = await fake(page);
  expect(state.saves[1]).toMatchObject({
    kind: "mermaid",
    path: null,
    name: "Untitled",
  });
  expect(state.disk["/d/flow.mmd"]).toBeUndefined();
  const disk = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...(window as any).__diagrams.disk].map(([p, f]: any) => [p, f.text]),
      ),
    );
  expect((await disk())["/d/flow.mmd"]).toBe("flowchart LR\n  A --> B");
  await source(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n  B --> C");
  await expect
    .poll(async () => (await disk())["/d/flow.mmd"])
    .toBe("flowchart LR\n  A --> B\n  B --> C");
  await expect(page.getByRole("tab", { name: "flow.mmd" })).not.toContainText(
    "•",
  );
  await page.evaluate(() => ((window as any).__diagrams.pick = "/d/copy.mmd"));
  await page.keyboard.press("Control+Shift+s");
  await expect(page.getByRole("tab", { name: "copy.mmd" })).toBeVisible();
  await source(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n  C --> D");
  await expect
    .poll(async () => (await disk())["/d/copy.mmd"])
    .toContain("C --> D");
  expect((await disk())["/d/flow.mmd"]).not.toContain("C --> D");
  state = await fake(page);
  expect(state.saves.every((s: any) => s.kind === "mermaid")).toBe(true);
});

test("open focuses an already open file; different files get their own tabs", async ({
  page,
}) => {
  await start(page, {
    "/d/a.mmd": "flowchart LR\n  A1 --> A2",
    "/d/b.mmd": "flowchart LR\n  B1 --> B2",
  });
  await launch(page);
  await page.evaluate(() => ((window as any).__diagrams.pick = "/d/a.mmd"));
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("tab", { name: "a.mmd" })).toBeVisible();
  await expect(preview(page)).toContainText("A2");
  await page.evaluate(() => ((window as any).__diagrams.pick = "/d/b.mmd"));
  await menu(page, "Open…");
  await expect(page.getByRole("tab", { name: "b.mmd" })).toBeVisible();
  await page.evaluate(() => ((window as any).__diagrams.pick = "/d/a.mmd"));
  await page.keyboard.press("Control+o");
  await expect(page.getByRole("tab", { name: "a.mmd" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "a.mmd" })).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(3);
  expect((await fake(page)).kinds.every((k: string) => k === "mermaid")).toBe(
    true,
  );
  // Through the File Manager path (the module opener) the same file is focused too.
  await withStore(page, "(files) => files.requestOpen('/d/b.mmd')");
  await expect(page.getByRole("tab", { name: "b.mmd" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab")).toHaveCount(3);
});

test("SVG and PNG exports leave the diagram file untouched", async ({
  page,
}) => {
  await start(page, { "/d/flow.mmd": "flowchart LR\n  Start --> Stop" });
  await launch(page);
  await page.evaluate(() => ((window as any).__diagrams.pick = "/d/flow.mmd"));
  await page.keyboard.press("Control+o");
  await expect(preview(page)).toContainText("Stop");
  await menu(page, "Export SVG…");
  await menu(page, "Export PNG…");
  await expect.poll(async () => (await fake(page)).exports.length).toBe(2);
  const state = await fake(page);
  expect(state.exports[0]).toMatchObject({
    name: "flow.svg",
    extension: "svg",
  });
  expect(state.exports[1]).toMatchObject({
    name: "flow.png",
    extension: "png",
  });
  expect(state.exports[1].size).toBeGreaterThan(1000);
  expect(state.saves).toEqual([]);
  await expect(page.getByRole("tab", { name: "flow.mmd" })).not.toContainText(
    "•",
  );
});

test("the previous session's diagrams reopen with the first Mermaid", async ({
  page,
}) => {
  await start(page, {
    "/d/a.mmd": "flowchart LR\n  A1 --> A2",
    "/d/b.mmd": "flowchart LR\n  B1 --> B2",
  });
  await page.evaluate(
    () =>
      ((window as any).__diagrams.pending.mermaid = ["/d/a.mmd", "/d/b.mmd"]),
  );
  // The window itself starts empty.
  await expect(page.locator("[data-panel]")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("mermaid");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "a.mmd" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "b.mmd" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Untitled" })).toHaveCount(0);
  // Later Mermaid tabs are new diagrams.
  await launch(page, "Control+Enter");
  await expect(page.getByRole("tab", { name: "Untitled" })).toBeVisible();
});

test("closing an unsaved diagram asks; a disk change reloads or conflicts", async ({
  page,
}) => {
  await start(page, { "/d/flow.mmd": "flowchart LR\n  A --> B" });
  await launch(page);
  await replace(page, "flowchart LR\n  X --> Y");
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(dialog).toContainText("Save changes to Untitled?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(source(page)).toContainText("X --> Y");
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.locator("[data-panel]")).toHaveCount(0);

  await launch(page);
  await page.evaluate(() => ((window as any).__diagrams.pick = "/d/flow.mmd"));
  await page.keyboard.press("Control+o");
  await expect(preview(page)).toContainText("B");
  const external = (text: string) =>
    page.evaluate((text) => {
      const disk = (window as any).__diagrams.disk;
      disk.set("/d/flow.mmd", { text, revision: `ext-${text.length}` });
    }, text);
  const check = () =>
    withStore(
      page,
      "async (files) => { for (const d of files.all()) if (d.path) await files.check(d.id); }",
    );
  await external("flowchart LR\n  A --> Changed");
  await check();
  await expect(source(page)).toContainText("Changed");
  await expect(preview(page)).toContainText("Changed");
  // A local edit is never replaced by the disk version.
  await source(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("\n  Changed --> Local");
  await external("flowchart LR\n  A --> Other");
  await check();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed on disk" }),
  ).toBeVisible();
  await expect(source(page)).toContainText("Local");
});

test("Ctrl+wheel zooms a diagram at the pointer and a drag moves it", async ({
  page,
}) => {
  await start(page);
  await launch(page);
  const view = page.getByLabel("Diagram preview").locator(".pan-zoom");
  const content = view.locator(".pan-zoom-content");
  await expect(preview(page).locator("svg")).toBeVisible();
  const box = (await view.boundingBox())!;
  const before = (await content.boundingBox())!;
  const percent = view.locator(".pan-zoom-level");
  const start100 = await percent.textContent();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await expect(percent).not.toHaveText(start100!);
  const zoomed = (await content.boundingBox())!;
  expect(zoomed.width).toBeGreaterThan(before.width);

  // A wheel without Ctrl does not change the scale.
  const scale = await percent.textContent();
  await page.mouse.wheel(0, 40);
  await expect(percent).toHaveText(scale!);

  const moved = (await content.boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 40,
    box.y + box.height / 2 + 25,
  );
  await page.mouse.up();
  const dragged = (await content.boundingBox())!;
  expect(dragged.x - moved.x).toBeCloseTo(40, 0);
  expect(dragged.y - moved.y).toBeCloseTo(25, 0);

  // Editing the source keeps the place the user chose.
  await replace(page, "flowchart LR\n  A --> Next");
  await expect(preview(page)).toContainText("Next");
  await expect(percent).toHaveText(scale!);

  // The percentage fits it again.
  await percent.click();
  await expect(percent).not.toHaveText(scale!);
});
