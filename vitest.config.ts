import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(
    fileURLToPath(new URL("./migrations", import.meta.url)),
  );

  return {
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  RESEND_API_KEY: "re_test_key",
                  APP_URL: "https://invoices.example.com",
                  // 32 bytes as base64. Tests that change the key pass their own value.
                  ENCRYPTION_KEY: btoa("test-encryption-key-0123456789ab"),
                  AUTH_SECRET: "test-auth-secret-0123456789abcdef0123456789",
                  PBKDF2_ITERATIONS: "100000",
                  // 32 characters or more. Setup tests pass their own value per test.
                  SETUP_TOKEN: "test-setup-token-0123456789abcdef0123",
                  // A local .dev.vars may turn the fakes on. Tests install their own stubs.
                  FAKE_EXTERNALS: "0",
                },
                assets: {
                  directory: fileURLToPath(new URL("./test/fixtures/assets", import.meta.url)),
                  binding: "ASSETS",
                  assetConfig: { not_found_handling: "single-page-application" },
                },
              },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/**/*.test.ts"],
            setupFiles: ["./test/apply-migrations.ts", "./test/drain-run-soon.ts"],
            // Route tests create real sessions and hit local D1; under machine load they can pass 5 s.
            testTimeout: 15_000,
          },
        },
        {
          plugins: [react()],
          test: {
            name: "web",
            environment: "happy-dom",
            include: ["src/**/*.test.{ts,tsx}"],
            passWithNoTests: true,
          },
        },
      ],
    },
  };
});
