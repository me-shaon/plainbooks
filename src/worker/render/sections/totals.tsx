/** @jsxImportSource hono/jsx */
import { formatGrouped } from "../../../shared/money";
import { longDate } from "../format";
import type { DocumentView } from "../model";
import { Fields } from "./fields";

function discountLabel(view: DocumentView): string {
  const discount = view.snapshot.document.discount;
  if (discount.type === "percent") return `Discount ${discount.percent}%`;
  return "Discount";
}

export function TotalsSection({ view }: { view: DocumentView }) {
  const { totals, fx, homeTotals, document: doc, lines } = view.snapshot;
  const paid = view.state.amountPaid;
  const showPaid = view.isInvoice && paid > 0 && !view.isVoid;
  const notes = new Map<string, string>();
  for (const line of lines) {
    if (line.tax?.note) notes.set(line.tax.id, `${line.tax.name}: ${line.tax.note}`);
  }
  const showFx = fx && homeTotals && fx.homeCurrency !== doc.currency;
  return (
    <section class="sec sec-totals totals-wrap" aria-label="Totals">
      <dl class="totals">
        <dt>Subtotal</dt>
        <dd>{view.money(totals.subtotal)}</dd>
        {totals.discount > 0 ? (
          <>
            <dt>{discountLabel(view)}</dt>
            <dd>-{view.money(totals.discount)}</dd>
          </>
        ) : null}
        {totals.taxes.map((tax) => (
          <>
            <dt>{`${tax.name ?? "Tax"} ${tax.rate}%`}</dt>
            <dd>{view.money(tax.tax)}</dd>
          </>
        ))}
        <dt class="grand">{view.isInvoice && !showPaid ? "Total due" : "Total"}</dt>
        <dd class="grand">{view.money(totals.total)}</dd>
        {showPaid ? (
          <>
            <dt>Paid</dt>
            <dd>-{view.money(Math.min(paid, totals.total))}</dd>
            <dt class="balance">Balance due</dt>
            <dd class="balance">{view.money(view.balance)}</dd>
          </>
        ) : null}
      </dl>
      {notes.size > 0 ? (
        <ul class="tax-notes">
          {[...notes.values()].map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {showFx ? (
        <p class="fx-note">
          {`About ${homeTotals.currency} ${formatGrouped(homeTotals.total, homeTotals.currency)} at ${fx.rate} ${fx.homeCurrency} per ${doc.currency} (${longDate(fx.rateDate)})`}
        </p>
      ) : null}
      <Fields items={view.fields("totals")} />
    </section>
  );
}
