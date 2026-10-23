import type { TemplateLayout } from "../domain";

/** One row of GET /api/templates. */
export interface TemplateSummary {
  id: string;
  name: string;
  layout: TemplateLayout;
  archivedAt: number | null;
}
