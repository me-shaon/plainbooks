import { asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { type TaxRate, taxRateInput, taxRateUpdateInput } from "../../shared/schemas/tax-rate";
import { requireOwner } from "../auth/middleware";
import { type Db, schema } from "../db/client";
import type { AppEnv } from "../env";
import { AppError, parseJson } from "../errors";

const { taxRates } = schema;

export const taxRateColumns = {
  id: taxRates.id,
  name: taxRates.name,
  rate: taxRates.rate,
  note: taxRates.note,
  archivedAt: taxRates.archivedAt,
};

async function findTaxRate(db: Db, id: string): Promise<TaxRate> {
  const [rate] = await db.select(taxRateColumns).from(taxRates).where(eq(taxRates.id, id));
  if (!rate) throw new AppError(404, "tax_rate_not_found", "This tax rate does not exist");
  return rate;
}

async function setArchived(db: Db, id: string, archived: boolean): Promise<TaxRate> {
  await findTaxRate(db, id);
  const now = Date.now();
  const [rate] = await db
    .update(taxRates)
    .set({ archivedAt: archived ? now : null, updatedAt: now })
    .where(eq(taxRates.id, id))
    .returning(taxRateColumns);
  return rate as TaxRate;
}

/**
 * Tax rates, mounted at /api/tax-rates. Everyone can read them. Only an Owner can change
 * them (R38). Rates are archived, not deleted, because documents refer to them.
 * `?archived=include` adds archived rates to the list.
 */
export const taxRateRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const includeArchived = c.req.query("archived") === "include";
    const items: TaxRate[] = await c.var.db
      .select(taxRateColumns)
      .from(taxRates)
      .where(includeArchived ? undefined : isNull(taxRates.archivedAt))
      .orderBy(asc(taxRates.name));
    return c.json({ items });
  })
  .post("/", requireOwner, async (c) => {
    const data = await parseJson(c, taxRateInput);
    const [rate] = await c.var.db.insert(taxRates).values(data).returning(taxRateColumns);
    return c.json(rate, 201);
  })
  .patch("/:id", requireOwner, async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    const data = await parseJson(c, taxRateUpdateInput);
    await findTaxRate(db, id);
    if (Object.keys(data).length > 0) {
      await db
        .update(taxRates)
        .set({ ...data, updatedAt: Date.now() })
        .where(eq(taxRates.id, id));
    }
    return c.json(await findTaxRate(db, id));
  })
  .post("/:id/archive", requireOwner, async (c) =>
    c.json(await setArchived(c.var.db, c.req.param("id"), true)),
  )
  .post("/:id/restore", requireOwner, async (c) =>
    c.json(await setArchived(c.var.db, c.req.param("id"), false)),
  );
