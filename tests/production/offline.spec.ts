import { test, expect } from "@playwright/test";

test("production workspace loads editor and terminal assets locally", async ({
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
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("text");
  await page.keyboard.press("Control+Enter");
  await page.locator(".cm-content").fill("Offline editing works.");
  await expect(page.locator(".cm-content")).toHaveText(
    "Offline editing works.",
  );
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search tools" }).fill("terminal");
  await page.keyboard.press("Enter");
  await expect(page.locator(".terminal-surface .xterm")).toBeVisible();
  expect(external).toEqual([]);
});
