import { Hono } from "hono";
import type { AppEnv } from "../env";
import { clientRoutes } from "./clients";
import { customFieldRoutes } from "./custom-fields";
import { documentRoutes } from "./documents";
import { meRoutes } from "./me";
import { settingsRoutes } from "./settings";
import { taxRateRoutes } from "./tax-rates";
import { teamRoutes } from "./team";
import { templateRoutes } from "./templates";
import { webhookRoutes } from "./webhooks";

/**
 * The authenticated API, mounted at /api. Add each feature's routes here with
 * `.route("/<path>", <feature>Routes)`. Owner-only routes add `requireOwner`.
 */
export const api = new Hono<AppEnv>()
  .get("/health", (c) => c.json({ ok: true }))
  .route("/me", meRoutes)
  .route("/clients", clientRoutes)
  .route("/documents", documentRoutes)
  .route("/tax-rates", taxRateRoutes)
  .route("/templates", templateRoutes)
  .route("/custom-fields", customFieldRoutes)
  .route("/settings", settingsRoutes)
  .route("/team", teamRoutes)
  .route("/webhooks", webhookRoutes);

export type Api = typeof api;
