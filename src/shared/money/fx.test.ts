import { describe, expect, it } from "vitest";
import { convertMinor, convertTotals, normalizeRate, RATE_SCALE, rateToScaled } from "./fx";
import { calculateTotals, MoneyError } from "./totals";

describe("rates", () => {
  it("normalizes decimal strings", () => {
    expect(normalizeRate("128.50")).toBe("128.5");
    expect(normalizeRate("0130.000")).toBe("130");
    expect(normalizeRate("0.00812345")).toBe("0.00812345");
    expect(normalizeRate(" 1 ")).toBe("1");
  });

  it("rejects invalid rates", () => {
    for (const bad of ["", "0", "-1", "abc", "1e3", "1.123456789", "1,5", "Infinity"]) {
      expect(() => normalizeRate(bad), bad).toThrow(MoneyError);
    }
  });

  it("scales rates to integers", () => {
    expect(RATE_SCALE).toBe(100_000_000);
    expect(rateToScaled("128.5")).toBe(12_850_000_000);
    expect(rateToScaled("0.1")).toBe(10_000_000);
  });
});

describe("convertMinor", () => {
  it("converts with exact decimal math", () => {
    // Float math gives 0.1 x 3 = 0.30000000000000004. Integer math stays exact.
    expect(convertMinor(300, "USD", "BDT", "0.1")).toBe(30);
    expect(convertMinor(100, "EUR", "BDT", "128.50")).toBe(12850);
  });

  it("handles different exponents", () => {
    // 1,000 JPY at 0.81 BDT per JPY = 810.00 BDT
    expect(convertMinor(1000, "JPY", "BDT", "0.81")).toBe(81000);
    // 1.005 KWD at 400.123 = 402.123615 -> 402.12
    expect(convertMinor(1005, "KWD", "BDT", "400.123")).toBe(40212);
    // 10.00 USD to JPY at 150.55 = 1505.5 -> 1506
    expect(convertMinor(1000, "USD", "JPY", "150.55")).toBe(1506);
  });

  it("rounds half away from zero", () => {
    // 0.01 USD x 122.5 = 1.225 BDT -> 1.23
    expect(convertMinor(1, "USD", "BDT", "122.5")).toBe(123);
    expect(convertMinor(-1, "USD", "BDT", "122.5")).toBe(-123);
  });

  it("returns the same amount for the same currency", () => {
    expect(convertMinor(12345, "BDT", "BDT", "1")).toBe(12345);
  });
});

describe("convertTotals (AE4)", () => {
  const totals = calculateTotals({
    currency: "EUR",
    lines: [
      { quantity: "1", unitPrice: 150000, tax: { id: "vat19", rate: "19" } },
      { quantity: "1", unitPrice: 40000, tax: { id: "vat19", rate: "19" } },
    ],
    discount: { type: "percent", percent: "5" },
  });

  it("reports at the edited rate of 130.00, not the fetched 128.50", () => {
    const fetched = convertTotals(totals, "EUR", "BDT", "128.50");
    const edited = convertTotals(totals, "EUR", "BDT", "130.00");
    expect(edited.total).toBe(27923350); // 2,147.95 x 130 = 279,233.50 BDT
    expect(fetched.total).toBe(27601158); // 2,147.95 x 128.5 = 276,011.575 -> 276,011.58
    expect(edited.total).not.toBe(fetched.total);
    expect(edited.subtotal).toBe(24700000);
    expect(edited.discount).toBe(1235000);
    expect(edited.taxTotal).toBe(4458350);
    expect(edited.taxes).toEqual([
      { taxId: "vat19", name: undefined, rate: "19", taxable: 23465000, tax: 4458350 },
    ]);
  });

  it("rounds once at the total level, not per line", () => {
    const t = calculateTotals({
      currency: "USD",
      lines: [
        { quantity: 1, unitPrice: 1 },
        { quantity: 1, unitPrice: 1 },
        { quantity: 1, unitPrice: 1 },
      ],
    });
    // Each 0.01 x 122.5 = 1.225. Per line rounding would give 3 x 1.23 = 3.69.
    // Converting the total once: 0.03 x 122.5 = 3.675 -> 3.68.
    expect(convertTotals(t, "USD", "BDT", "122.5").total).toBe(368);
  });
});
