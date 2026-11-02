// Template and custom field validation shared by the API, the renderer, and the editor.
import { z } from "zod";
import {
  CUSTOM_FIELD_SCOPES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldScope,
  type CustomFieldType,
  DEFAULT_TEMPLATE_CONFIG,
  DEFAULT_TEMPLATE_STYLE,
  TEMPLATE_LAYOUTS,
  TEMPLATE_SECTIONS,
  type TemplateConfig,
  type TemplateLayout,
  type TemplateSection,
} from "../domain";
import { FONT_CHOICES, HEX_COLOR } from "./settings";

export const TEMPLATE_LAYOUT_LABELS: Record<TemplateLayout, string> = {
  classic: "Classic",
  minimal: "Minimal",
  bold: "Bold",
  modern: "Modern",
  elegant: "Elegant",
  boxed: "Boxed",
};

export const TEMPLATE_LAYOUT_DESCRIPTIONS: Record<TemplateLayout, string> = {
  classic: "Logo and title on one line, ruled line items, totals on the right.",
  minimal: "Light type, quiet rules, and more space.",
  bold: "An accent color band across the top and a large total.",
  modern: "A thin accent bar, accent headings, and totals in a soft card.",
  elegant: "Spaced capitals, double rules, and quiet color.",
  boxed: "Line items in a bordered grid with an accent header row.",
};

export const TEMPLATE_SECTION_LABELS: Record<TemplateSection, string> = {
  header: "Header",
  bill_to: "Bill to",
  line_items: "Line items",
  totals: "Totals",
  notes: "Notes",
  payment_details: "Payment details",
  signature: "Signature",
  footer: "Footer",
};

const FONT_IDS = FONT_CHOICES.map((f) => f.id) as [string, ...string[]];

/** A template's look. Older configs have none, so each value has a default. */
export const templateStyleInput = z.object({
  accentColor: z
    .string()
    .trim()
    .regex(HEX_COLOR, "Enter a hex color such as #2f7f6f")
    .transform((value) => value.toLowerCase())
    .nullable()
    .default(null),
  font: z.enum(FONT_IDS).nullable().default(null),
  striped: z.boolean().default(false),
  compact: z.boolean().default(false),
  centeredHeader: z.boolean().default(false),
  showHomeCurrency: z.boolean().default(false),
});

/**
 * Adds each missing section as hidden, in TEMPLATE_SECTIONS order, at the end. When the
 * footer is last, they go before it, so a section added in a later release (the signature)
 * does not print under the footer when it is turned on.
 */
function withMissingSections(
  sections: { id: TemplateSection; visible: boolean }[],
): { id: TemplateSection; visible: boolean }[] {
  const missing = TEMPLATE_SECTIONS.filter((id) => !sections.some((s) => s.id === id)).map(
    (id) => ({ id, visible: false }),
  );
  if (missing.length === 0) return sections;
  const footerLast = sections.at(-1)?.id === "footer";
  return footerLast
    ? [...sections.slice(0, -1), ...missing, ...sections.slice(-1)]
    : [...sections, ...missing];
}

/**
 * A template config. Each section ID can occur once. Missing sections are added as hidden
 * (withMissingSections), so a stored config always lists every section.
 */
export const templateConfigInput = z
  .object({
    layout: z.enum(TEMPLATE_LAYOUTS),
    sections: z
      .array(z.object({ id: z.enum(TEMPLATE_SECTIONS), visible: z.boolean() }))
      .max(TEMPLATE_SECTIONS.length)
      .refine((items) => new Set(items.map((s) => s.id)).size === items.length, {
        message: "Each section can occur once",
      }),
    customFields: z
      .array(z.object({ fieldId: z.string().min(1).max(64), section: z.enum(TEMPLATE_SECTIONS) }))
      .max(50)
      .refine((items) => new Set(items.map((f) => f.fieldId)).size === items.length, {
        message: "Each custom field can have one placement",
      })
      .default([]),
    style: templateStyleInput.default(DEFAULT_TEMPLATE_STYLE),
  })
  .transform(
    (config): TemplateConfig => ({
      layout: config.layout,
      sections: withMissingSections(config.sections),
      customFields: config.customFields,
      style: config.style,
    }),
  );
export type TemplateConfigInput = z.input<typeof templateConfigInput>;

/** Reads a stored config. Falls back to the default config for invalid JSON. */
export function normalizeTemplateConfig(value: unknown): TemplateConfig {
  const parsed = templateConfigInput.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_TEMPLATE_CONFIG;
}

/** The starting config for a new template of a layout. */
export function layoutConfig(layout: TemplateLayout): TemplateConfig {
  return { ...DEFAULT_TEMPLATE_CONFIG, layout };
}

export const TEMPLATE_PRESET_CATEGORIES = ["minimal", "professional", "modern"] as const;
export type TemplatePresetCategory = (typeof TEMPLATE_PRESET_CATEGORIES)[number];

export const TEMPLATE_PRESET_CATEGORY_LABELS: Record<TemplatePresetCategory, string> = {
  minimal: "Minimal",
  professional: "Professional",
  modern: "Modern",
};

/**
 * A ready-made template in the New template gallery. Creating one copies its config. Every
 * preset keeps the sections that an invoice needs: header, bill to, line items, totals,
 * and payment details. Quotes never print payment details.
 */
export interface TemplatePreset {
  id: string;
  category: TemplatePresetCategory;
  name: string;
  description: string;
  config: TemplateConfig;
}

