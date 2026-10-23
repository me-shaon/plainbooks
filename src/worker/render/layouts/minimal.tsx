/** @jsxImportSource hono/jsx */
import type { DocumentView } from "../model";
import { Sections } from "../sections";

/** Light type, more white space, and totals aligned to the left. */
export function MinimalLayout({ view }: { view: DocumentView }) {
  return (
    <article class="page layout-minimal" aria-label={view.kindLabel}>
      {view.isVoid ? (
        <span class="void-mark" aria-hidden="true">
          VOID
        </span>
      ) : null}
      <Sections view={view} />
    </article>
  );
}
