import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false,
  use: { baseURL: 'http://localhost:1420', browserName: 'chromium', channel: 'msedge', headless: true, viewport: { width: 1200, height: 800 } },
  webServer: { command: 'npm.cmd run dev', url: 'http://localhost:1420', reuseExistingServer: !process.env.CI },
});
