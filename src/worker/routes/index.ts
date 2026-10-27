import { Hono } from "hono";
import type { AppEnv } from "../env";
import { clientRoutes } from "./clients";
import { customFieldRoutes } from "./custom-fields";
import { dashboardRoutes, jobRoutes, notificationRoutes } from "./dashboard";
import { documentRoutes } from "./documents";
import { emailSettingsRoutes } from "./email-settings";
import { fxRoutes } from "./fx";
import { meRoutes } from "./me";
import { recurringRoutes } from "./recurring";
import { reminderDocumentRoutes, reminderRoutes } from "./reminders";
import { reportRoutes } from "./reports";
import { settingsRoutes } from "./settings";
import { setupRoutes } from "./setup";
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
  .route("/setup", setupRoutes)
  .route("/dashboard", dashboardRoutes)
  .route("/notifications", notificationRoutes)
  .route("/jobs", jobRoutes)
  .route("/clients", clientRoutes)
  .route("/documents", documentRoutes)
  .route("/documents", reminderDocumentRoutes)
  .route("/reminders", reminderRoutes)
  .route("/fx", fxRoutes)
  .route("/recurring", recurringRoutes)
  .route("/reports", reportRoutes)
  .route("/tax-rates", taxRateRoutes)
  .route("/templates", templateRoutes)
  .route("/custom-fields", customFieldRoutes)
  .route("/settings/email", emailSettingsRoutes)
  .route("/settings", settingsRoutes)
  .route("/team", teamRoutes)
  .route("/webhooks", webhookRoutes);

export type Api = typeof api;
