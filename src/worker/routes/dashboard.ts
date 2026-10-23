import { Hono } from "hono";
import { requireOwner } from "../auth/middleware";
import type { AppEnv } from "../env";
import {
  dismissAllNotifications,
  dismissNotification,
  getDashboard,
  listNotifications,
} from "../services/dashboard";
import { retryFailedJob, runJobSoon } from "../services/jobs";

/** Mounted at /api/dashboard: the overview aggregate. `?recent=` filters the table. */
export const dashboardRoutes = new Hono<AppEnv>().get("/", async (c) =>
  c.json(await getDashboard(c.var.db, { recent: c.req.query("recent") }, { now: Date.now() })),
);

/** Mounted at /api/notifications. Every team member sees and dismisses the same list. */
export const notificationRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listNotifications(c.var.db, c.req.query())))
  .post("/dismiss-all", async (c) =>
    c.json({ dismissed: await dismissAllNotifications(c.var.db, Date.now()) }),
  )
  .post("/:id/dismiss", async (c) => {
    await dismissNotification(c.var.db, c.req.param("id"), Date.now());
    return c.json({ ok: true });
  });

/** Mounted at /api/jobs. Retrying a failed background job is Owner only. */
export const jobRoutes = new Hono<AppEnv>().post("/:id/retry", requireOwner, async (c) => {
  const job = await retryFailedJob(c.var.db, c.req.param("id"), Date.now());
  try {
    runJobSoon(c.executionCtx, c.env, job.id);
  } catch {
    // No execution context (tests). The next cron tick runs the job.
  }
  return c.json({ id: job.id, status: job.status });
});
