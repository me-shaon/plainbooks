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
                  RESEND_WEBHOOK_SECRET: `whsec_${btoa("test-webhook-secret-0123456789ab")}`,
                  ACCESS_TEAM_DOMAIN: "your-team.cloudflareaccess.com",
                  ACCESS_AUD: "replace-with-access-application-aud",
                  OWNER_EMAIL: "owner@example.com",
                  APP_URL: "https://invoices.example.com",
                  // 32 bytes as base64. Tests that change the key pass their own value.
                  ENCRYPTION_KEY: btoa("test-encryption-key-0123456789ab"),
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
            setupFiles: ["./test/apply-migrations.ts"],
            // Route tests sign real JWTs and hit local D1; under machine load they can pass 5 s.
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
