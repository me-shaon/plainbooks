import type { DocumentTotals } from "../../../shared/money";
import { cn } from "../../components/ui/utils";
import { formatMoney } from "../../lib/format";

export interface TotalsPanelProps {
  totals: Pick<DocumentTotals, "currency" | "subtotal" | "discount" | "taxTotal" | "total"> & {
    taxes?: DocumentTotals["taxes"];
  };
  /** Minor units already paid. Shows the paid and balance rows when above zero. */
  amountPaid?: number;
  /** A short label for the discount row, for example "Discount 5%". */
  discountLabel?: string;
  className?: string;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4",
        strong && "mt-1 border-t border-ink pt-2.5 font-semibold",
      )}
    >
      <dt className={strong ? "text-ink" : "text-muted-foreground"}>{label}</dt>
      <dd className="figure m-0 text-right">{value}</dd>
    </div>
  );
}

/**
 * Subtotal, discount, one row per tax rate, and the total. The editor passes live totals
 * from `calculateTotals`. The detail page passes the stored totals.
 */
export function TotalsPanel({
  totals,
  amountPaid = 0,
  discountLabel,
  className,
}: TotalsPanelProps) {
  const cur = totals.currency;
  return (
    <dl
      aria-label="Totals"
      className={cn("m-0 flex flex-col gap-2 text-[13.5px]", className)}
      aria-live="polite"
    >
      <Row label="Subtotal" value={formatMoney(totals.subtotal, cur)} />
      {totals.discount > 0 ? (
        <Row label={discountLabel ?? "Discount"} value={`−${formatMoney(totals.discount, cur)}`} />
      ) : null}
      {totals.taxes && totals.taxes.length > 0 ? (
        totals.taxes.map((tax) => (
          <Row
            key={tax.taxId}
            label={`${tax.name ?? "Tax"} (${tax.rate}%)`}
            value={formatMoney(tax.tax, cur)}
          />
        ))
      ) : (
        <Row label="Tax" value={formatMoney(totals.taxTotal, cur)} />
      )}
      <Row label="Total" value={formatMoney(totals.total, cur)} strong />
      {amountPaid > 0 ? (
        <>
          <Row label="Paid" value={`−${formatMoney(amountPaid, cur)}`} />
          <Row label="Balance due" value={formatMoney(totals.total - amountPaid, cur)} strong />
        </>
      ) : null}
    </dl>
  );
}
