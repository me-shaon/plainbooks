// Shared values for the end-to-end run: vite.config.ts, playwright.config.ts, and the specs.
// The secrets are fixed test values. They protect nothing.

/** The setup token of every E2E server. */
export const E2E_SETUP_TOKEN = "e2e-setup-token-0123456789abcdefghij";

/** One server per database. `main` runs the smoke spec, `auth` the setup and invite spec. */
export const E2E_SERVERS = { main: 5197, auth: 5198 } as const;
export type E2EServer = keyof typeof E2E_SERVERS;

export function e2eBaseUrl(server: E2EServer): string {
  return `http://localhost:${E2E_SERVERS[server]}`;
}

/** The Owner that global setup creates on the `main` server. */
export const E2E_OWNER = {
  name: "Erin Owner",
  email: "owner@example.com",
  password: "e2e owner passphrase",
} as const;

/** The signed-in browser state that global setup saves for the smoke spec. */
export const E2E_STORAGE_STATE = "test-results/.auth/owner.json";

/** The Worker vars of an E2E server. Values in `.dev.vars` must not change them. */
export function e2eVars(server: E2EServer): Record<string, string> {
  return {
    APP_ENV: "development",
    APP_URL: e2eBaseUrl(server),
    FAKE_EXTERNALS: "1",
    SETUP_TOKEN: E2E_SETUP_TOKEN,
    AUTH_SECRET: "e2e-auth-secret-0123456789abcdefghijklmnop",
    // 32 bytes as base64, the ENCRYPTION_KEY format.
    ENCRYPTION_KEY: btoa("e2e-encryption-key-0123456789abc"),
  };
}
