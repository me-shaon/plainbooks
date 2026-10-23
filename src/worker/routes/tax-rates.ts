import { asc, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { TaxRate } from "../../shared/schemas/tax-rate";
import { schema } from "../db/client";
import type { AppEnv } from "../env";

const { taxRates } = schema;

export const taxRateColumns = {
  id: taxRates.id,
  name: taxRates.name,
  rate: taxRates.rate,
  note: taxRates.note,
  archivedAt: taxRates.archivedAt,
};

/**
 * Tax rates, mounted at /api/tax-rates. Everyone can read them.
 * `?archived=include` adds archived rates.
 */
export const taxRateRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const includeArchived = c.req.query("archived") === "include";
  const items: TaxRate[] = await c.var.db
    .select(taxRateColumns)
    .from(taxRates)
    .where(includeArchived ? undefined : isNull(taxRates.archivedAt))
    .orderBy(asc(taxRates.name));
  return c.json({ items });
});
