import { formatGrouped } from "../../../shared/money";
import type { CurrencyOutstanding } from "../../../shared/schemas/dashboard";
import { cn } from "../../components/ui/utils";
import { formatMoney } from "../../lib/format";

/** Segment colors, from the accent outward. More currencies reuse them in order. */
const SWATCHES = [
  "bg-accent",
  "bg-accent-mid",
  "bg-accent-light",
  "bg-tint-foreground",
  "bg-muted-foreground",
];

/**
 * "Outstanding by currency": a segmented bar sized by each currency's home value, and a
 * legend with the exact amount in each currency.
 */
export function CurrencyBar({
  rows,
  homeCurrency,
}: {
  rows: CurrencyOutstanding[];
  homeCurrency: string;
}) {
  const total = rows.reduce((sum, row) => sum + row.home, 0);
  return (
    <section
      aria-labelledby="by-currency-title"
      className="flex flex-col gap-3.5 rounded-card border border-transparent bg-card px-[18px] py-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="by-currency-title" className="m-0 text-[15px] font-semibold">
          Outstanding by currency
        </h2>
        <span className="text-xs text-muted-foreground">Each currency keeps its own total.</span>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">Nothing is outstanding.</p>
      ) : (
        <>
          <div aria-hidden="true" className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {rows.map((row, i) => (
              <div
                key={row.currency}
                className={cn("min-w-1", SWATCHES[i % SWATCHES.length])}
                style={{ flexGrow: total > 0 ? row.home : 1, flexBasis: 0 }}
              />
            ))}
          </div>
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0 text-[13px]">
            {rows.map((row, i) => (
              <li
                key={row.currency}
                className="flex items-center gap-1.5"
                title={`About ${formatMoney(row.home, homeCurrency)} at the stored rates`}
              >
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-[2px]", SWATCHES[i % SWATCHES.length])}
                />
                {row.currency}{" "}
                <span className="figure">{formatGrouped(row.amount, row.currency)}</span>
                <span className="text-xs text-muted-foreground">
                  ({row.invoiceCount} {row.invoiceCount === 1 ? "invoice" : "invoices"})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
