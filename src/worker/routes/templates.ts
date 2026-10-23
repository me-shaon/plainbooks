import { Hono } from "hono";
import { templateCreateInput, templateUpdateInput } from "../../shared/schemas/template";
import { requireOwner } from "../auth/middleware";
import type { AppEnv } from "../env";
import { parseJson } from "../errors";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  setDefaultTemplate,
  updateTemplate,
} from "../services/templates";

/**
 * Templates, mounted at /api/templates. Everyone reads them. Only an Owner creates,
 * renames, edits, sets the default, or deletes one (R29, R31).
 */
export const templateRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json({ items: await listTemplates(c.var.db) }))
  .post("/", requireOwner, async (c) => {
    const data = await parseJson(c, templateCreateInput);
    return c.json(await createTemplate(c.var.db, data, Date.now()), 201);
  })
  .get("/:id", async (c) => c.json(await getTemplate(c.var.db, c.req.param("id"))))
  .patch("/:id", requireOwner, async (c) => {
    const data = await parseJson(c, templateUpdateInput);
    return c.json(await updateTemplate(c.var.db, c.req.param("id"), data, Date.now()));
  })
  .post("/:id/default", requireOwner, async (c) =>
    c.json(await setDefaultTemplate(c.var.db, c.req.param("id"), Date.now())),
  )
  .delete("/:id", requireOwner, async (c) => {
    await deleteTemplate(c.var.db, c.req.param("id"));
    return c.body(null, 204);
  });
