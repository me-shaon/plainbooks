import type { FC } from "hono/jsx";
import type { TemplateLayout } from "../../../shared/domain";
import type { DocumentView } from "../model";
import { BoldLayout } from "./bold";
import { ClassicLayout } from "./classic";
import { MinimalLayout } from "./minimal";

export const LAYOUTS: Record<TemplateLayout, FC<{ view: DocumentView }>> = {
  classic: ClassicLayout,
  minimal: MinimalLayout,
  bold: BoldLayout,
};
