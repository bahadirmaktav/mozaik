import { test, expect } from "@playwright/test";

test("production workspace loads editor, terminal, file manager, tasks, Excalidraw, Mermaid, Notes and IDE assets locally", async ({
  page,
}) => {
  const external: string[] = [];
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("text");
  await page.keyboard.press("Control+Enter");
  await page.locator(".cm-content").fill("Offline editing works.");
  await expect(page.locator(".cm-content")).toHaveText(
    "Offline editing works.",
  );
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("terminal");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-surface .xterm")).toBeVisible();
  await page.keyboard.press("ControlRight+k");
  await page
    .getByRole("combobox", { name: "Search tools" })
    .fill("file manager");
  await page.keyboard.press("Enter");
  await expect(page.locator(".file-manager .fm-state")).toContainText(
    "requires the Tessera desktop app",
  );
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("tasks");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".tasks .tasks-state")).toContainText(
    "requires the Tessera desktop app",
  );
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("excalidraw");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".excalidraw .excalidraw__canvas")).toHaveCount(2);
  // The hand-drawn and CJK fonts come from the app bundle, never from a CDN.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.load("20px Excalifont", "Tessera");
        await document.fonts.load("20px Xiaolai", "中文");
        return [
          document.fonts.check("20px Excalifont", "Tessera"),
          document.fonts.check("20px Xiaolai", "中文"),
        ];
      }),
    )
    .toEqual([true, true]);
  const fonts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((e) => new URL(e.name).pathname)
      .filter((path) => path.startsWith("/excalidraw/fonts/")),
  );
  expect(fonts.length).toBeGreaterThan(0);
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("mermaid");
  await page.keyboard.press("Control+Enter");
  // The renderer and every diagram type it loads are part of the bundle.
  await expect(page.locator(".diagram-svg svg")).toBeVisible();
  await page.getByRole("textbox", { name: "Mermaid source" }).click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(
    "classDiagram\n  class Offline {\n    +render()\n  }\n  Offline <|-- Local",
  );
  await expect(page.locator(".diagram-svg")).toContainText("Offline");
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("notes");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".notes .tasks-state")).toContainText(
    "requires the Tessera desktop app",
  );
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("ide");
  await page.keyboard.press("Control+Enter");
  await expect(
    page.getByRole("button", { name: "Open Folder…" }),
  ).toBeVisible();
  await page.keyboard.press("ControlRight+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("code");
  await page.keyboard.press("Control+Enter");
  const code = page.getByRole("textbox", { name: "Code Untitled" });
  await code.click();
  await page.keyboard.type("int main() { return 0; }");
  await expect(code).toContainText("int main() { return 0; }");
  expect(external).toEqual([]);
});
