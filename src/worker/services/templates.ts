// Templates: Owner-managed layouts with section order, visibility, and custom field
// placement. Documents resolve their template at snapshot time (invoice override, then
// the client default, then the workspace default).
import { asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { TemplateConfig } from "../../shared/domain";
import {
  layoutConfig,
  normalizeTemplateConfig,
  type TemplateDetail,
  type TemplateSummary,
  type templateCreateInput,
  type templateUpdateInput,
} from "../../shared/schemas/template";
import { type Db, schema } from "../db/client";
import { AppError } from "../errors";

const { templates, workspace } = schema;

export { resolveTemplate } from "./documents";

async function defaultTemplateId(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ id: workspace.defaultTemplateId })
    .from(workspace)
    .where(eq(workspace.id, 1));
  return row?.id ?? null;
}

/** True when a document, client, recurring schedule, or the workspace uses the template. */
export async function isTemplateInUse(db: Db, id: string): Promise<boolean> {
  const row = await db.$client
    .prepare(
      `SELECT EXISTS (SELECT 1 FROM documents WHERE template_id = ?1)
           OR EXISTS (SELECT 1 FROM clients WHERE template_id = ?1)
           OR EXISTS (SELECT 1 FROM recurring_schedules WHERE template_id = ?1)
           OR EXISTS (SELECT 1 FROM workspace WHERE default_template_id = ?1) AS used`,
    )
    .bind(id)
    .first<{ used: number }>();
  return Boolean(row?.used);
}

export async function listTemplates(db: Db): Promise<TemplateSummary[]> {
  const [rows, defaultId] = await Promise.all([
    db
      .select({
        id: templates.id,
        name: templates.name,
        layout: templates.layout,
        archivedAt: templates.archivedAt,
      })
      .from(templates)
      .where(isNull(templates.archivedAt))
      .orderBy(asc(templates.name)),
    defaultTemplateId(db),
  ]);
  return rows.map((row) => ({ ...row, isDefault: row.id === defaultId }));
}

export async function getTemplate(db: Db, id: string): Promise<TemplateDetail> {
  const [row] = await db.select().from(templates).where(eq(templates.id, id));
  if (!row) throw new AppError(404, "template_not_found", "This template does not exist");
  const [defaultId, inUse] = await Promise.all([defaultTemplateId(db), isTemplateInUse(db, id)]);
  return {
    id: row.id,
    name: row.name,
    layout: row.layout,
    archivedAt: row.archivedAt,
    isDefault: row.id === defaultId,
    config: normalizeTemplateConfig(row.config),
    inUse,
  };
}

/** Creates a template from a layout, with every section visible. */
export async function createTemplate(
  db: Db,
  input: z.output<typeof templateCreateInput>,
  now: number,
): Promise<TemplateDetail> {
  const config = layoutConfig(input.layout);
  const [row] = await db
    .insert(templates)
    .values({ name: input.name, layout: input.layout, config, createdAt: now, updatedAt: now })
    .returning({ id: templates.id });
  if (!row) throw new Error("template insert failed");
  return getTemplate(db, row.id);
}

export async function updateTemplate(
  db: Db,
  id: string,
  input: z.output<typeof templateUpdateInput>,
  now: number,
): Promise<TemplateDetail> {
  await getTemplate(db, id);
  const values: { name?: string; layout?: TemplateConfig["layout"]; config?: TemplateConfig } = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.config !== undefined) {
    values.config = input.config;
    values.layout = input.config.layout;
  }
  if (Object.keys(values).length > 0) {
    await db
      .update(templates)
      .set({ ...values, updatedAt: now })
      .where(eq(templates.id, id));
  }
  return getTemplate(db, id);
}

export async function setDefaultTemplate(db: Db, id: string, now: number): Promise<TemplateDetail> {
  await getTemplate(db, id);
  await db
    .update(workspace)
    .set({ defaultTemplateId: id, updatedAt: now })
    .where(eq(workspace.id, 1));
  return getTemplate(db, id);
}

/** Deletes a template that nothing uses. Sent revisions keep their own copy of the config. */
export async function deleteTemplate(db: Db, id: string): Promise<void> {
  await getTemplate(db, id);
  if (await isTemplateInUse(db, id)) {
    throw new AppError(
      409,
      "template_in_use",
      "A document, client, schedule, or the workspace default uses this template",
    );
  }
  await db.delete(templates).where(eq(templates.id, id));
}
