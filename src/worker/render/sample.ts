// The sample invoice for the template editor preview. Fixed client and lines, the live
// brand kit, and one custom field per level.
import type {
  CustomFieldScope,
  CustomFieldType,
  TemplateConfig,
  TemplateSection,
} from "../../shared/domain";
import { calculateTotals, convertTotals } from "../../shared/money";
import type { DocumentSnapshot, SnapshotCustomField } from "../../shared/schemas/document";
import type { BrandKit } from "../../shared/schemas/settings";
import { addDays } from "../../shared/time";

export interface SampleFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
  scope: CustomFieldScope;
  section: TemplateSection;
}

const SAMPLE_TAXES = {
  vat: { id: "sample-vat", name: "VAT", rate: "15", note: null },
  service: { id: "sample-service", name: "Service tax", rate: "5", note: "Collected for the city" },
} as const;

const SAMPLE_LINES = [
  { description: "Brand identity system", quantity: "1", unitPrice: 150000, tax: SAMPLE_TAXES.vat },
  {
    description: "Website design, 12 pages",
    quantity: "12",
    unitPrice: 18000,
    tax: SAMPLE_TAXES.vat,
  },
  { description: "Hosting setup", quantity: "2.5", unitPrice: 4000, tax: SAMPLE_TAXES.service },
];

/** Used when the workspace has no custom fields yet. */
export const SAMPLE_FIELD_DEFS: SampleFieldDef[] = [
  {
    id: "sample-workspace",
    label: "Company reg. no.",
    type: "text",
    scope: "workspace",
    section: "header",
  },
  { id: "sample-client", label: "Client code", type: "text", scope: "client", section: "bill_to" },
  {
    id: "sample-document",
    label: "PO number",
    type: "text",
    scope: "document",
    section: "bill_to",
  },
];

function sampleValue(def: SampleFieldDef, today: string): string {
  if (def.type === "number") return "42";
  if (def.type === "date") return today;
  if (def.id.startsWith("sample-")) {
    return (
      { "sample-workspace": "C-118204", "sample-client": "HAL-07", "sample-document": "PO-5521" }[
        def.id
      ] ?? "Sample"
    );
  }
  return `Sample ${def.label.toLowerCase()}`;
}

/**
 * A sample snapshot with the given template config. `defs` are the workspace's custom
 * fields. When there are none, three sample fields stand in, one per level.
 */
export function sampleSnapshot(input: {
  brandKit: BrandKit;
  config: TemplateConfig;
  defs: SampleFieldDef[];
  homeCurrency: string;
  today: string;
  now: number;
}): DocumentSnapshot {
  const currency = input.homeCurrency === "USD" ? "EUR" : "USD";
  const discount = { type: "percent" as const, percent: "5" };
  const totals = calculateTotals({ currency, lines: SAMPLE_LINES, discount });
  const rate = "121.5";
  const defs = input.defs.length > 0 ? input.defs : SAMPLE_FIELD_DEFS;
  const customFields: SnapshotCustomField[] = defs.map((def) => ({
    fieldId: def.id,
    label: def.label,
    type: def.type,
    section: def.section,
    value: sampleValue(def, input.today),
  }));
  return {
    version: 1,
    document: {
      id: "sample",
      kind: "invoice",
      number: "INV-0042",
      revisionNumber: 1,
      currency,
      issueDate: input.today,
      dueDate: addDays(input.today, 14),
      expiryDate: null,
      paymentTermsDays: 14,
      discount,
      notes: "Thank you for the work together this month.",
      footerText: null,
    },
    lines: SAMPLE_LINES.map((line, position) => {
      const t = totals.lines[position];
      return {
        position,
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        tax: { ...line.tax },
        amount: t?.amount ?? 0,
        discount: t?.discount ?? 0,
        net: t?.net ?? 0,
        taxAmount: t?.tax ?? 0,
      };
    }),
    totals,
    fx: {
      homeCurrency: input.homeCurrency,
      rate,
      rateDate: input.today,
      provider: "frankfurter",
      overridden: false,
    },
    homeTotals: convertTotals(totals, currency, input.homeCurrency, rate),
    client: {
      id: "sample-client",
      name: "Halden & Co",
      billingAddress: "14 Harbour Road\nChattogram 4100\nBangladesh",
      taxId: "BIN 004512398",
      contact: { name: "Mira Halden", email: "accounts@halden.example" },
    },
    brandKit: input.brandKit,
    template: { id: null, name: "Preview", config: input.config },
    customFields,
    createdAt: input.now,
  };
}
