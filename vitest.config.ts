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
