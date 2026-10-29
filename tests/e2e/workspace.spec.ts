import { test, expect, type Page } from "@playwright/test";
async function add(page: Page, mode: "tab" | "split" = "tab") {
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("text");
  await page.keyboard.press(mode === "tab" ? "Control+Enter" : "Enter");
  await expect(page.locator(".cm-editor").last()).toBeVisible();
}
test("launcher searches tools and adds the selection as split or tab", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.keyboard.press("ControlRight+k");
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
});
test("title bar command palette filters commands and runs them on the focused tool", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open command palette" }).click();
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await page.keyboard.type("zzz");
  await expect(palette).toContainText("No matching commands");
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);

  await page.getByRole("button", { name: "Open command palette" }).click();
  await page.keyboard.type("text tab");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);

  await page.locator(".cm-content").fill("typed");
  await page.getByRole("button", { name: "Open command palette" }).click();
  await palette.getByRole("option", { name: /Close Tab/ }).click();
  // The command acted on the editor that had focus: its unsaved text asks first.
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
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
  await page.keyboard.press("ControlRight+k");
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
  await page.keyboard.press("ControlRight+k");
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
  await expect(page.locator(".titlebar-logo")).toBeVisible();
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
  await page.setViewportSize({ width: 600, height: 400 });
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
test("panel drag continues after modifier release and swaps at center", async ({
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
  await page.keyboard.down("ControlRight");
  await page.mouse.move(source!.x + 8, source!.y + 8);
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 5 },
  );
  await page.keyboard.up("ControlRight");
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
  await page.keyboard.press("Control+,");
  const select = page.getByRole("combobox", { name: "Workspace control key" });
  await expect(select).toHaveValue("ControlRight");
  await expect(
    select.getByRole("option", { name: /Right Alt/ }),
  ).toHaveAttribute("disabled", "");
  await select.selectOption({ label: "Left Alt" });
  await expect(page.getByRole("note")).toContainText("Left Alt+arrows");
  await page.getByRole("button", { name: "Done" }).click();
  await page.keyboard.down("Alt");
  await expect(page.locator(".layout")).toHaveClass(/control/);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.locator(".layout")).not.toHaveClass(/control/);
  await page.keyboard.up("Alt");
  await page.keyboard.press("Alt+k");
  await expect(
    page.getByRole("dialog", { name: "Add to workspace" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // Right Ctrl is now an ordinary Ctrl for the editor.
  await page.keyboard.press("ControlRight+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("only Right Ctrl+K and Right Ctrl+arrows belong to the workspace", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".status")).toContainText("Right Ctrl+K launcher");
  await add(page);
  await add(page, "split");
  const editor = page.locator("[data-panel]").last().locator(".cm-content");
  await editor.click();
  await page.keyboard.type("one two");
  // Left Ctrl+K stays with the editor; no launcher opens.
  await page.keyboard.press("Control+k");
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
  await page.keyboard.press("ControlRight+k");
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
