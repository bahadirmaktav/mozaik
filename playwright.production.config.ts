import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/production",
  use: {
    baseURL: "http://localhost:1422",
    browserName: "chromium",
    channel: process.platform === "win32" ? "msedge" : undefined,
  },
  webServer: {
    command: `${process.platform === "win32" ? "npm.cmd" : "npm"} run preview -- --port 1422 --strictPort`,
    url: "http://localhost:1422",
  },
});
