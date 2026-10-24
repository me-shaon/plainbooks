/** @jsxImportSource hono/jsx */
import { formatGrouped } from "../../../shared/money";
import type { DocumentView } from "../model";
import { Fields } from "./fields";

export function LineItemsSection({ view }: { view: DocumentView }) {
  const { lines, document: doc } = view.snapshot;
  const hasTax = lines.some((line) => line.tax !== null);
  return (
    <section class="sec sec-line_items" aria-label="Line items">
      <table class="items">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" class="num">
              Qty
            </th>
            <th scope="col" class="num">
              Unit price
            </th>
            {hasTax ? (
              <th scope="col" class="num">
                Tax
              </th>
            ) : null}
            <th scope="col" class="num">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.position}>
              <td class="desc">{line.description}</td>
              <td class="num" data-label="Qty">
                {line.quantity}
              </td>
              <td class="num" data-label="Unit price">
                {formatGrouped(line.unitPrice, doc.currency)}
              </td>
              {hasTax ? (
                <td class="num" data-label="Tax">
                  {line.tax ? `${line.tax.rate}%` : "-"}
                </td>
              ) : null}
              <td class="num amount">{formatGrouped(line.amount, doc.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Fields items={view.fields("line_items")} />
    </section>
  );
}
