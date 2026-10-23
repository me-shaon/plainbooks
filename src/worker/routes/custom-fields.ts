import { Hono } from "hono";
import {
  customFieldCreateInput,
  customFieldUpdateInput,
  customFieldValuesInput,
} from "../../shared/schemas/template";
import { requireOwner } from "../auth/middleware";
import type { AppEnv } from "../env";
import { AppError, parseJson } from "../errors";
import {
  createCustomField,
  getCustomFieldValues,
  listCustomFields,
  setCustomFieldArchived,
  setCustomFieldValues,
  updateCustomField,
} from "../services/custom-fields";

function valueScope(scope: string): "workspace" | "client" {
  if (scope === "workspace" || scope === "client") return scope;
  throw new AppError(404, "not_found", "Not found");
}

/**
 * Custom fields, mounted at /api/custom-fields. Everyone reads them. Owners define them
 * and set workspace values. Members and Owners set client values.
 * `?archived=include` adds archived fields.
 */
export const customFieldRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const items = await listCustomFields(c.var.db, {
      includeArchived: c.req.query("archived") === "include",
    });
    return c.json({ items });
  })
  .post("/", requireOwner, async (c) => {
    const data = await parseJson(c, customFieldCreateInput);
    return c.json(await createCustomField(c.var.db, data, Date.now()), 201);
  })
  .get("/values/:scope/:entityId", async (c) => {
    const scope = valueScope(c.req.param("scope"));
    const items = await getCustomFieldValues(c.var.db, scope, c.req.param("entityId"));
    return c.json({ items });
  })
  .put("/values/:scope/:entityId", async (c) => {
    const scope = valueScope(c.req.param("scope"));
    if (scope === "workspace" && c.var.user.role !== "owner") {
      throw new AppError(403, "owner_required", "Only an Owner can change workspace values");
    }
    const data = await parseJson(c, customFieldValuesInput);
    const items = await setCustomFieldValues(
      c.var.db,
      scope,
      c.req.param("entityId"),
      data,
      Date.now(),
    );
    return c.json({ items });
  })
  .patch("/:id", requireOwner, async (c) => {
    const data = await parseJson(c, customFieldUpdateInput);
    return c.json(await updateCustomField(c.var.db, c.req.param("id"), data));
  })
  .post("/:id/archive", requireOwner, async (c) =>
    c.json(await setCustomFieldArchived(c.var.db, c.req.param("id"), true, Date.now())),
  )
  .post("/:id/restore", requireOwner, async (c) =>
    c.json(await setCustomFieldArchived(c.var.db, c.req.param("id"), false, Date.now())),
  );
