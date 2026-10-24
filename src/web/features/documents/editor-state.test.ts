import { describe, expect, it } from "vitest";
import { changeCurrency, emptyValues } from "./editor-state";

describe("changeCurrency", () => {
  const manual = { rate: "130", date: "2026-10-23" };

  it("clears a manual exchange rate when the currency changes", () => {
    const values = { ...emptyValues("invoice", "EUR"), fxManual: manual };
    const next = changeCurrency(values, "USD");
    expect(next.currency).toBe("USD");
    expect(next.fxManual).toBeNull();
  });

  it("keeps the manual exchange rate when the currency stays the same", () => {
    const values = { ...emptyValues("invoice", "EUR"), fxManual: manual };
    expect(changeCurrency(values, "EUR").fxManual).toEqual(manual);
  });
});
