import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { FxProvider } from "../../shared/domain";
import {
  HOME_CURRENCY,
  isCurrencyCode,
  normalizeRate,
  RATE_DECIMALS,
  rateToScaled,
} from "../../shared/money";
import { type Db, schema } from "../db/client";

export const FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v2";
export const FX_TIMEOUT_MS = 5000;

/** Any fetch-compatible function. Pass `fetch` in production and a stub in tests. */
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export interface FxRate {
  status: "ok";
  /** Canonical decimal string: one `from` unit = `rate` `to` units. */
  rate: string;
  /** `rate` scaled by RATE_SCALE, for storage next to the string. */
  rateScaled: number;
  /** The provider's effective date (on or before the requested date). */
  rateDate: string;
  provider: FxProvider;
  /** True when the rate came from the fx_rates cache. */
  cached: boolean;
}

export type FxManualReason = "unsupported" | "unavailable" | "timeout" | "invalid_response";

/** The rate could not be fetched. The editor asks the user for a rate before send. */
export interface FxManualRequired {
  status: "manual_required";
  reason: FxManualReason;
  message: string;
}

export type FxResult = FxRate | FxManualRequired;

export interface GetRateInput {
  from: string;
  to?: string;
  /** ISO date (YYYY-MM-DD), usually the issue date in the workspace timezone. */
  date: string;
  timeoutMs?: number;
  /** Current time in ms. Only used to decide whether a rate is final. Defaults to Date.now(). */
  now?: number;
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

const frankfurterRate = z.object({
  date: z.string().regex(isoDate),
  base: z.string(),
  quote: z.string(),
  rate: z.number().positive().finite(),
});

/**
 * Returns the exchange rate from `from` to `to` (BDT by default) for `date`: the latest
 * published rate on or before that date. Reads the fx_rates cache first. Never throws for
 * provider problems: it returns `{ status: "manual_required" }` instead.
 */
export async function getRate(db: Db, fetcher: Fetcher, input: GetRateInput): Promise<FxResult> {
  const from = input.from.toUpperCase();
  const to = (input.to ?? HOME_CURRENCY).toUpperCase();
  const { date } = input;
  if (!isoDate.test(date)) throw new TypeError(`Invalid date: ${date}`);

  if (from === to) {
    return {
      status: "ok",
      rate: "1",
      rateScaled: rateToScaled("1"),
      rateDate: date,
      provider: "identity",
      cached: false,
    };
  }
  if (!isCurrencyCode(from) || !isCurrencyCode(to)) {
    return manual("unsupported", `${from} to ${to} is not a supported currency pair`);
  }

  const [hit] = await db
    .select()
    .from(schema.fxRates)
    .where(
      and(
        eq(schema.fxRates.base, from),
        eq(schema.fxRates.quote, to),
        eq(schema.fxRates.requestedDate, date),
      ),
    )
    .limit(1);
  if (hit) {
    return {
      status: "ok",
      rate: hit.rate,
      rateScaled: hit.rateScaled,
      rateDate: hit.rateDate,
      provider: hit.provider,
      cached: true,
    };
  }

  const signal = AbortSignal.timeout(input.timeoutMs ?? FX_TIMEOUT_MS);
  let fetched = await fetchFrankfurter(fetcher, from, to, date, signal);
  // A date after the latest publication returns 404. Fall back to the latest rate.
  if (fetched.kind === "not_found")
    fetched = await fetchFrankfurter(fetcher, from, to, null, signal);
  if (fetched.kind !== "ok") return fetched.result;

  const { body } = fetched;
  if (body.base !== from || body.quote !== to) {
    return manual("invalid_response", "The exchange rate provider returned a different pair");
  }
  if (body.date > date) {
    return manual("unavailable", "No rate is published on or before this date");
  }
  let rate: string;
  try {
    rate = normalizeRate(body.rate.toFixed(RATE_DECIMALS));
  } catch {
    return manual("invalid_response", "The exchange rate provider returned an invalid rate");
  }
  const result: FxRate = {
    status: "ok",
    rate,
    rateScaled: rateToScaled(rate),
    rateDate: body.date,
    provider: "frankfurter",
    cached: false,
  };

  // Cache only final rates. A rate for today may still be replaced by a later publication.
  const today = new Date(input.now ?? Date.now()).toISOString().slice(0, 10);
  if (body.date === date || date < today) {
    await db
      .insert(schema.fxRates)
      .values({
        base: from,
        quote: to,
        requestedDate: date,
        rateDate: result.rateDate,
        rate: result.rate,
        rateScaled: result.rateScaled,
        provider: result.provider,
      })
      .onConflictDoNothing();
  }
  return result;
}

/** Builds the stored form of a rate that the user typed in. Throws MoneyError if invalid. */
export function manualRate(rate: string, date: string): FxRate {
  const normalized = normalizeRate(rate);
  return {
    status: "ok",
    rate: normalized,
    rateScaled: rateToScaled(normalized),
    rateDate: date,
    provider: "manual",
    cached: false,
  };
}

type FetchOutcome =
  | { kind: "ok"; body: z.infer<typeof frankfurterRate> }
  | { kind: "not_found"; result: FxManualRequired }
  | { kind: "failed"; result: FxManualRequired };

async function fetchFrankfurter(
  fetcher: Fetcher,
  from: string,
  to: string,
  date: string | null,
  signal: AbortSignal,
): Promise<FetchOutcome> {
  const url = `${FRANKFURTER_BASE_URL}/rate/${from}/${to}${date ? `?date=${date}` : ""}`;
  let res: Response;
  try {
    res = await fetcher(url, { signal, headers: { accept: "application/json" } });
  } catch (err) {
    const timedOut = signal.aborted || (err instanceof Error && err.name === "TimeoutError");
    return {
      kind: "failed",
      result: timedOut
        ? manual("timeout", "The exchange rate provider did not answer in time")
        : manual("unavailable", "The exchange rate provider could not be reached"),
    };
  }
  if (res.status === 404 && date) {
    await res.body?.cancel();
    return {
      kind: "not_found",
      result: manual("unavailable", "No rate is published for this date"),
    };
  }
  if (res.status === 422) {
    await res.body?.cancel();
    return {
      kind: "failed",
      result: manual("unsupported", `The provider has no ${from} to ${to} rate`),
    };
  }
  if (!res.ok) {
    await res.body?.cancel();
    return {
      kind: "failed",
      result: manual("unavailable", `The exchange rate provider returned ${res.status}`),
    };
  }
  const parsed = frankfurterRate.safeParse(await res.json().catch(() => null));
  if (!parsed.success) {
    return {
      kind: "failed",
      result: manual(
        "invalid_response",
        "The exchange rate provider returned an unexpected response",
      ),
    };
  }
  return { kind: "ok", body: parsed.data };
}

function manual(reason: FxManualReason, message: string): FxManualRequired {
  return { status: "manual_required", reason, message };
}
