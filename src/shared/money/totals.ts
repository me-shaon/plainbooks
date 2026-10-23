// Document totals: line amounts, pro-rata discount, per-line tax, and tax totals per rate.
// All amounts are integer minor units in the document currency.
import { getExponent } from "./currency";
import {
  assertMinor,
  formatScaled,
  MoneyError,
  parseScaled,
  roundDiv,
  toSafeNumber,
} from "./decimal";

export { MoneyError, roundDiv };

/** Quantities allow up to 3 decimals and are handled as thousandths. */
export const QUANTITY_DECIMALS = 3;
const QUANTITY_SCALE = 10n ** BigInt(QUANTITY_DECIMALS);

/** Percentages (discounts and tax rates) allow up to 4 decimals. */
export const PERCENT_DECIMALS = 4;
const PERCENT_SCALE = 10n ** BigInt(PERCENT_DECIMALS);
const HUNDRED_PERCENT = 100n * PERCENT_SCALE;

export interface TaxInput {
  /** Tax rate ID. Lines with the same ID group into one tax total. */
  id: string;
  name?: string;
  /** Percent as a decimal string or number, for example "19" or "7.5". */
  rate: string | number;
}

export interface LineInput {
  /** Up to 3 decimals, not negative. */
  quantity: string | number;
  /** Unit price in minor units, excluding tax. */
  unitPrice: number;
  /** At most one tax per line. */
  tax?: TaxInput | null;
}

export type DiscountInput =
  | { type: "percent"; percent: string | number }
  | { type: "fixed"; amount: number };

export interface TotalsInput {
  currency: string;
  lines: readonly LineInput[];
  discount?: DiscountInput | null;
}

export interface LineTotals {
  /** quantity x unit price, rounded. */
  amount: number;
  /** This line's share of the document discount. */
  discount: number;
  /** amount - discount. Tax is calculated on this. */
  net: number;
  tax: number;
  taxId: string | null;
}

export interface TaxTotal {
  taxId: string;
  name: string | undefined;
  /** Normalized percent string, for example "19" or "7.5". */
  rate: string;
  /** Sum of the net amounts of the lines with this tax. */
  taxable: number;
  tax: number;
}

export interface DocumentTotals {
  currency: string;
  subtotal: number;
  discount: number;
  taxTotal: number;
  total: number;
  lines: LineTotals[];
  /** One row per tax rate, in order of first use. */
  taxes: TaxTotal[];
}

/** Parses a quantity into thousandths. Throws for negatives or more than 3 decimals. */
export function parseQuantity(quantity: string | number): number {
  const scaled = parseScaled(quantity, QUANTITY_DECIMALS, "quantity");
  if (scaled < 0n) throw new MoneyError("Quantity must not be negative");
  return toSafeNumber(scaled, "Quantity");
}

/** Parses a percent into ten-thousandths of a percent. Must be between 0 and 100. */
export function parsePercent(percent: string | number, what = "percent"): bigint {
  const scaled = parseScaled(percent, PERCENT_DECIMALS, what);
  if (scaled < 0n || scaled > HUNDRED_PERCENT) {
    throw new MoneyError(`${what} must be between 0 and 100`);
  }
  return scaled;
}

/** Formats a percent as a short decimal string with no trailing zeros. */
export function normalizePercent(percent: string | number): string {
  return stripZeros(formatScaled(parsePercent(percent), PERCENT_DECIMALS));
}

function stripZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/** quantity x unit price in minor units, rounded half away from zero. */
export function lineAmount(quantity: string | number, unitPrice: number): number {
  assertMinor(unitPrice, "Unit price");
  const qty = BigInt(parseQuantity(quantity));
  return toSafeNumber(roundDiv(qty * BigInt(unitPrice), QUANTITY_SCALE), "Line amount");
}

/** Percent of an amount in minor units, rounded half away from zero. */
export function percentOf(amount: number, percent: string | number): number {
  return toSafeNumber(roundDiv(BigInt(amount) * parsePercent(percent), HUNDRED_PERCENT));
}

/**
 * Splits `amount` across `weights` in proportion, with largest-remainder rounding.
 * The parts always sum to `amount`. Ties go to the earlier weight.
 */
export function allocateProportionally(amount: number, weights: readonly number[]): number[] {
  assertMinor(amount, "Amount");
  for (const w of weights) assertMinor(w, "Weight");
  const total = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  if (total === 0n) {
    if (amount !== 0) throw new MoneyError("Cannot allocate an amount across zero weights");
    return weights.map(() => 0);
  }
  const big = BigInt(amount);
  const parts = weights.map((w) => (big * BigInt(w)) / total);
  const remainders = weights.map((w, index) => ({ index, rem: (big * BigInt(w)) % total }));
  let leftover = big - parts.reduce((sum, p) => sum + p, 0n);
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const { index } of remainders) {
    if (leftover === 0n) break;
    parts[index] = (parts[index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return parts.map((p) => toSafeNumber(p));
}

function discountAmount(subtotal: number, discount: DiscountInput | null | undefined): number {
  if (!discount) return 0;
  let value: number;
  if (discount.type === "percent") {
    value = percentOf(subtotal, discount.percent);
  } else if (discount.type === "fixed") {
    assertMinor(discount.amount, "Discount");
    value = discount.amount;
  } else {
    throw new MoneyError("Unknown discount type");
  }
  if (value > subtotal) throw new MoneyError("Discount is larger than the subtotal");
  return value;
}

/**
 * Calculates document totals.
 * 1. Each line amount = quantity x unit price, rounded to minor units.
 * 2. The discount is split across lines in proportion to their amounts (largest remainder).
 * 3. Each line's tax is calculated on its discounted amount and rounded per line.
 * 4. Tax totals are grouped by tax rate ID.
 */
export function calculateTotals(input: TotalsInput): DocumentTotals {
  getExponent(input.currency);
  const amounts = input.lines.map((line) => lineAmount(line.quantity, line.unitPrice));
  const subtotal = amounts.reduce((sum, a) => sum + a, 0);
  assertMinor(subtotal, "Subtotal");
  const discount = discountAmount(subtotal, input.discount);
  const shares = allocateProportionally(discount, amounts);

  const taxes = new Map<string, TaxTotal & { scaled: bigint }>();
  const lines: LineTotals[] = input.lines.map((line, i) => {
    const amount = amounts[i] ?? 0;
    const share = shares[i] ?? 0;
    const net = amount - share;
    if (!line.tax) return { amount, discount: share, net, tax: 0, taxId: null };

    const scaled = parsePercent(line.tax.rate, "tax rate");
    const tax = toSafeNumber(roundDiv(BigInt(net) * scaled, HUNDRED_PERCENT));
    const group = taxes.get(line.tax.id);
    if (group) {
      if (group.scaled !== scaled) {
        throw new MoneyError(`Tax ${line.tax.id} has two different rates`);
      }
      group.taxable += net;
      group.tax += tax;
    } else {
      taxes.set(line.tax.id, {
        taxId: line.tax.id,
        name: line.tax.name,
        rate: stripZeros(formatScaled(scaled, PERCENT_DECIMALS)),
        taxable: net,
        tax,
        scaled,
      });
    }
    return { amount, discount: share, net, tax, taxId: line.tax.id };
  });

  const taxRows = [...taxes.values()].map(({ scaled: _scaled, ...row }) => row);
  const taxTotal = lines.reduce((sum, l) => sum + l.tax, 0);
  return {
    currency: input.currency,
    subtotal,
    discount,
    taxTotal,
    total: subtotal - discount + taxTotal,
    lines,
    taxes: taxRows,
  };
}
