import { existsSync, readFileSync } from "node:fs";
import { cloudflare, type PluginConfig } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * `E2E=1 vite` serves the app for the Playwright tests (playwright.config.ts). It uses its
 * own local state directory, the dev auth bypass, and fake external services.
 */
const E2E_VARS: Record<string, string> = {
  APP_ENV: "development",
  DEV_USER_EMAIL: "owner@example.com",
  OWNER_EMAIL: "owner@example.com",
  FAKE_EXTERNALS: "1",
  RESEND_API_KEY: "re_fake_e2e",
  RESEND_WEBHOOK_SECRET: "whsec_ZmFrZS1lMmUtd2ViaG9vay1zZWNyZXQ=",
};

/**
 * `vite` (dev only) turns on the dev auth bypass. `.dev.vars` can override these values.
 * The build output never gets them, so a deploy keeps `APP_ENV=production`.
 */
const DEV_VARS: Record<string, string> = {
  APP_ENV: "development",
  DEV_USER_EMAIL: "owner@example.com",
};

function e2ePluginConfig(): PluginConfig {
  // Values in .dev.vars win over config vars, so a conflicting .dev.vars would break the run.
  if (existsSync(".dev.vars")) {
    const conflicts = readFileSync(".dev.vars", "utf8")
      .split("\n")
      .flatMap((line) => {
        const [, key = "", value] = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/) ?? [];
        return key in E2E_VARS && E2E_VARS[key] !== value ? [key] : [];
      });
    if (conflicts.length) {
      throw new Error(`E2E: .dev.vars overrides ${conflicts.join(", ")}. Remove or align them.`);
    }
  }
  return {
    persistState: { path: ".wrangler/e2e" },
    inspectorPort: false,
    config: (config) => ({ vars: { ...config.vars, ...E2E_VARS } }),
  };
}

/**
 * `pnpm run ship` sets WRANGLER_CONFIG to its generated wrangler.production.jsonc.
 */
function pluginConfig(command: "build" | "serve", isPreview: boolean): PluginConfig {
  const configPath = process.env.WRANGLER_CONFIG;
  if (process.env.E2E === "1") return e2ePluginConfig();
  if (command === "serve" && !isPreview) {
    return { configPath, config: (config) => ({ vars: { ...config.vars, ...DEV_VARS } }) };
  }
  return { configPath };
}

export default defineConfig(({ command, isPreview = false }) => ({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/web/routes",
      generatedRouteTree: "./src/web/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    cloudflare(pluginConfig(command, isPreview)),
  ],
}));
