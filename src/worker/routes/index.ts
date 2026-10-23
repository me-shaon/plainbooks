import { Hono } from "hono";
import type { AppEnv } from "../env";
import { meRoutes } from "./me";

/**
 * The authenticated API, mounted at /api. Add each feature's routes here with
 * `.route("/<path>", <feature>Routes)`. Owner-only routes add `requireOwner`.
 */
export const api = new Hono<AppEnv>()
  .get("/health", (c) => c.json({ ok: true }))
  .route("/me", meRoutes);

export type Api = typeof api;
