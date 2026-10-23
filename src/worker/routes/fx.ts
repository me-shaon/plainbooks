import { Hono } from "hono";
import { z } from "zod";
import { currencyCode } from "../../shared/schemas/client";
import type { FxQuote } from "../../shared/schemas/document";
import { isoDate } from "../../shared/schemas/document";
import type { AppEnv } from "../env";
import { AppError } from "../errors";
import { fxFetcher } from "../externals";
import { loadWorkspace } from "../services/documents";
import { getRate } from "../services/fx";

const rateQuery = z.object({ currency: currencyCode, date: isoDate });

/**
 * Exchange rates for the editor's FX panel, mounted at /api/fx. GET /rate?currency&date
 * returns the rate to the home currency that a send on that issue date would use.
 */
export const fxRoutes = new Hono<AppEnv>().get("/rate", async (c) => {
  const parsed = rateQuery.safeParse(c.req.query());
  if (!parsed.success) {
    throw new AppError(400, "invalid_query", "Use a supported currency and a YYYY-MM-DD date");
  }
  const ws = await loadWorkspace(c.var.db);
  const result = await getRate(c.var.db, fxFetcher(c.env), {
    from: parsed.data.currency,
    to: ws.homeCurrency,
    date: parsed.data.date,
  });
  const body: FxQuote =
    result.status === "ok"
      ? { status: "ok", rate: result.rate, rateDate: result.rateDate, provider: result.provider }
      : { status: "manual_required", message: result.message };
  return c.json(body);
});
