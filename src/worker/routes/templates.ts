import { asc, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { TemplateSummary } from "../../shared/schemas/template";
import { schema } from "../db/client";
import type { AppEnv } from "../env";

const { templates } = schema;

/**
 * Templates, mounted at /api/templates. This unit only lists them for pickers.
 * The template editor (U10) adds the write routes.
 */
export const templateRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const items: TemplateSummary[] = await c.var.db
    .select({
      id: templates.id,
      name: templates.name,
      layout: templates.layout,
      archivedAt: templates.archivedAt,
    })
    .from(templates)
    .where(isNull(templates.archivedAt))
    .orderBy(asc(templates.name));
  return c.json({ items });
});