function preset(
  category: TemplatePresetCategory,
  id: string,
  name: string,
  description: string,
  layout: TemplateLayout,
  options: { style?: Partial<TemplateConfig["style"]>; order?: TemplateSection[] } = {},
): TemplatePreset {
  const order = options.order ?? TEMPLATE_SECTIONS;
  return {
    id,
    category,
    name,
    description,
    config: {
      ...DEFAULT_TEMPLATE_CONFIG,
      layout,
      sections: order.map((section) => ({ id: section, visible: true })),
      style: { ...DEFAULT_TEMPLATE_STYLE, ...options.style },
    },
  };
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  preset(
    "minimal",
    "minimal",
    "Minimal",
    "Light type, quiet rules, and a lot of white space.",
    "minimal",
  ),
  preset(
    "minimal",
    "minimal-centered",
    "Centered",
    "Minimal, with the logo, business details, and title centered.",
    "minimal",
    { style: { centeredHeader: true } },
  ),
  preset(
    "minimal",
    "minimal-compact",
    "Lean",
    "Minimal and compact, for long item lists on few pages.",
    "minimal",
    { style: { compact: true } },
  ),
  preset(
    "professional",
    "classic",
    "Classic",
    "The standard invoice: business at the top left, title and dates at the top right.",
    "classic",
  ),
  preset(
    "professional",
    "elegant",
    "Elegant",
    "A centered header, spaced capitals, and double rules.",
    "elegant",
    { style: { centeredHeader: true } },
  ),
  preset(
    "professional",
    "boxed",
    "Boxed",
    "A bordered grid with an accent header row and striped lines.",
    "boxed",
    { style: { striped: true } },
  ),
  preset(
    "professional",
    "compact",
    "Ledger",
    "Classic, compact, and striped, for long item lists.",
    "classic",
    { style: { compact: true, striped: true } },
  ),
  preset(
    "modern",
    "modern",
    "Modern",
    "A thin accent bar, accent headings, and totals in a soft card.",
    "modern",
  ),
  preset(
    "modern",
    "bold",
    "Bold",
    "An accent color band across the top and a large total.",
    "bold",
  ),
  preset(
    "modern",
    "proposal",
    "Proposal",
    "Modern, with the notes before the line items. Good for quotes that explain the work.",
    "modern",
    {
      order: [
        "header",
        "bill_to",
        "notes",
        "line_items",
        "totals",
        "payment_details",
        "signature",
        "footer",
      ],
    },
  ),
];

const templateName = z
  .string()
  .trim()
  .min(1, "Enter a template name")
  .max(80, "Use 80 characters or fewer");

/**
 * POST /api/templates. Owner only. `config` copies a ready-made template or another
 * template (Duplicate). Without it, the template starts from the layout.
 */
export const templateCreateInput = z.object({
  name: templateName,
  layout: z.enum(TEMPLATE_LAYOUTS),
  config: templateConfigInput.optional(),
});
export type TemplateCreateInput = z.input<typeof templateCreateInput>;

/** PATCH /api/templates/:id. Owner only. */
export const templateUpdateInput = z
  .object({ name: templateName, config: templateConfigInput })
  .partial();
export type TemplateUpdateInput = z.input<typeof templateUpdateInput>;

/** POST /render/preview. */
export const renderPreviewInput = z.object({
  config: templateConfigInput,
  /** Renders this document's live data. Without it, the sample invoice is used. */
  documentId: z.string().min(1).optional(),
});
export type RenderPreviewInput = z.input<typeof renderPreviewInput>;

/** One row of GET /api/templates. */
export interface TemplateSummary {
  id: string;
  name: string;
  layout: TemplateLayout;
  archivedAt: number | null;
  /** True for the workspace default template. */
  isDefault: boolean;
}

/** GET /api/templates/:id. */
export interface TemplateDetail extends TemplateSummary {
  config: TemplateConfig;
  /** True when a document, client, or recurring schedule uses the template. */
  inUse: boolean;
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export const CUSTOM_FIELD_SCOPE_LABELS: Record<CustomFieldScope, string> = {
  workspace: "Workspace",
  client: "Client",
  document: "Invoice or quote",
};

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
};

const fieldLabel = z.string().trim().min(1, "Enter a label").max(60, "Use 60 characters or fewer");

/** POST /api/custom-fields. Owner only. */
export const customFieldCreateInput = z.object({
  label: fieldLabel,
  type: z.enum(CUSTOM_FIELD_TYPES),
  scope: z.enum(CUSTOM_FIELD_SCOPES),
  section: z.enum(TEMPLATE_SECTIONS),
});
export type CustomFieldCreateInput = z.input<typeof customFieldCreateInput>;

/** PATCH /api/custom-fields/:id. Owner only. The scope and type cannot change. */
export const customFieldUpdateInput = z
  .object({
    label: fieldLabel,
    section: z.enum(TEMPLATE_SECTIONS),
    sortOrder: z.int().min(0).max(1000),
  })
  .partial();
export type CustomFieldUpdateInput = z.input<typeof customFieldUpdateInput>;

/** PUT /api/custom-fields/values/:scope/:entityId. Replaces every value of that entity. */
export const customFieldValuesInput = z.object({
  values: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        value: z.string().trim().max(500, "Use 500 characters or fewer"),
      }),
    )
    .max(50),
});
export type CustomFieldValuesInput = z.input<typeof customFieldValuesInput>;

/** One row of GET /api/custom-fields. */
export interface CustomFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
  scope: CustomFieldScope;
  section: TemplateSection;
  sortOrder: number;
  archivedAt: number | null;
}

/** A stored value of a workspace or client field. */
export interface CustomFieldValue {
  fieldId: string;
  value: string;
}
