import { test, expect, type Page } from "@playwright/test";
async function add(page: Page, mode: "tab" | "split" = "tab") {
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("text");
  await page.keyboard.press(mode === "tab" ? "Control+Enter" : "Enter");
  await expect(page.locator(".cm-editor").last()).toBeVisible();
}
/** New File (Ctrl+N, or Ctrl+Shift+N beside): an Untitled tab, unlike an added Text Editor. */
async function newFile(page: Page, mode: "tab" | "split" = "tab") {
  await expect(page.locator(".titlebar")).toBeVisible();
  const tabs = await page.getByRole("tab").count();
  await page.keyboard.press(mode === "tab" ? "Control+n" : "Control+Shift+n");
  await expect(page.getByRole("tab")).toHaveCount(tabs + 1);
}
test("launcher searches tools and adds the selection as split or tab", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.keyboard.press("Control+Shift+Quote");
  const launcher = page.getByRole("dialog", { name: "Add to workspace" });
  await expect(launcher.getByRole("button")).toHaveCount(0);
  await page.keyboard.type("zzz");
  await expect(launcher.getByRole("option")).toHaveCount(0);
  await expect(launcher).toContainText("No tools found");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(launcher).toHaveCount(0);
  await add(page);
  // A Text Editor of its own is a page to write on, without a tab, as in Sublime Text.
  await expect(page.getByRole("tab")).toHaveCount(0);
  // Its header still has a close button, which closes the panel.
  await page.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(page.locator("[data-panel]")).toHaveCount(0);
  await add(page);
  await add(page, "split");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  // Added among tabs it is an Untitled tab, here in place of the page.
  await add(page);
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await expect(page.getByRole("tab")).toHaveText([/Untitled/]);
  // Typing on a page gives it its Untitled tab, which stays.
  await page.locator(".cm-content").first().click();
  await page.keyboard.type("x");
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("tab")).toHaveCount(2);
  // Ctrl+Shift+C closes the focused panel with all its tabs.
  await page.keyboard.press("Control+Shift+C");
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(1);
  // Window controls are gone; only the drag strip is left above the panels.
  await expect(page.getByRole("button", { name: /window/i })).toHaveCount(0);
});
test("the command palette opens with its keys, filters commands and runs them on the focused tool", async ({
  page,
}) => {
  await page.goto("/");
  // No title bar field: only the shortcut opens it, with `>` for commands.
  await expect(
    page.getByRole("button", { name: "Open command palette" }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+Shift+p");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(
    palette.getByRole("combobox", { name: "Type a command" }),
  ).toHaveValue(">");
  await page.keyboard.type("zzz");
  await expect(palette).toContainText("No matching commands");
  // The IDE's commands are listed only while an IDE is in the workspace.
  await page.keyboard.press("Control+a");
  await page.keyboard.type(">debug");
  await expect(palette).toContainText("No matching commands");
  await page.keyboard.press("Control+a");
  await page.keyboard.type(">show problems");
  await expect(palette).toContainText("No matching commands");
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("new file");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);

  await page.locator(".cm-content").fill("typed");
  await page.keyboard.press("Control+Shift+p");
  await palette.getByRole("option", { name: /Close Tab/ }).click();
  // The command acted on the editor that had focus: its unsaved text asks first.
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  // The panel stays, a page to write on.
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator("[data-panel]")).toHaveCount(1);

  // A command per module adds it, as the launcher does; settings are a command too.
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("add text editor");
  await expect(palette.getByRole("option")).toHaveText([
    "Add to Workspace: Text Editor",
  ]);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("settings");
  await palette.getByRole("option", { name: /Workspace Settings/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Workspace settings" }),
  ).toBeVisible();
});
test("the palette lists recent commands first, then the rest alphabetically, and scrolls with the arrows", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".empty")).toContainText(
    /^A little space to think\.Press Ctrl\+Shift\+P for commands\.$/,
  );
  await page.keyboard.press("Control+Shift+p");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const options = palette.getByRole("option");
  const labels = await options.locator("span:first-child").allTextContents();
  expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  // Up from the first entry wraps to the last, which scrolls into view.
  await page.keyboard.press("ArrowUp");
  await expect(options.last()).toHaveAttribute("aria-selected", "true");
  await expect(options.last()).toBeInViewport();
  await expect(options.first()).not.toBeInViewport();
  await page.keyboard.press("ArrowDown");
  await expect(options.first()).toBeInViewport();
  await page.keyboard.type("new file");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);

  await page.keyboard.press("Control+Shift+p");
  await expect(options.first()).toContainText("New File");
  await expect(options.first()).toContainText("recently used");
  await expect(options.nth(1)).toContainText("other commands");
  await expect(options.nth(1)).toHaveClass("palette-group");
});
test("any tab closes from its own close button, shown on hover", async ({
  page,
}) => {
  await page.goto("/");
  await newFile(page);
  await newFile(page);
  const first = page.locator(".tab").first();
  const button = first.locator(".tab-close");
  await expect(button).toHaveCSS("opacity", "0");
  await first.hover();
  await expect(button).not.toHaveCSS("opacity", "0");
  // Closing an inactive tab leaves the selected one where it is.
  await button.click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveAttribute("aria-selected", "true");
  // The window's own context menu never opens; nothing here defines one.
  const prevented = await page.evaluate(() => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    document.querySelector(".cm-content")!.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(true);
});
test("a Text Editor panel opens files and a folder from its + menu, as in Sublime Text", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  await page.evaluate(async () => {
    const loaded = (path: string) =>
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((url) => new URL(url).pathname === path) ?? path;
    const files = (await import(loaded("/src/services/native.ts"))).fileBackend;
    const fs = (await import(loaded("/src/services/filesystem.ts"))).fileSystem;
    const disk = new Map([
      ["/notes/todo.txt", "buy milk"],
      ["/notes/docs/readme.md", "# Read me"],
      ["/elsewhere/picked.txt", "picked"],
    ]);
    const dirs = new Set(["/notes", "/notes/docs"]);
    const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
    const name = (p: string) => p.slice(p.lastIndexOf("/") + 1);
    files.chooseFolder = async () => "/notes";
    files.open = async (path: string | null) => {
      const p = path ?? "/elsewhere/picked.txt";
      return {
        path: p,
        name: name(p),
        text: disk.get(p)!,
        revision: "1",
        bom: false,
        ending: "lf",
      };
    };
    fs.watch = async () => {};
    fs.list = async (directory: string) => ({
      directory,
      parent: parent(directory),
      crumbs: [],
      separator: "/",
      unreadable: 0,
      fallbackFrom: null,
      entries: [...dirs, ...disk.keys()]
        .filter((p) => p !== directory && parent(p) === directory)
        .map((p) => ({
          path: p,
          name: name(p),
          kind: dirs.has(p) ? "directory" : "file",
          targetKind: null,
          hidden: false,
          size: 1,
          modified: 1,
          broken: false,
          unsupported: false,
        })),
    });
  });
  const tabs = page.getByRole("tab");
  const plus = page.getByRole("button", { name: "New File or Open File" });
  const adds = page.getByRole("menu", { name: "New File or Open File" });
  await plus.click();
  await expect(adds.getByRole("menuitem")).toHaveText([
    /New File/,
    /Open File…/,
    /Open Folder…/,
  ]);
  // Open File adds the chosen file as a tab of this panel.
  await adds.getByRole("menuitem", { name: /Open File…/ }).click();
  // It takes the place of the empty page.
  await expect(tabs).toHaveText([/picked\.txt/]);
  await expect(page.locator(".cm-content")).toHaveText("picked");

  await plus.click();
  await adds.getByRole("menuitem", { name: /Open Folder…/ }).click();
  const folder = page.getByRole("complementary", { name: "Folder notes" });
  const tree = folder.getByRole("tree", { name: "Folder files" });
  // Folders first, then files, by name.
  await expect(tree.getByRole("treeitem")).toHaveText(["▸docs", "todo.txt"]);
  await tree.getByRole("treeitem", { name: "docs" }).click();
  await expect(tree.getByRole("treeitem")).toHaveText([
    "▾docs",
    "readme.md",
    "todo.txt",
  ]);
  await tree.getByRole("treeitem", { name: "todo.txt" }).click();
  await expect(tabs).toHaveCount(2);
  await expect(page.locator(".cm-content")).toHaveText("buy milk");
  // A click opens a file into the editor; in the tree the keys move and Enter opens.
  await expect(
    page.getByRole("textbox", { name: "Editor todo.txt" }),
  ).toBeFocused();
  await tree.getByRole("treeitem", { name: "todo.txt" }).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(tabs).toHaveCount(3);
  await expect(page.locator(".cm-content")).toHaveText("# Read me");
  await tree.getByRole("treeitem", { name: "todo.txt" }).click();
  await expect(tabs).toHaveCount(3);
  // A file is never opened twice.
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

  // The edge resizes the folder; Close Folder hides it and leaves the tabs.
  const width = (await folder.boundingBox())!.width;
  const edge = (await folder
    .getByRole("separator", { name: "Resize folder" })
    .boundingBox())!;
  await page.mouse.move(edge.x + 3, edge.y + 100);
  await page.mouse.down();
  await page.mouse.move(edge.x + 63, edge.y + 100, { steps: 4 });
  await page.mouse.up();
  expect(Math.round((await folder.boundingBox())!.width)).toBe(
    Math.round(width) + 60,
  );
  // Closing every tab leaves the panel and its folder: a page to write on.
  await tabs.first().click({ button: "right" });
  await page
    .getByRole("menu", { name: "Tab actions" })
    .getByRole("menuitem", { name: "Close All" })
    .click();
  await expect(tabs).toHaveCount(0);
  await expect(folder).toBeVisible();
  await page.locator(".cm-content").click();
  await page.keyboard.type("draft");
  await expect(tabs).toHaveText([/Untitled/]);
  await folder.getByRole("button", { name: "Close folder" }).click();
  await expect(folder).toHaveCount(0);
  await expect(tabs).toHaveCount(1);
});
test("tabs close with the middle button and from their menu, split off and add text tabs", async ({
  page,
}) => {
  await page.goto("/");
  await newFile(page);
  await newFile(page);
  await newFile(page);
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await page.locator(".tab").first().click({ button: "middle" });
  await expect(tabs).toHaveCount(2);
  // A Text Editor panel adds tabs from its + menu and a double click on its free tab strip.
  const plus = page.getByRole("button", { name: "New File or Open File" });
  const adds = page.getByRole("menu", { name: "New File or Open File" });
  await plus.click();
  await adds.getByRole("menuitem", { name: /New File/ }).click();
  await expect(tabs).toHaveCount(3);
  await page.locator(".tabs").dblclick({ position: { x: 600, y: 10 } });
  await expect(tabs).toHaveCount(4);
  await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
  const menu = page.getByRole("menu", { name: "Tab actions" });
  await tabs.first().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Close Others" }).click();
  await expect(tabs).toHaveCount(1);
  await plus.click();
  await adds.getByRole("menuitem", { name: /New File/ }).click();
  // Split Right divides the Text Editor into editor groups: the tab moves to the new one.
  await tabs.last().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Split Right" }).click();
  const groups = page.locator(".split.group");
  await expect(groups).toHaveCount(1);
  await expect(groups.locator("[data-panel]")).toHaveCount(2);
  await expect(tabs).toHaveCount(2);
  // Alone in its group, an editor splits off an empty page below.
  await tabs.last().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Split Down" }).click();
  await expect(groups.locator("[data-panel]")).toHaveCount(3);
  await expect(page.locator(".split.group.y")).toHaveCount(1);
  await expect(tabs).toHaveCount(2);
  // Closing a group's last tab removes that group and its line.
  await tabs.last().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Close All" }).click();
  await expect(groups.locator("[data-panel]")).toHaveCount(2);
  await expect(tabs).toHaveCount(1);
});
test("editor groups divide one Text Editor panel and act as one", async ({
  page,
}) => {
  await page.goto("/");
  await newFile(page);
  await newFile(page);
  const tabs = page.getByRole("tab");
  // Dragging a text tab to an edge of its editor makes a group, as in Sublime Text.
  const source = (await tabs.last().boundingBox())!;
  const panel = (await page.locator("[data-panel]").boundingBox())!;
  await page.mouse.move(source.x + 20, source.y + 10);
  await page.mouse.down();
  await page.mouse.move(
    panel.x + panel.width - 10,
    panel.y + panel.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  const group = page.locator(".split.group");
  await expect(group.locator("[data-panel]")).toHaveCount(2);
  // The groups are one panel divided by a line, not panels with a gap between them.
  const [left, right] = await group
    .locator("[data-panel]")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.getBoundingClientRect().toJSON()),
    );
  expect(Math.round(right.x - (left.x + left.width))).toBe(1);
  // Another module goes beside the whole Text Editor, never between its groups.
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("term");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel]")).toHaveCount(3);
  await expect(group.locator("[data-panel]")).toHaveCount(2);
  await expect(group.locator(".terminal-surface")).toHaveCount(0);
  // Maximize shows the whole editor with its groups.
  await group
    .locator("[data-panel]")
    .first()
    .getByRole("button", { name: "Maximize panel" })
    .click();
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await expect(group).toBeVisible();
  await group
    .locator("[data-panel]")
    .first()
    .getByRole("button", { name: "Maximize panel" })
    .click();
  await expect(page.locator("[data-panel]")).toHaveCount(3);
  // Close Panel closes the Text Editor with all its groups.
  await group.locator(".cm-content").first().click();
  await page.keyboard.press("Control+Shift+C");
  await expect(group).toHaveCount(0);
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(tabs).toHaveText([/Terminal/]);
});
test("the text editor shares the code editor's editing shortcuts", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  const content = page.locator(".cm-content");
  await content.click();
  await page.keyboard.type("one two\none two\nthree");
  await page.keyboard.press("Control+Home");
  // Ctrl+D selects the word, then its next match: typing replaces both.
  await page.keyboard.press("Control+d");
  await page.keyboard.press("Control+d");
  await page.keyboard.type("1");
  await expect(content).toHaveText("1 two1 twothree");
  // Ctrl+L selects whole lines; Ctrl+Alt+Down adds a cursor below.
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+l");
  await page.keyboard.press("Control+l");
  await page.keyboard.type("x\n");
  await expect(content).toHaveText("xthree");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Control+Alt+ArrowDown");
  await page.keyboard.type("-");
  await expect(content).toHaveText("-x-three");
  // Find / Replace opens over the text.
  await page.keyboard.press("Control+f");
  await expect(page.locator(".editor-wrapper .cm-search")).toBeVisible();
});
test("a terminal panel's + adds a terminal with a chosen shell, and terminal tabs can be renamed", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/plugins/terminal/ShellSetting.tsx";
    const url =
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find((u) => new URL(u).pathname === path) ?? path;
    const module = await import(url);
    module.shellBackend.load = async () => ({
      shells: [
        { id: "pwsh", name: "PowerShell" },
        { id: "bash", name: "Git Bash" },
      ],
      selected: "bash",
      system: "pwsh",
    });
  });
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("term");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);
  // The + lists the detected shells, the default one marked; the choice joins this panel.
  await page.getByRole("button", { name: "New Terminal" }).click();
  const menu = page.getByRole("menu", { name: "New Terminal" });
  await expect(menu.getByRole("menuitem")).toHaveText([
    "PowerShell",
    "Git Bash (default)",
  ]);
  await menu.getByRole("menuitem", { name: "PowerShell" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  // Rename, from the tab's menu, names the tab in place.
  await page.getByRole("tab").nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const field = page.getByRole("textbox", { name: "Tab name" });
  await expect(field).toBeFocused();
  await field.fill("Build");
  await field.press("Enter");
  await expect(page.getByRole("tab", { name: "Build (failed)" })).toBeVisible();
  // Escape keeps the name; an emptied name gives back the shell's.
  await page.getByRole("tab").nth(1).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await field.fill("Other");
  await field.press("Escape");
  await expect(page.getByRole("tab", { name: "Build (failed)" })).toBeVisible();
  await expect(field).toHaveCount(0);
  // Other tools' tabs have no Rename.
  await newFile(page);
  await page.getByRole("tab", { name: /Untitled/ }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
  await page.keyboard.press("Escape");
});
test("terminal view keeps its emulator across tab moves and closes cleanly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await newFile(page);
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("term");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  const terminal = page.locator(".terminal-surface");
  await expect(terminal.locator(".xterm")).toBeVisible();
  // Browser runs have no native PTY: the failure is explicit, not a silent empty view.
  await expect(page.locator(".terminal-error")).toContainText(
    "requires the Mozaik desktop app",
  );
  await expect(
    page.getByRole("tab", { name: "Terminal (failed)" }),
  ).toBeVisible();
  await terminal.evaluate((node) => ((node as any).__marker = "kept"));
  await page.locator(".terminal-host").click();
  await page.keyboard.press("Control+Shift+Quote");
  await expect(
    page.getByRole("dialog", { name: "Add to workspace" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const source = await page
    .getByRole("tab", { name: "Terminal (failed)" })
    .boundingBox();
  const target = await page.locator("[data-panel]").first().boundingBox();
  await page.mouse.move(source!.x + 20, source!.y + 10);
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(
    await page
      .locator(".terminal-surface")
      .evaluate((n) => (n as any).__marker),
  ).toBe("kept");
  await page.getByRole("tab").first().click();
  await expect(page.locator(".terminal-surface")).toHaveCount(0);
  await page.getByRole("tab", { name: "Terminal (failed)" }).click();
  expect(
    await page
      .locator(".terminal-surface")
      .evaluate((n) => (n as any).__marker),
  ).toBe("kept");
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".terminal-surface")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("Ctrl+Shift+C in a terminal copies a selection and otherwise closes the panel", async ({
  page,
}) => {
  await page.goto("/");
  await newFile(page);
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("term");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  const surface = page.locator(".terminal-surface");
  await expect(surface.locator(".xterm")).toBeVisible();
  await page.locator(".terminal-host").click();
  // Browser runs start no shell, so the selection xterm.js reports is set by hand.
  await surface.evaluate((node) => node.setAttribute("data-selection", ""));
  await page.keyboard.press("Control+Shift+C");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await surface.evaluate((node) => node.removeAttribute("data-selection"));
  await page.keyboard.press("Control+Shift+C");
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.locator(".terminal-surface")).toHaveCount(0);
});
test("empty startup, editor, hidden history, and dirty close decisions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".status-logo")).toBeVisible();
  await expect(page.locator(".toolbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open launcher" })).toHaveCount(
    0,
  );
  await expect(page.locator("[data-panel]")).toHaveCount(0);
  await add(page);
  await page.locator(".cm-content").fill("first document");
  await add(page);
  await page.locator(".cm-content").fill("second document");
  await page.getByRole("tab").first().click();
  await expect(page.locator(".cm-content")).toHaveText("first document");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".cm-content")).toHaveText("");
  await page.keyboard.press("Control+y");
  await expect(page.locator(".cm-content")).toHaveText("first document");
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("split, spatial focus, maximize, minimum rejection and modifier release", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  await add(page, "split");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  const first = await page
    .locator("[data-panel]")
    .first()
    .getAttribute("data-panel");
  await page.keyboard.down("ControlRight");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".panel.focused")).toHaveAttribute(
    "data-panel",
    first!,
  );
  await page.keyboard.up("ControlRight");
  await expect(page.locator(".layout")).not.toHaveClass(/control/);
  await page.keyboard.type("focused typing");
  await expect(
    page.locator("[data-panel]").first().locator(".cm-content"),
  ).toHaveText("focused typing");
  await page
    .locator("[data-panel]")
    .first()
    .getByRole("button", { name: "Maximize panel" })
    .click();
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.getByRole("tab")).toBeVisible();
  await page.getByRole("button", { name: "Maximize panel" }).click();
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await page.screenshot({ path: "test-results/workspace.png" });
  await page.setViewportSize({ width: 560, height: 360 });
  await add(page, "split");
  await expect(page.getByRole("alert")).toContainText("Not enough space");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
});
test("tab center merge, reorder, edge detach, invalid drop and close reflow", async ({
  page,
}) => {
  await page.goto("/");
  await newFile(page);
  await newFile(page, "split");
  const source = await page.getByRole("tab").first().boundingBox();
  const target = await page.locator("[data-panel]").last().boundingBox();
  await page.mouse.move(source!.x + 20, source!.y + 10);
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(2);
  const tab = await page.getByRole("tab").first().boundingBox();
  const panel = await page.locator("[data-panel]").boundingBox();
  await page.mouse.move(tab!.x + 20, tab!.y + 10);
  await page.mouse.down();
  await page.mouse.move(
    panel!.x + panel!.width - 10,
    panel!.y + panel!.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();
  // An editor tab at an edge of an editor makes an editor group.
  await expect(page.locator(".split.group [data-panel]")).toHaveCount(2);
  // Closing a group's last tab removes the group; the last one stays a page to write on.
  await page
    .getByRole("button", { name: "Close tab", exact: true })
    .first()
    .click();
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.locator(".split.group")).toHaveCount(0);
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  // The layout reflows around panels that close: here the first of two.
  await newFile(page, "split");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+Shift+C");
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+C");
  await expect(page.locator("[data-panel]")).toHaveCount(0);
});
test("panel drag starts with Ctrl+Shift held, continues after release and swaps at center", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  await add(page, "split");
  const ids = await page
    .locator("[data-panel]")
    .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-panel")));
  const source = await page
    .getByRole("button", { name: "Move panel" })
    .first()
    .boundingBox();
  const target = await page.locator("[data-panel]").last().boundingBox();
  // The workspace key alone no longer moves panels.
  await page.keyboard.down("ControlRight");
  await expect(page.locator(".layout")).not.toHaveClass(/control/);
  await page.keyboard.down("Shift");
  await expect(page.locator(".layout")).toHaveClass(/control/);
  await page.mouse.move(source!.x + 8, source!.y + 8);
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 5 },
  );
  await page.keyboard.up("Shift");
  await page.keyboard.up("ControlRight");
  await expect(page.locator(".layout")).not.toHaveClass(/control/);
  await expect(page.locator(".drop-preview")).toBeVisible();
  await page.mouse.up();
  expect(
    await page
      .locator("[data-panel]")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-panel"))),
  ).toEqual(ids.reverse());
});
test("go to line and configurable held modifier", async ({ page }) => {
  await page.goto("/");
  await add(page);
  await page.locator(".cm-content").fill("one\ntwo\nthree");
  await page.keyboard.press("Control+g");
  await page.getByRole("spinbutton", { name: "Line number" }).fill("3");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.keyboard.type("!");
  await expect(page.locator(".cm-content")).toContainText("!three");
  await page.keyboard.press("Control+Shift+Comma");
  const select = page.getByRole("combobox", { name: "Workspace key" });
  await expect(select).toHaveValue("ControlRight");
  await expect(select.getByRole("option", { name: /Right Alt/ })).toHaveCount(
    0,
  );
  await select.selectOption({ label: "Left Alt" });
  await expect(page.getByRole("note")).toContainText("Left Alt+arrows");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await add(page, "split");
  const panels = page.locator("[data-panel]");
  // Left Alt+arrows now move focus; Right Ctrl+arrows move the caret by word.
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".panel.focused")).toHaveAttribute(
    "data-panel",
    (await panels.first().getAttribute("data-panel"))!,
  );
  await page.keyboard.press("ControlRight+ArrowRight");
  await expect(page.locator(".panel.focused")).toHaveAttribute(
    "data-panel",
    (await panels.first().getAttribute("data-panel"))!,
  );
});
test("only Right Ctrl+arrows belong to the workspace key; Ctrl+Shift keys add, close and open settings", async ({
  page,
}) => {
  await page.goto("/");
  // The status line has no keyboard button: the palette lists the workspace keys.
  await expect(page.locator(".titlebar")).toBeVisible();
  await expect(page.locator(".titlebar button")).toHaveCount(0);
  await add(page);
  await add(page, "split");
  const editor = page.locator("[data-panel]").last().locator(".cm-content");
  await editor.click();
  await page.keyboard.type("one two");
  // Left and Right Ctrl+K stay with the editor; no launcher opens.
  await page.keyboard.press("Control+k");
  await page.keyboard.press("ControlRight+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Left Ctrl+arrow keeps moving the caret by word.
  await page.keyboard.press("Control+ArrowLeft");
  await page.keyboard.type("_");
  await expect(editor).toHaveText("one _two");
  // An unassigned Right Ctrl combination reaches the editor (select all).
  await page.keyboard.press("ControlRight+a");
  await page.keyboard.type("x");
  await expect(editor).toHaveText("x");
  // Left Ctrl+Z still undoes in the editor.
  await page.keyboard.press("Control+z");
  await expect(editor).toHaveText("one _two");
  // Right Ctrl+arrow moves focus instead of moving the caret.
  await page.keyboard.press("ControlRight+ArrowLeft");
  await expect(page.locator(".panel.focused")).toHaveAttribute(
    "data-panel",
    (await page.locator("[data-panel]").first().getAttribute("data-panel"))!,
  );
  await expect(editor).toHaveText("one _two");
  await editor.click();
  // Cancelling the launcher returns focus to the editor.
  await page.keyboard.press("Control+Shift+Quote");
  await page.keyboard.press("Escape");
  await expect(editor).toBeFocused();
  await page.keyboard.type("!");
  await expect(editor).toContainText("!");
});
test("large document fallback survives switching tabs without losing content", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  await page.evaluate(async () => {
    const path = "/src/plugins/text-editor/documents.ts";
    const docs = await import(path);
    docs.updateDocument(docs.allDocuments()[0].id, {
      text: "const value = 1;\n".repeat(70000),
    });
  });
  await expect(
    page.getByText("Large document · syntax highlighting paused"),
  ).toBeVisible();
  await add(page);
  await page.getByRole("tab").first().click();
  await expect(
    page.getByText("Large document · syntax highlighting paused"),
  ).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("const value = 1;");
});
test("hidden document reload is reflected when the view remounts", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  await page.locator(".cm-content").fill("old version");
  await add(page);
  await page.evaluate(async () => {
    const path = "/src/plugins/text-editor/documents.ts";
    const docs = await import(path);
    docs.updateDocument(docs.allDocuments()[0].id, {
      text: "new disk version",
      saved: "new disk version",
    });
  });
  await page.getByRole("tab").first().click();
  await expect(page.locator(".cm-content")).toHaveText("new disk version");
  await expect(page.getByRole("tab").first()).not.toContainText("•");
});
test("settings are module tabs with searchable sections, saved or reset explicitly", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  await page.keyboard.press("Control+Shift+Comma");
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  // General first, then each module with its own settings and shortcuts.
  const tabs = settings.getByRole("tablist", { name: "Settings sections" });
  await expect(tabs.getByRole("tab")).toHaveText([
    "General",
    "Text Editor",
    "IDE",
    "Terminal",
    "File Manager",
    "Tasks and Notes",
  ]);
  await expect(
    settings.getByRole("slider", { name: "Window opacity" }),
  ).toBeVisible();
  const save = settings.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeDisabled();
  // Sections fold away.
  const section = settings.getByRole("button", { name: /Window$/ });
  await section.click();
  await expect(
    settings.getByRole("slider", { name: "Window opacity" }),
  ).toHaveCount(0);
  await section.click();
  const newTab = settings.getByRole("button", {
    name: "New file (Workspace): Ctrl+N",
  });
  await newTab.click();
  await expect(newTab).toHaveText("Press keys…");
  // Keys that another shortcut has are refused with a note.
  await page.keyboard.press("Control+s");
  await expect(settings.getByRole("alert")).toContainText("Save (Workspace)");
  await newTab.click();
  await page.keyboard.press("Control+Shift+y");
  await expect(
    settings.getByRole("button", {
      name: "New file (Workspace): Ctrl+Shift+Y",
    }),
  ).toBeVisible();
  // Nothing applies before Save.
  await expect(settings.getByText("Unsaved changes")).toBeVisible();
  await save.click();
  await expect(settings).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+y");
  await expect(page.getByRole("tab")).toHaveCount(1);
  // The old keys are free again: the editor gets them.
  await page.keyboard.press("Control+n");
  await expect(page.getByRole("tab")).toHaveCount(1);

  // Search finds settings in every tab.
  await page.keyboard.press("Control+Shift+Comma");
  await settings
    .getByRole("searchbox", { name: "Search settings" })
    .fill("line");
  await expect(
    settings.getByRole("region", {
      name: "Text Editor › Shortcuts (text and code editors)",
    }),
  ).toBeVisible();
  await settings
    .getByRole("button", { name: "Remove Go to line shortcut" })
    .click();
  await expect(
    settings.getByRole("button", { name: "Go to line (Editors): none" }),
  ).toBeVisible();
  // A chord is recorded as two presses.
  await settings
    .getByRole("searchbox", { name: "Search settings" })
    .fill("comment");
  const comment = settings.getByRole("button", {
    name: "Add line comment (Editors): Ctrl+K Ctrl+C",
  });
  await comment.click();
  await expect(comment).toHaveText("Press two keys…");
  await page.keyboard.press("Control+j");
  await expect(comment).toHaveText("Ctrl+J …");
  await page.keyboard.press("Control+c");
  await expect(
    settings.getByRole("button", {
      name: "Add line comment (Editors): Ctrl+J Ctrl+C",
    }),
  ).toBeVisible();
  await settings.getByRole("searchbox", { name: "Search settings" }).fill("");
  await settings
    .getByRole("button", { name: "Remove Command palette shortcut" })
    .click();
  // Cancel with changes asks; Discard keeps the saved ones.
  await settings.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(settings).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+p");
  await expect(
    page.getByRole("dialog", { name: "Command palette" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  // Reset to Default resets the tab shown.
  await page.keyboard.press("Control+Shift+Comma");
  await settings
    .getByRole("button", { name: "Remove Command palette shortcut" })
    .click();
  await settings.getByRole("button", { name: "Reset to Default" }).click();
  await expect(
    settings.getByRole("button", {
      name: "New file (Workspace): Ctrl+N",
    }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", {
      name: "Command palette (Workspace): Ctrl+Shift+P",
    }),
  ).toBeVisible();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+p");
  await expect(
    page.getByRole("option", { name: /New File.*Ctrl\+N/ }),
  ).toBeVisible();
});
test("window opacity applies to the whole window and the clock shows the time", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".status-clock")).toHaveAttribute(
    "datetime",
    /^\d{4}-/,
  );
  await page.keyboard.press("Control+Shift+Comma");
  const slider = page.getByRole("slider", { name: "Window opacity" });
  await expect(slider).toHaveValue("100");
  await slider.fill("60");
  await expect(page.locator(".shell")).toHaveCSS("opacity", "0.6");
});
test("the text editor has its own status bar and wraps long lines under their indentation", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  const editor = page.locator(".cm-content");
  const status = page.getByRole("group", { name: "Text editor status" });
  await expect(status).toHaveText(/Ln 1, Col 1.*LF.*UTF-8/);
  await expect(status).not.toContainText("Modified");
  // The workspace's status line shows only the mark and the clock.
  await expect(page.locator(".titlebar")).not.toContainText("UTF-8");
  await editor.click();
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
  await page.keyboard.type(`top\n    ${words}`);
  await expect(status).toContainText("Modified");
  await expect(status).toContainText("Ln 2,");
  // Wrapped by default: one numbered line spans several rows, starting under its text.
  const line = page.locator(".cm-line").nth(1);
  const box = (await line.boundingBox())!;
  expect(box.height).toBeGreaterThan(40);
  await expect(
    page.locator(".cm-gutterElement", { hasText: /^3$/ }),
  ).toHaveCount(0);
  expect(
    await line.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rows = [...range.getClientRects()];
      return Math.round(
        rows[rows.length - 1].left - el.getBoundingClientRect().left,
      );
    }),
  ).toBeGreaterThan(20);
  // The setting turns it off for every text editor.
  await page.keyboard.press("Control+Shift+Comma");
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await settings.getByRole("tab", { name: "Text Editor" }).click();
  await settings.getByRole("checkbox", { name: "Word wrap" }).uncheck();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect((await line.boundingBox())!.height).toBeLessThan(30);
});
test("floating panels open from the launcher and the palette, move, resize, take tabs and dock", async ({
  page,
}) => {
  await page.goto("/");
  await newFile(page);
  // Ctrl+Shift+Enter in the launcher adds a floating panel over the layout.
  await page.keyboard.press("Control+Shift+Quote");
  await expect(page.getByRole("dialog")).toContainText("Ctrl Shift Enter");
  await page.keyboard.type("text");
  await page.keyboard.press("Control+Shift+Enter");
  const floating = page.locator(".panel.floating");
  await expect(floating).toHaveCount(1);
  await expect(floating).toHaveClass(/focused/);
  await expect(page.locator(".panel:not(.floating)")).toHaveCount(1);
  // It moves by its header and resizes at its edges.
  const before = (await floating.boundingBox())!;
  const grip = floating.getByRole("button", { name: "Move panel" });
  const g = (await grip.boundingBox())!;
  await page.mouse.move(g.x + 5, g.y + 5);
  await page.mouse.down();
  await page.mouse.move(g.x - 95, g.y + 45, { steps: 4 });
  await page.mouse.up();
  const moved = (await floating.boundingBox())!;
  expect(Math.round(moved.x - before.x)).toBe(-100);
  expect(Math.round(moved.y - before.y)).toBe(40);
  const corner = floating.locator(".float-resize.se");
  const c = (await corner.boundingBox())!;
  await page.mouse.move(c.x + 5, c.y + 5);
  await page.mouse.down();
  await page.mouse.move(c.x + 65, c.y + 35, { steps: 4 });
  await page.mouse.up();
  const resized = (await floating.boundingBox())!;
  expect(Math.round(resized.width - moved.width)).toBe(60);
  expect(Math.round(resized.height - moved.height)).toBe(30);
  expect(Math.round(resized.x)).toBe(Math.round(moved.x));
  // In the palette the same keys choose: Ctrl+Enter a tab in it, Ctrl+Shift+Enter another.
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("add text editor");
  await expect(palette).toContainText("Ctrl Shift Enter");
  await page.keyboard.press("Control+Enter");
  // In place of the floating editor's empty page.
  await expect(floating.getByRole("tab")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("add text editor");
  await page.keyboard.press("Control+Shift+Enter");
  await expect(floating).toHaveCount(2);
  const second = page.locator(
    `[data-panel="${await page.locator(".panel.floating.focused").getAttribute("data-panel")}"]`,
  );
  // A tab dragged onto a floating panel joins it.
  const tab = page.locator(".panel:not(.floating)").getByRole("tab").first();
  const target = second.locator(".panel-content");
  await tab.hover();
  await page.mouse.down();
  const t = (await target.boundingBox())!;
  await page.mouse.move(t.x + 20, t.y + 20, { steps: 6 });
  await page.mouse.up();
  await expect(second.getByRole("tab")).toHaveCount(1);
  await expect(page.locator(".panel:not(.floating)")).toHaveCount(0);
  // Dock puts it back into the layout; Float Panel floats the focused one again.
  await second.getByRole("button", { name: "Dock panel" }).click();
  await expect(floating).toHaveCount(1);
  await expect(page.locator(".panel:not(.floating)")).toHaveCount(1);
  // The docked panel has focus.
  await expect(page.locator(".panel:not(.floating)")).toHaveClass(/focused/);
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("float panel");
  await page.keyboard.press("Enter");
  await expect(floating).toHaveCount(2);
  await expect(page.locator(".panel:not(.floating)")).toHaveCount(0);
  await expect(page.locator(".empty")).toHaveCount(0);
});
test("terminals and file managers start in the folder chosen in settings", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.keyboard.press("Control+Shift+Comma");
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await settings.getByRole("tab", { name: "Terminal" }).click();
  const terminal = settings.getByRole("textbox", {
    name: "Terminal start folder",
  });
  // Empty is the home folder.
  await expect(terminal).toHaveAttribute("placeholder", "Home folder");
  await terminal.fill("projects");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText(
    "must be a full path",
  );
  await terminal.fill("  /home/me/projects ");
  // The PowerShell prompt is a .ps1 file; empty keeps the shell's own prompt.
  const prompt = settings.getByRole("textbox", {
    name: "PowerShell prompt file",
  });
  await expect(prompt).toHaveAttribute("placeholder", "Shell's own prompt");
  await prompt.fill("/home/me/prompt.txt");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("a .ps1 file");
  await prompt.fill(" /home/me/prompt.ps1 ");
  await settings.getByRole("tab", { name: "File Manager" }).click();
  await settings
    .getByRole("textbox", { name: "File Manager start folder" })
    .fill("/home/me");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const loaded =
      performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .find(
          (url) => new URL(url).pathname === "/src/services/preferences.ts",
        ) ?? "/src/services/preferences.ts";
    const { preferencesBackend } = await import(loaded);
    return preferencesBackend.get();
  });
  expect(saved.terminalFolder).toBe("/home/me/projects");
  expect(saved.fileManagerFolder).toBe("/home/me");
  expect(saved.powershellPrompt).toBe("/home/me/prompt.ps1");
});
test("layout templates save the modules and their places, and open after asking", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const run = async (command: string) => {
    await page.keyboard.press("Control+Shift+p");
    await page.keyboard.type(command);
    await palette.getByRole("option", { name: new RegExp(command) }).click();
  };
  // Nothing to open yet.
  await run("Open Layout Template");
  await expect(page.getByRole("alert")).toContainText("no layout templates");
  await page.getByRole("button", { name: "Dismiss notification" }).click();
  // A Text Editor with two groups (one with typed text) beside a terminal.
  await newFile(page);
  await page.locator(".cm-content").click();
  await page.keyboard.type("draft");
  await newFile(page);
  const menu = page.getByRole("menu", { name: "Tab actions" });
  await page.getByRole("tab").last().click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Split Right" }).click();
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("term");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel]")).toHaveCount(3);

  await run("Save Layout as Template");
  // The name is typed in the palette's place; Enter saves.
  const name = page.getByRole("dialog", { name: "Save Layout as Template" });
  await name.getByRole("textbox", { name: "Template name" }).fill("Writing");
  await expect(name).toContainText("Save this layout as “Writing”");
  await page.keyboard.press("Enter");
  await expect(name).toHaveCount(0);

  // Opening it asks before closing the panels, and unsaved text is asked about too.
  await run("Open Layout Template");
  const picker = page.getByRole("dialog", { name: "Open Layout Template" });
  await picker.getByRole("option", { name: "Writing" }).click();
  const confirm = page.getByRole("dialog", {
    name: /Close every panel of this window and open “Writing”/,
  });
  await confirm.getByRole("option", { name: /Close and Open/ }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  // The same places, every module fresh: editors are pages to write on.
  await expect(page.locator(".split.group [data-panel]")).toHaveCount(2);
  await expect(page.locator("[data-panel]")).toHaveCount(3);
  await expect(page.getByRole("tab")).toHaveText([/Terminal/]);
  await expect(page.locator(".cm-content").first()).toHaveText("");

  // Saving again under the same name asks to replace it; templates can be deleted.
  await run("Save Layout as Template");
  await expect(name.getByRole("listitem")).toContainText(["", "Writing"]);
  await name.getByRole("textbox", { name: "Template name" }).fill("writing");
  await expect(name).toContainText("Replace the template “writing”");
  await page.keyboard.press("Enter");
  const replace = page.getByRole("dialog", {
    name: /Replace the template “writing”/,
  });
  await expect(replace.getByRole("option").first()).toContainText("Replace");
  await page.keyboard.press("Enter");
  await expect(replace).toHaveCount(0);
  await run("Delete Layout Template");
  await page
    .getByRole("dialog", { name: "Delete Layout Template" })
    .getByRole("option", { name: /writing/i })
    .click();
  await page
    .getByRole("dialog", { name: /Delete the template/ })
    .getByRole("option", { name: /Delete/ })
    .click();
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "no layout templates" });
  await expect(notice).toHaveCount(0);
  await run("Open Layout Template");
  await expect(notice).toBeVisible();
  await expect(page.locator("[data-panel]")).toHaveCount(3);
});
test("fonts are chosen per module, or the General font for all modules", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  const scroller = page.locator(".cm-scroller");
  const font = () => scroller.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(await font()).toMatch(/^Consolas/);
  await page.keyboard.press("Control+Shift+Comma");
  const settings = page.getByRole("dialog", { name: "Workspace settings" });
  await settings.getByRole("tab", { name: "Text Editor" }).click();
  const own = settings.getByRole("combobox", { name: "Text Editor font" });
  // The list offers every installed font, also after one was picked.
  await own.click();
  const options = settings.getByRole("option");
  const count = await options.count();
  expect(count).toBeGreaterThan(1);
  // The default font comes first and stays offered once another one was picked.
  await expect(options.first()).toHaveText(/^Default/);
  await expect(own).toHaveAttribute("placeholder", /^Default/);
  const first = (await options.nth(1).textContent())!;
  await options.nth(1).click();
  await expect(own).toHaveValue(first);
  await expect(options).toHaveCount(0);
  await own.click();
  await expect(options).toHaveCount(count);
  await options.first().click();
  await expect(own).toHaveValue("");
  await own.click();
  await own.press("Escape");
  await expect(options).toHaveCount(0);
  await expect(settings).toBeVisible();
  await own.fill('Mono"; color: red');
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings.getByRole("alert")).toContainText("one font name");
  await own.fill("serif");
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect(await font()).toMatch(/^serif, Consolas/);
  // The General font is the interface font; with "all" it replaces the module's own.
  await page.keyboard.press("Control+Shift+Comma");
  const all = settings.getByRole("checkbox", {
    name: "Use the General font for all modules",
  });
  await expect(all).toBeDisabled();
  await settings
    .getByRole("combobox", { name: "General font" })
    .fill("cursive");
  await all.check();
  await settings.getByRole("tab", { name: "Text Editor" }).click();
  await expect(own).toBeDisabled();
  await expect(own).toHaveAttribute("title", /Use for all modules is on/);
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect(await font()).toMatch(/^cursive/);
  expect(
    await page.evaluate(() => getComputedStyle(document.body).fontFamily),
  ).toMatch(/^cursive/);
});
