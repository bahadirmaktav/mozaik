import { test, expect, type Page } from "@playwright/test";

async function openCalculator(page: Page, mode: "split" | "float" = "split") {
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("calc");
  await page.keyboard.press(mode === "float" ? "Control+Shift+Enter" : "Enter");
  // The view loads lazily; it takes keys once shown.
  await expect(page.locator(".calculator:focus")).toBeVisible();
}
const result = (page: Page) => page.locator(".calc-value:visible");
const tabs = (page: Page) => page.getByRole("tab", { name: "Calculator" });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".titlebar")).toBeVisible();
});

test("the calculator types expressions with the keyboard and its keys", async ({
  page,
}) => {
  await openCalculator(page);
  await expect(result(page)).toHaveText("0");
  await page.keyboard.type("2*(3+4)^2");
  await page.keyboard.press("Enter");
  await expect(result(page)).toHaveText("98");
  await expect(page.locator(".calc-expression")).toHaveText(
    "2 × (3 + 4) ^ 2 =",
  );

  // The on-screen keys do the same; focus stays in the panel for the keyboard.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "9", exact: true }).click();
  await page.getByRole("button", { name: "Square root" }).click();
  await expect(result(page)).toHaveText("3");
  await page.getByRole("button", { name: "Plus" }).click();
  await page.keyboard.type("1=");
  await expect(result(page)).toHaveText("4");

  // Functions by letter, in degrees.
  await page.keyboard.type("30s");
  await expect(result(page)).toHaveText("0.5");
  await page.keyboard.type("5/0=");
  await expect(result(page)).toHaveText("Cannot divide by zero");
});

test("programmer mode keeps a word size and shows every base", async ({
  page,
}) => {
  await openCalculator(page);
  await page.getByRole("button", { name: "Programmer" }).click();
  await page.getByRole("button", { name: /^HEX/ }).click();
  await page.keyboard.type("ff");
  await expect(result(page)).toHaveText("FF");
  await expect(page.getByRole("button", { name: /^DEC/ })).toContainText("255");
  await expect(page.getByRole("button", { name: /^BIN/ })).toContainText(
    "1111 1111",
  );
  // Digits of another base are disabled.
  await page.getByRole("button", { name: /^OCT/ }).click();
  await expect(
    page.getByRole("button", { name: "8", exact: true }),
  ).toBeDisabled();

  // BYTE wraps in two's complement.
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: /^Word size/ }).click();
  await expect(
    page.getByRole("button", { name: "Word size: BYTE" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^DEC/ }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.type("127+1=");
  await expect(result(page)).toHaveText("-128");
  await expect(page.getByRole("button", { name: /^HEX/ })).toContainText("80");
});

test("a calculator keeps its state across tabs and opens floating", async ({
  page,
}) => {
  await openCalculator(page);
  await page.keyboard.type("6*7=");
  await expect(result(page)).toHaveText("42");
  // A second calculator as a tab of the same panel; the first keeps its result.
  await page.keyboard.press("Control+Shift+Quote");
  await page.getByRole("combobox", { name: "Search tools" }).fill("calc");
  await page.keyboard.press("Control+Enter");
  await expect(tabs(page)).toHaveCount(2);
  await expect(result(page)).toHaveText("0");
  await tabs(page).first().click();
  await expect(result(page)).toHaveText("42");
  await expect(page.locator(".calc-list:visible")).toContainText("6 × 7 =");

  await openCalculator(page, "float");
  await expect(page.locator("[data-floating] .calculator")).toBeVisible();
});
