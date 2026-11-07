import { expect, type Page } from "@playwright/test";

/** Closes Workspace Settings after its Save finished; Save itself leaves them open. */
export async function closeSettings(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Workspace settings" });
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
