/** @jsxImportSource hono/jsx */
// The document page. Every layout renders the same sections. The layout and the template
// style only change CSS classes, so a config cannot add markup (see ../styles.ts).
import type { TemplateLayout } from "../../../shared/domain";
import type { DocumentView } from "../model";
import { Sections } from "../sections";

/** The class list of the page: the layout, then the template style options. */
export function pageClass(view: DocumentView, layout: TemplateLayout): string {
  const classes = ["page", `layout-${layout}`];
  // The bold band sits behind the header, so it needs the header first.
  if (layout === "bold" && view.sections.find((s) => s.visible)?.id !== "header") {
    classes.push("band-off");
  }
  if (view.style.striped) classes.push("opt-striped");
  if (view.style.compact) classes.push("opt-compact");
  if (view.style.centeredHeader) classes.push("opt-center");
  return classes.join(" ");
}

export function DocumentPage({ view, layout }: { view: DocumentView; layout: TemplateLayout }) {
  return (
    <article class={pageClass(view, layout)} aria-label={view.kindLabel}>
      {view.isVoid ? (
        <span class="void-mark" aria-hidden="true">
          VOID
        </span>
      ) : null}
      <Sections view={view} />
    </article>
  );
}
