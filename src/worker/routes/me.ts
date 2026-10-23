import { Hono } from "hono";
import type { AppEnv } from "../env";

/** GET /api/me: the signed-in team member. */
export const meRoutes = new Hono<AppEnv>().get("/", (c) => c.json({ user: c.var.user }));
