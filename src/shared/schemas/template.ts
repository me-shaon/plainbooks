// Template and custom field validation shared by the API, the renderer, and the editor.
import { z } from "zod";
import {
  CUSTOM_FIELD_SCOPES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldScope,
  type CustomFieldType,
  DEFAULT_TEMPLATE_CONFIG,
  TEMPLATE_LAYOUTS,
  TEMPLATE_SECTIONS,
  type TemplateConfig,
  type TemplateLayout,
  type TemplateSection,
} from "../domain";

export const TEMPLATE_LAYOUT_LABELS: Record<TemplateLayout, string> = {
  classic: "Classic",
  minimal: "Minimal",
  bold: "Bold",
};

export const TEMPLATE_LAYOUT_DESCRIPTIONS: Record<TemplateLayout, string> = {
  classic: "Logo and title on one line, ruled line items, totals on the right.",
  minimal: "Light type, more space, and totals on the left.",
  bold: "An accent color band across the top and a large total.",
};

export const TEMPLATE_SECTION_LABELS: Record<TemplateSection, string> = {
  header: "Header",
  bill_to: "Bill to",
  line_items: "Line items",
  totals: "Totals",
  notes: "Notes",
  payment_details: "Payment details",
  footer: "Footer",
};

/**
 * A template config. Each section ID can occur once. Sections that are missing are added at
 * the end as hidden, so a stored config always lists all seven sections.
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
  })
  .transform(
    (config): TemplateConfig => ({
      layout: config.layout,
      sections: [
        ...config.sections,
        ...TEMPLATE_SECTIONS.filter((id) => !config.sections.some((s) => s.id === id)).map(
          (id) => ({ id, visible: false }),
        ),
      ],
      customFields: config.customFields,
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

const templateName = z
  .string()
  .trim()
  .min(1, "Enter a template name")
  .max(80, "Use 80 characters or fewer");

/** POST /api/templates. Owner only. */
export const templateCreateInput = z.object({
  name: templateName,
  layout: z.enum(TEMPLATE_LAYOUTS),
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
