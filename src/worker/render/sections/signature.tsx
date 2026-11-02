/** @jsxImportSource hono/jsx */
import type { DocumentView } from "../model";
import { Fields } from "./fields";

/**
 * The signature block: the signature image over a line, then the signer's name and title.
 * It prints nothing when the brand kit has no signature image and no name.
 */
export function SignatureSection({ view }: { view: DocumentView }) {
  const brand = view.snapshot.brandKit;
  // Snapshots from before signatures existed have no signature fields.
  const name = brand.signatureName ?? null;
  const title = brand.signatureTitle ?? null;
  const fields = view.fields("signature");
  if (!view.signatureSrc && !name && fields.length === 0) return null;
  return (
    <section class="sec sec-signature sign" aria-label="Signature">
      <div class="sign-block">
        {view.signatureSrc ? (
          <img
            class="sign-img"
            src={view.signatureSrc}
            alt={name ? `Signature of ${name}` : "Signature"}
          />
        ) : null}
        <span class="sign-rule" aria-hidden="true" />
        {name ? <span class="sign-name">{name}</span> : null}
        {title ? <span class="small muted">{title}</span> : null}
        {name ? null : <span class="small muted">Authorized signature</span>}
      </div>
      <Fields items={fields} />
    </section>
  );
}
