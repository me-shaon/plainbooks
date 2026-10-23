import { Hono } from "hono";
import { recurringCreateInput, recurringUpdateInput } from "../../shared/schemas/recurring";
import type { AppEnv } from "../env";
import { parseJson } from "../errors";
import {
  createSchedule,
  deleteSchedule,
  getScheduleDetail,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  updateSchedule,
} from "../services/recurring";

/**
 * Recurring schedules, mounted at /api/recurring. Owners and Members can manage them,
 * except that only an Owner can turn auto-send on or off (R55).
 */
export const recurringRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json({ items: await listSchedules(c.var.db) }))
  .post("/", async (c) => {
    const data = await parseJson(c, recurringCreateInput);
    const now = Date.now();
    const id = await createSchedule(c.var.db, data, { actor: c.var.user, now });
    return c.json(await getScheduleDetail(c.var.db, id, { now }), 201);
  })
  .get("/:id", async (c) =>
    c.json(await getScheduleDetail(c.var.db, c.req.param("id"), { now: Date.now() })),
  )
  .patch("/:id", async (c) => {
    const data = await parseJson(c, recurringUpdateInput);
    const now = Date.now();
    await updateSchedule(c.var.db, c.req.param("id"), data, { actor: c.var.user, now });
    return c.json(await getScheduleDetail(c.var.db, c.req.param("id"), { now }));
  })
  .post("/:id/pause", async (c) => {
    const now = Date.now();
    await pauseSchedule(c.var.db, c.req.param("id"), now);
    return c.json(await getScheduleDetail(c.var.db, c.req.param("id"), { now }));
  })
  .post("/:id/resume", async (c) => {
    const now = Date.now();
    await resumeSchedule(c.var.db, c.req.param("id"), { now });
    return c.json(await getScheduleDetail(c.var.db, c.req.param("id"), { now }));
  })
  .delete("/:id", async (c) => {
    await deleteSchedule(c.var.db, c.req.param("id"));
    return c.body(null, 204);
  });
