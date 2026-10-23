/** @jsxImportSource hono/jsx */
import type { DocumentView } from "../model";
import { Sections } from "../sections";

/** An accent color band behind the header and a large total. */
export function BoldLayout({ view }: { view: DocumentView }) {
  const headerFirst = view.sections.find((s) => s.visible)?.id === "header";
  return (
    <article
      class={headerFirst ? "page layout-bold" : "page layout-bold band-off"}
      aria-label={view.kindLabel}
    >
      {view.isVoid ? (
        <span class="void-mark" aria-hidden="true">
          VOID
        </span>
      ) : null}
      <Sections view={view} />
    </article>
  );
}
