/** @jsxImportSource hono/jsx */
import type { DocumentView } from "../model";
import { Fields } from "./fields";

/** Bank transfer details. Absent for quotes and for paid or void invoices. */
export function PaymentDetailsSection({ view }: { view: DocumentView }) {
  if (!view.showPaymentDetails) return null;
  const bank = view.snapshot.brandKit.bankDetails;
  const fields = view.fields("payment_details");
  if (!bank && fields.length === 0) return null;
  const number = view.snapshot.document.number;
  return (
    <section class="sec sec-payment_details pay" aria-label="Payment details">
      <span class="label">Pay by bank transfer</span>
      {bank ? <span class="details">{bank}</span> : null}
      {number ? <span class="small muted">Reference: {number}</span> : null}
      <Fields items={fields} />
    </section>
  );
}
