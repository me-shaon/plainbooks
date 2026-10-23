/** @jsxImportSource hono/jsx */
import type { DocumentView } from "../model";
import { Fields } from "./fields";

export function BillToSection({ view }: { view: DocumentView }) {
  const client = view.snapshot.client;
  const contact = client.contact;
  return (
    <section class="sec sec-bill_to bill-to" aria-label="Bill to">
      <span class="label">{view.isInvoice ? "Bill to" : "Prepared for"}</span>
      <span class="bill-name">{client.name}</span>
      {client.billingAddress ? <span class="small muted pre">{client.billingAddress}</span> : null}
      {client.taxId ? <span class="small muted">Tax ID {client.taxId}</span> : null}
      {contact ? (
        <span class="small muted">
          {contact.name ? `${contact.name} · ${contact.email}` : contact.email}
        </span>
      ) : null}
      <Fields items={view.fields("bill_to")} />
    </section>
  );
}
