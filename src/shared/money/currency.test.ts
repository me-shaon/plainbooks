import { describe, expect, it } from "vitest";
import { formatGrouped } from "./currency";
import { MoneyError } from "./decimal";

describe("formatGrouped", () => {
  it("groups the whole part and keeps the fraction", () => {
    expect(formatGrouped(123456789, "USD")).toBe("1,234,567.89");
    expect(formatGrouped(99999, "USD")).toBe("999.99");
    expect(formatGrouped(0, "USD")).toBe("0.00");
  });

  it("keeps the sign in front of the digits", () => {
    expect(formatGrouped(-123456, "USD")).toBe("-1,234.56");
    expect(formatGrouped(-5, "USD")).toBe("-0.05");
  });

  it("uses the currency exponent", () => {
    expect(formatGrouped(1234567, "JPY")).toBe("1,234,567");
    expect(formatGrouped(1234567, "KWD")).toBe("1,234.567");
  });

  it("rejects amounts that are not safe integers", () => {
    expect(() => formatGrouped(1.5, "USD")).toThrow(MoneyError);
  });
});
