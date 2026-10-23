/** @jsxImportSource hono/jsx */
import type { DocumentView } from "../model";
import { Fields } from "./fields";

export function FooterSection({ view }: { view: DocumentView }) {
  const text = view.snapshot.document.footerText ?? view.snapshot.brandKit.footerText;
  const fields = view.fields("footer");
  if (!text && fields.length === 0) return null;
  return (
    <footer class="sec sec-footer footer">
      {text ? <span class="pre">{text}</span> : null}
      <Fields items={fields} />
    </footer>
  );
}
