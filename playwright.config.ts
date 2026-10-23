import { defineConfig, devices } from "@playwright/test";

const PORT = 5197;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end tests against `vite dev` in E2E mode (see vite.config.ts): the dev auth bypass,
 * fake Resend, Frankfurter, and Browser Run, and a separate local D1 in .wrangler/e2e.
 * `pnpm e2e:db` resets that D1 and applies the migrations before the server starts.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm e2e:db && vite --port ${PORT} --strictPort`,
    url: `${BASE_URL}/api/health`,
    env: { E2E: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
