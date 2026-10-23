// Custom field definitions (Owner only) and their workspace and client values. Document
// values are part of the document draft (see services/documents.ts).
import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { CustomFieldScope } from "../../shared/domain";
import type {
  CustomFieldDef,
  CustomFieldValue,
  customFieldCreateInput,
  customFieldUpdateInput,
  customFieldValuesInput,
} from "../../shared/schemas/template";
import { type Db, schema } from "../db/client";
import { AppError } from "../errors";

const { customFieldDefs, customFieldValues, clients } = schema;

const defColumns = {
  id: customFieldDefs.id,
  label: customFieldDefs.label,
  type: customFieldDefs.type,
  scope: customFieldDefs.scope,
  section: customFieldDefs.section,
  sortOrder: customFieldDefs.sortOrder,
  archivedAt: customFieldDefs.archivedAt,
};

export async function listCustomFields(
  db: Db,
  opts: { includeArchived?: boolean } = {},
): Promise<CustomFieldDef[]> {
  return db
    .select(defColumns)
    .from(customFieldDefs)
    .where(opts.includeArchived ? undefined : isNull(customFieldDefs.archivedAt))
    .orderBy(asc(customFieldDefs.sortOrder), asc(customFieldDefs.createdAt));
}

async function findField(db: Db, id: string): Promise<CustomFieldDef> {
  const [row] = await db.select(defColumns).from(customFieldDefs).where(eq(customFieldDefs.id, id));
  if (!row) throw new AppError(404, "custom_field_not_found", "This custom field does not exist");
  return row;
}

export async function createCustomField(
  db: Db,
  input: z.output<typeof customFieldCreateInput>,
  now: number,
): Promise<CustomFieldDef> {
  const [row] = await db
    .insert(customFieldDefs)
    .values({ ...input, createdAt: now })
    .returning(defColumns);
  if (!row) throw new Error("custom field insert failed");
  return row;
}

export async function updateCustomField(
  db: Db,
  id: string,
  input: z.output<typeof customFieldUpdateInput>,
): Promise<CustomFieldDef> {
  await findField(db, id);
  if (Object.keys(input).length > 0) {
    await db.update(customFieldDefs).set(input).where(eq(customFieldDefs.id, id));
  }
  return findField(db, id);
}

/** Archived fields stop printing on new documents. Sent revisions keep their values. */
export async function setCustomFieldArchived(
  db: Db,
  id: string,
  archived: boolean,
  now: number,
): Promise<CustomFieldDef> {
  await findField(db, id);
  await db
    .update(customFieldDefs)
    .set({ archivedAt: archived ? now : null })
    .where(eq(customFieldDefs.id, id));
  return findField(db, id);
}

type ValueScope = Exclude<CustomFieldScope, "document">;

async function assertEntity(db: Db, scope: ValueScope, entityId: string): Promise<void> {
  if (scope === "workspace") {
    if (entityId !== "workspace") throw new AppError(404, "not_found", "Not found");
    return;
  }
  const [row] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, entityId));
  if (!row) throw new AppError(404, "client_not_found", "This client does not exist");
}

/** Values of workspace fields (entity "workspace") or of one client's fields. */
export async function getCustomFieldValues(
  db: Db,
  scope: ValueScope,
  entityId: string,
): Promise<CustomFieldValue[]> {
  await assertEntity(db, scope, entityId);
  return db
    .select({ fieldId: customFieldValues.fieldId, value: customFieldValues.value })
    .from(customFieldValues)
    .where(and(eq(customFieldValues.entityType, scope), eq(customFieldValues.entityId, entityId)));
}

/** Replaces every value of the entity. Empty values are removed. */
export async function setCustomFieldValues(
  db: Db,
  scope: ValueScope,
  entityId: string,
  input: z.output<typeof customFieldValuesInput>,
  now: number,
): Promise<CustomFieldValue[]> {
  await assertEntity(db, scope, entityId);
  const defs = await listCustomFields(db, { includeArchived: true });
  for (const item of input.values) {
    const def = defs.find((d) => d.id === item.fieldId);
    if (!def || def.scope !== scope) {
      throw new AppError(400, "invalid_custom_field", `Choose a ${scope} custom field`);
    }
  }
  const values = input.values.filter((v) => v.value !== "");
  await db.batch([
    db
      .delete(customFieldValues)
      .where(
        and(eq(customFieldValues.entityType, scope), eq(customFieldValues.entityId, entityId)),
      ),
    ...values.map((v) =>
      db.insert(customFieldValues).values({
        fieldId: v.fieldId,
        entityType: scope,
        entityId,
        value: v.value,
        updatedAt: now,
      }),
    ),
  ]);
  return getCustomFieldValues(db, scope, entityId);
}
