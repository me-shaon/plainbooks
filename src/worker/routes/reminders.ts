import { Hono } from "hono";
import { reminderModeInput } from "../../shared/schemas/reminder";
import type { AppEnv } from "../env";
import { parseJson } from "../errors";
import { getDocumentDetail } from "../services/documents";
import {
  listSuggestions,
  reminderStatus,
  sendReminder,
  setReminderMode,
} from "../services/reminders";

/** Mounted at /api/reminders: the dashboard "needs reminder" list. */
export const reminderRoutes = new Hono<AppEnv>().get("/suggestions", async (c) =>
  c.json({ items: await listSuggestions(c.var.db, Date.now()) }),
);

/**
 * Mounted at /api/documents next to the document routes: the reminder panel, a manual
 * reminder, and the reminder mode of a sent invoice. Auto-send is Owner only (R55).
 */
export const reminderDocumentRoutes = new Hono<AppEnv>()
  .get("/:id/reminders", async (c) =>
    c.json(await reminderStatus(c.var.db, c.req.param("id"), Date.now())),
  )
  .post("/:id/remind", async (c) => {
    const now = Date.now();
    const result = await sendReminder(c.env, c.var.db, c.req.param("id"), {
      actor: c.var.user,
      now,
      trigger: "manual",
    });
    return c.json({ ...result, status: await reminderStatus(c.var.db, c.req.param("id"), now) });
  })
  .patch("/:id/reminder-mode", async (c) => {
    const input = await parseJson(c, reminderModeInput);
    const now = Date.now();
    await setReminderMode(c.var.db, c.req.param("id"), input.reminderMode, {
      actor: c.var.user,
      now,
    });
    return c.json(await getDocumentDetail(c.var.db, c.req.param("id"), { now }));
  });
