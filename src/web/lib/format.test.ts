import { describe, expect, it } from "vitest";
import { formatDate, formatIsoDate, formatMoney } from "./format";

describe("formatIsoDate", () => {
  it("formats the calendar day with the given options", () => {
    expect(formatIsoDate("2026-10-23", { weekday: "long", day: "numeric", month: "long" })).toBe(
      "Friday 23 October",
    );
    expect(formatIsoDate("2026-10-23", { month: "long" })).toBe("October");
  });

  it("returns the input when it is not an ISO date, and empty text for no date", () => {
    expect(formatIsoDate("soon", { month: "long" })).toBe("soon");
    expect(formatIsoDate(null, { month: "long" })).toBe("");
  });
});

describe("formatDate and formatMoney", () => {
  it("use the shared helpers", () => {
    expect(formatDate("2026-01-05")).toBe("5 Jan 2026");
    expect(formatMoney(123456, "USD")).toBe("USD 1,234.56");
  });
});
