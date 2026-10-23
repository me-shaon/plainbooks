/** @jsxImportSource hono/jsx */
import { longDate } from "../format";
import type { DocumentView } from "../model";
import { Fields } from "./fields";

export function HeaderSection({ view }: { view: DocumentView }) {
  const { snapshot } = view;
  const brand = snapshot.brandKit;
  const doc = snapshot.document;
  const dates = [`Issued ${longDate(doc.issueDate)}`];
  if (doc.dueDate) dates.push(`Due ${longDate(doc.dueDate)}`);
  if (doc.expiryDate) dates.push(`Valid until ${longDate(doc.expiryDate)}`);
  return (
    <header class="sec sec-header header">
      <div class="brand">
        {view.logoSrc ? (
          <img class="logo" src={view.logoSrc} alt={brand.businessName ?? "Logo"} />
        ) : null}
        {brand.businessName ? <span class="business">{brand.businessName}</span> : null}
        {brand.address ? <span class="small muted pre">{brand.address}</span> : null}
        {brand.taxId ? <span class="small muted">Tax ID {brand.taxId}</span> : null}
      </div>
      <div class="title-block">
        <span class="title">{view.kindLabel}</span>
        <span class="doc-number mono small muted">{doc.number ?? "Draft"}</span>
        <span class="small muted">{dates.join(" · ")}</span>
        <Fields items={view.fields("header")} />
      </div>
    </header>
  );
}
