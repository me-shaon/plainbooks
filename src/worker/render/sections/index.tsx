/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { TemplateSection } from "../../../shared/domain";
import type { DocumentView } from "../model";
import { BillToSection } from "./bill-to";
import { FooterSection } from "./footer";
import { HeaderSection } from "./header";
import { LineItemsSection } from "./line-items";
import { NotesSection } from "./notes";
import { PaymentDetailsSection } from "./payment-details";
import { TotalsSection } from "./totals";

type SectionComponent = FC<{ view: DocumentView }>;

/** The only sections a layout can render. A config cannot add markup. */
export const SECTION_COMPONENTS: Record<TemplateSection, SectionComponent> = {
  header: HeaderSection,
  bill_to: BillToSection,
  line_items: LineItemsSection,
  totals: TotalsSection,
  notes: NotesSection,
  payment_details: PaymentDetailsSection,
  footer: FooterSection,
};

/** The visible sections in config order. */
export function Sections({ view }: { view: DocumentView }) {
  return (
    <>
      {view.sections
        .filter((section) => section.visible)
        .map((section) => {
          const Component = SECTION_COMPONENTS[section.id];
          return <Component key={section.id} view={view} />;
        })}
    </>
  );
}
