import { existsSync, readFileSync } from "node:fs";
import { cloudflare, type PluginConfig } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { type E2EServer, e2eVars } from "./e2e/env.ts";

/** The E2E server that this process serves. */
function e2eServer(): E2EServer {
  return process.env.E2E_STATE === "auth" ? "auth" : "main";
}

/**
 * `vite` (dev only) sets APP_ENV=development, so the Worker accepts the local origin and
 * FAKE_EXTERNALS. The secrets come from `.dev.vars`. The build output never gets these
 * values, so a deploy keeps `APP_ENV=production`.
 */
const DEV_VARS: Record<string, string> = {
  APP_ENV: "development",
};

/**
 * `E2E=1 vite` serves the app for the Playwright tests (playwright.config.ts). `E2E_STATE`
 * names the server (e2e/env.ts). Each server gets its own local state directory,
 * `.wrangler/e2e/<server>`, fixed test secrets, and fake external services.
 */
function e2ePluginConfig(server: E2EServer): PluginConfig {
  const vars = e2eVars(server);
  // Values in .dev.vars win over config vars, so a conflicting .dev.vars would break the run.
  if (existsSync(".dev.vars")) {
    const conflicts = readFileSync(".dev.vars", "utf8")
      .split("\n")
      .flatMap((line) => {
        const [, key = "", value] = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/) ?? [];
        return key in vars && vars[key] !== value ? [key] : [];
      });
    if (conflicts.length) {
      throw new Error(`E2E: .dev.vars overrides ${conflicts.join(", ")}. Remove or align them.`);
    }
  }
  return {
    persistState: { path: `.wrangler/e2e/${server}` },
    inspectorPort: false,
    config: (config) => ({ vars: { ...config.vars, ...vars } }),
  };
}

/**
 * `pnpm run ship` sets WRANGLER_CONFIG to its generated wrangler.production.jsonc.
 */
function pluginConfig(command: "build" | "serve", isPreview: boolean): PluginConfig {
  const configPath = process.env.WRANGLER_CONFIG;
  if (process.env.E2E === "1") return e2ePluginConfig(e2eServer());
  if (command === "serve" && !isPreview) {
    return { configPath, config: (config) => ({ vars: { ...config.vars, ...DEV_VARS } }) };
  }
  return { configPath };
}

export default defineConfig(({ command, isPreview = false }) => ({
  // Two E2E servers run at the same time. Separate caches keep their dependency scans apart.
  cacheDir: process.env.E2E === "1" ? `node_modules/.vite-e2e-${e2eServer()}` : undefined,
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
