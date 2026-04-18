import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.ADMIN_CONTENT_E2E_PORT || "4173", 10);

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    command: `node scripts/test/admin-content-static-server.mjs`,
    port,
    reuseExistingServer: true,
    timeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
