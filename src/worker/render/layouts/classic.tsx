/** @jsxImportSource hono/jsx */
import type { DocumentView } from "../model";
import { Sections } from "../sections";

/** Logo and title on one line, ruled line items, and totals on the right. */
export function ClassicLayout({ view }: { view: DocumentView }) {
  return (
    <article class="page layout-classic" aria-label={view.kindLabel}>
      {view.isVoid ? (
        <span class="void-mark" aria-hidden="true">
          VOID
        </span>
      ) : null}
      <Sections view={view} />
    </article>
  );
}
