import { defineConfig, devices } from "@playwright/test";
// HEXSHIFT_PORT lets the tests run beside another server already using 4173.
const origin = `http://127.0.0.1:${Number(process.env.HEXSHIFT_PORT) || 4173}`;
export default defineConfig({
  testDir: "tests/browser",
  timeout: 45000,
  expect: { timeout: 15000 },
  fullyParallel: true,
  workers: 3,
  reporter: "list",
  use: { baseURL: origin, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node scripts/serve.mjs",
    url: origin,
    reuseExistingServer: !process.env.CI,
  },
});
