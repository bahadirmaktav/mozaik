import { test, expect, type Page } from "@playwright/test";
async function add(page: Page, mode: "tab" | "split" = "tab") {
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.keyboard.press("Control+Shift+I");
  await page.getByRole("combobox", { name: "Search tools" }).fill("text");
  await page.keyboard.press(mode === "tab" ? "Control+Enter" : "Enter");
  await expect(page.locator(".cm-editor").last()).toBeVisible();
}
test("launcher searches tools and adds the selection as split or tab", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.keyboard.press("Control+Shift+I");
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
  await add(page, "split");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await add(page);
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await expect(page.getByRole("tab")).toHaveCount(3);
  // Ctrl+Shift+C closes the focused panel with all its tabs.
  await page.locator(".cm-content").first().click();
  await page.keyboard.press("Control+Shift+C");
  await expect(page.locator("[data-panel]")).toHaveCount(1);
  await expect(page.getByRole("tab")).toHaveCount(2);
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
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("text tab");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);

  await page.locator(".cm-content").fill("typed");
  await page.keyboard.press("Control+Shift+p");
  await palette.getByRole("option", { name: /Close Tab/ }).click();
  // The command acted on the editor that had focus: its unsaved text asks first.
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);

  // A command per module adds it, as the launcher does; settings are a command too.
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("add text editor");
  await expect(palette.getByRole("option")).toHaveText([
    "Add to Workspace: Text Editor",
  ]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+p");
  await page.keyboard.type("settings");
  await palette.getByRole("option", { name: /Workspace Settings/ }).click();
  await expect(
    page.getByRole("dialog", { name: "Workspace settings" }),
  ).toBeVisible();
});
test("any tab closes from its own close button, shown on hover", async ({
  page,
}) => {
  await page.goto("/");
  await add(page);
  await add(page);
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
test("terminal view keeps its emulator across tab moves and closes cleanly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await add(page);
  await page.keyboard.press("Control+Shift+I");
  await page.getByRole("combobox", { name: "Search tools" }).fill("term");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  const terminal = page.locator(".terminal-surface");
  await expect(terminal.locator(".xterm")).toBeVisible();
  // Browser runs have no native PTY: the failure is explicit, not a silent empty view.
  await expect(page.locator(".terminal-error")).toContainText(
    "requires the Tessera desktop app",
  );
  await expect(
    page.getByRole("tab", { name: "Terminal (failed)" }),
  ).toBeVisible();
  await terminal.evaluate((node) => ((node as any).__marker = "kept"));
  await page.locator(".terminal-host").click();
  await page.keyboard.press("Control+Shift+I");
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
  await add(page);
  await add(page, "split");
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
  await expect(page.locator("[data-panel]")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Close tab", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Close tab", exact: true }).click();
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
  await expect(
    select.getByRole("option", { name: /Right Alt/ }),
  ).toHaveAttribute("disabled", "");
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
  await page.keyboard.press("Control+Shift+I");
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
    name: "New text tab (Workspace): Ctrl+N",
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
      name: "New text tab (Workspace): Ctrl+Shift+Y",
    }),
  ).toBeVisible();
  // Nothing applies before Save.
  await expect(settings.getByText("Unsaved changes")).toBeVisible();
  await save.click();
  await expect(settings).toHaveCount(0);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Shift+y");
  await expect(page.getByRole("tab")).toHaveCount(2);
  // The old keys are free again: the editor gets them.
  await page.keyboard.press("Control+n");
  await expect(page.getByRole("tab")).toHaveCount(2);

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
      name: "New text tab (Workspace): Ctrl+N",
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
    page.getByRole("option", { name: /New Text Tab.*Ctrl\+N/ }),
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
