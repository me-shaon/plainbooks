import { asc, eq } from "drizzle-orm";
import { rateToScaled } from "../../shared/money";
import type { ExchangeRates } from "../../shared/schemas/settings";
import { type Db, schema } from "../db/client";
import { AppError } from "../errors";
import { loadWorkspace } from "./settings";

const { workspaceFxRates } = schema;

/** The exchange rates the Owner set, for the current home currency. */
export async function listExchangeRates(db: Db): Promise<ExchangeRates> {
  const ws = await loadWorkspace(db);
  const rows = await db
    .select()
    .from(workspaceFxRates)
    .where(eq(workspaceFxRates.homeCurrency, ws.homeCurrency))
    .orderBy(asc(workspaceFxRates.currency));
  return {
    homeCurrency: ws.homeCurrency,
    rates: rows.map((r) => ({ currency: r.currency, rate: r.rate, updatedAt: r.updatedAt })),
  };
}

/**
 * Replaces the workspace exchange rates. Documents that already have a number keep the rate
 * they stored, so a change here only affects documents that get a number later.
 */
export async function replaceExchangeRates(
  db: Db,
  input: { rates: { currency: string; rate: string }[] },
  now: number,
): Promise<ExchangeRates> {
  const ws = await loadWorkspace(db);
  const home = input.rates.find((r) => r.currency === ws.homeCurrency);
  if (home) {
    throw new AppError(
      422,
      "invalid_exchange_rate",
      `${home.currency} is the home currency, so its exchange rate is always 1`,
    );
  }
  const existing = await db.select().from(workspaceFxRates);
  const unchanged = new Map(
    existing.filter((r) => r.homeCurrency === ws.homeCurrency).map((r) => [r.currency, r] as const),
  );
  const d1 = db.$client;
  await d1.batch([
    d1.prepare("DELETE FROM workspace_fx_rates"),
    ...input.rates.map((r) => {
      const same = unchanged.get(r.currency);
      // Keep the old time when the rate did not change, so "Updated" stays true.
      const updatedAt = same && same.rate === r.rate ? same.updatedAt : now;
      return d1
        .prepare(
          `INSERT INTO workspace_fx_rates (currency, home_currency, rate, rate_scaled, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(r.currency, ws.homeCurrency, r.rate, rateToScaled(r.rate), updatedAt);
    }),
  ]);
  return listExchangeRates(db);
}
