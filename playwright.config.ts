import { defineConfig, devices } from "@playwright/test";
import { E2E_SERVERS, E2E_STORAGE_STATE, type E2EServer, e2eBaseUrl } from "./e2e/env";

/**
 * End-to-end tests against `vite dev` in E2E mode (see vite.config.ts and e2e/env.ts):
 * fixed test secrets, fake email, Frankfurter, and Browser Run. Two servers run, each with
 * its own local D1 in .wrangler/e2e. `pnpm e2e:db` resets both before the first server
 * starts. Playwright starts the servers one after the other, then runs global setup.
 */
function server(name: E2EServer, command: string) {
  const port = E2E_SERVERS[name];
  return {
    command: `${command}vite --port ${port} --strictPort`,
    url: `${e2eBaseUrl(name)}/api/health`,
    env: { E2E: "1", E2E_STATE: name },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore" as const,
    stderr: "pipe" as const,
  };
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Creates the Owner on the `main` server and saves the signed-in state.
  globalSetup: "./e2e/global-setup.ts",
  use: {
    trace: "retain-on-failure",
  },
  projects: [
    {
      // The smoke spec runs signed in as the Owner.
      name: "smoke",
      testMatch: "smoke.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: e2eBaseUrl("main"),
        storageState: E2E_STORAGE_STATE,
      },
    },
    {
      // Setup, sign-in, and invites start from an empty database on their own server.
      name: "auth",
      testMatch: "auth.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: e2eBaseUrl("auth") },
    },
  ],
  webServer: [server("main", "node --run e2e:db && "), server("auth", "")],
});
