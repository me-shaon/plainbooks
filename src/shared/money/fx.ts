// Conversion to the home currency with exact decimal rates (no floating point).
import { getExponent } from "./currency";
import { formatScaled, MoneyError, parseScaled, roundDiv, toSafeNumber } from "./decimal";
import type { DocumentTotals, TaxTotal } from "./totals";

/** Rates allow up to 8 decimals. */
export const RATE_DECIMALS = 8;
export const RATE_SCALE = 10 ** RATE_DECIMALS;

/**
 * Validates a rate ("128.50") and returns its canonical string ("128.5").
 * A rate is the number of `to` currency units for one `from` currency unit.
 */
export function normalizeRate(rate: string): string {
  const scaled = parseRateScaled(rate);
  const text = formatScaled(scaled, RATE_DECIMALS);
  return text.replace(/\.?0+$/, "");
}

/** Returns the rate as an integer scaled by RATE_SCALE (for storage next to the string). */
export function rateToScaled(rate: string): number {
  return toSafeNumber(parseRateScaled(rate), "Rate");
}

function parseRateScaled(rate: string): bigint {
  if (typeof rate !== "string") throw new MoneyError("Rate must be a decimal string");
  const scaled = parseScaled(rate, RATE_DECIMALS, "rate");
  if (scaled <= 0n) throw new MoneyError("Rate must be greater than zero");
  return scaled;
}

/**
 * Converts minor units of `from` into minor units of `to` at `rate`.
 * Rounds once, half away from zero.
 */
export function convertMinor(amount: number, from: string, to: string, rate: string): number {
  if (!Number.isSafeInteger(amount)) throw new MoneyError("Amount must be an integer");
  const fromExp = getExponent(from);
  const toExp = getExponent(to);
  const scaled = parseRateScaled(rate);
  if (from === to && scaled !== BigInt(RATE_SCALE)) {
    throw new MoneyError("The rate between a currency and itself must be 1");
  }
  // amount / 10^fromExp * (scaled / 10^RATE_DECIMALS) * 10^toExp
  const numerator = BigInt(amount) * scaled * 10n ** BigInt(toExp);
  const denominator = 10n ** BigInt(fromExp + RATE_DECIMALS);
  return toSafeNumber(roundDiv(numerator, denominator), "Converted amount");
}

export interface ConvertedTotals {
  currency: string;
  rate: string;
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
  taxes: TaxTotal[];
}

/**
 * Converts document totals to the home currency. Each figure is converted from its
 * document-currency value and rounded once, so per-line rounding never accumulates.
 * Converted tax rows can differ from the converted tax total by rounding.
 */
export function convertTotals(
  totals: DocumentTotals,
  from: string,
  to: string,
  rate: string,
): ConvertedTotals {
  const convert = (value: number) => convertMinor(value, from, to, rate);
  return {
    currency: to,
    rate: normalizeRate(rate),
    subtotal: convert(totals.subtotal),
    discount: convert(totals.discount),
    taxTotal: convert(totals.taxTotal),
    total: convert(totals.total),
    taxes: totals.taxes.map((row) => ({
      ...row,
      taxable: convert(row.taxable),
      tax: convert(row.tax),
    })),
  };
}
