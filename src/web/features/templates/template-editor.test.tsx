import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE_CONFIG } from "../../../shared/domain";
import { moveSections } from "./template-editor";

const ids = (sections: { id: string }[]) => sections.map((s) => s.id);

describe("moveSections", () => {
  const sections = DEFAULT_TEMPLATE_CONFIG.sections;

  it("moves a section before the target", () => {
    expect(ids(moveSections(sections, new Set(["footer"]), "header", "before"))).toEqual([
      "footer",
      "header",
      "bill_to",
      "line_items",
      "totals",
      "notes",
      "payment_details",
    ]);
  });

  it("moves a section after the target", () => {
    expect(ids(moveSections(sections, new Set(["header"]), "totals", "after"))).toEqual([
      "bill_to",
      "line_items",
      "totals",
      "header",
      "notes",
      "payment_details",
      "footer",
    ]);
  });

  it("keeps the order for an unknown target", () => {
    expect(moveSections(sections, new Set(["header"]), "nope", "before")).toBe(sections);
  });
});
