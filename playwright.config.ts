import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:1420",
    browserName: "chromium",
    channel: process.platform === "win32" ? "msedge" : undefined,
    headless: true,
    viewport: { width: 1200, height: 800 },
    // CI keeps a failed test's trace for the uploaded test-results artifact.
    trace: process.env.CI ? "retain-on-failure" : "off",
  },
  webServer: {
    command: `${process.platform === "win32" ? "npm.cmd" : "npm"} run dev`,
    url: "http://localhost:1420",
    reuseExistingServer: !process.env.CI,
  },
});
