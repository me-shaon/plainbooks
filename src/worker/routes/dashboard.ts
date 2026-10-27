import { type Context, Hono } from "hono";
import { requireOwner } from "../auth/middleware";
import type { AppEnv } from "../env";
import {
  dismissAllNotifications,
  dismissNotification,
  getDashboard,
  listNotifications,
} from "../services/dashboard";
import { listReviewJobs, markReviewedSent, sendReviewedAgain } from "../services/email-review";
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

/** Runs a queued job after the response. Without an execution context (tests), the tick does. */
function runSoon(c: Context<AppEnv>, jobId: string): void {
  try {
    runJobSoon(c.executionCtx, c.env, jobId);
  } catch {
    // No execution context (tests). The next cron tick runs the job.
  }
}

/**
 * Mounted at /api/jobs. Every member sees the emails that need review. Retrying a failed
 * job and resolving a needs-review email are Owner only.
 */
export const jobRoutes = new Hono<AppEnv>()
  .get("/needs-review", async (c) => c.json({ items: await listReviewJobs(c.var.db) }))
  .post("/:id/retry", requireOwner, async (c) => {
    const job = await retryFailedJob(c.var.db, c.req.param("id"), Date.now());
    runSoon(c, job.id);
    return c.json({ id: job.id, status: job.status });
  })
  .post("/:id/mark-sent", requireOwner, async (c) => {
    await markReviewedSent(c.var.db, c.req.param("id"), { actor: c.var.user, now: Date.now() });
    return c.json({ id: c.req.param("id"), status: "done" });
  })
  .post("/:id/send-again", requireOwner, async (c) => {
    const id = await sendReviewedAgain(c.var.db, c.req.param("id"), {
      actor: c.var.user,
      now: Date.now(),
    });
    runSoon(c, id);
    return c.json({ id, status: "pending" });
  });
