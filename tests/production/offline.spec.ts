import { test, expect } from "@playwright/test";

test("production workspace loads all editor assets locally", async ({
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
  await page.getByRole("button", { name: "Open launcher" }).click();
  await page.getByRole("button", { name: "New tab" }).click();
  await page.locator(".cm-content").fill("Offline editing works.");
  await expect(page.locator(".cm-content")).toHaveText(
    "Offline editing works.",
  );
  expect(external).toEqual([]);
});
