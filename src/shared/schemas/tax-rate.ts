// Tax rate validation shared by the API and the tax rate form.
import { z } from "zod";
import { MoneyError, normalizePercent } from "../money";

/** A percent between 0 and 100 with up to 4 decimals, stored as a short decimal string. */
export const percentText = z.union([z.string(), z.number()]).transform((value, ctx) => {
  const text = String(value).trim();
  try {
    return normalizePercent(text);
  } catch (err) {
    ctx.addIssue({
      code: "custom",
      message: err instanceof MoneyError ? "Enter a percent from 0 to 100" : "Enter a percent",
    });
    return z.NEVER;
  }
});

export const taxRateInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80, "Use 80 characters or fewer"),
  rate: percentText,
  /** Printed on documents that use this rate, for example "Reverse charge". */
  note: z
    .string()
    .trim()
    .max(300, "Use 300 characters or fewer")
    .nullish()
    .transform((value) => (value ? value : null)),
});
export type TaxRateInput = z.input<typeof taxRateInput>;

export const taxRateUpdateInput = taxRateInput.partial();

export interface TaxRate {
  id: string;
  name: string;
  /** Percent as a decimal string, for example "15" or "7.5". */
  rate: string;
  note: string | null;
  archivedAt: number | null;
}

/** "VAT 15%" style label for pickers. */
export function taxRateLabel(rate: Pick<TaxRate, "name" | "rate">): string {
  return `${rate.name} (${rate.rate}%)`;
}
