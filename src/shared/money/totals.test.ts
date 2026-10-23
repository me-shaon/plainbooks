import { describe, expect, it } from "vitest";
import { formatMinor, getExponent, isCurrencyCode, parseMinor } from "./currency";
import {
  allocateProportionally,
  calculateTotals,
  lineAmount,
  MoneyError,
  parseQuantity,
  roundDiv,
} from "./totals";

const VAT19 = { id: "vat19", name: "VAT 19%", rate: "19" };
const VAT15 = { id: "vat15", name: "VAT 15%", rate: "15" };
const ZERO = { id: "rc0", name: "Reverse charge 0%", rate: "0" };

describe("currency exponents", () => {
  it("uses ISO 4217 exponents", () => {
    expect(getExponent("JPY")).toBe(0);
    expect(getExponent("BDT")).toBe(2);
    expect(getExponent("USD")).toBe(2);
    expect(getExponent("EUR")).toBe(2);
    expect(getExponent("KWD")).toBe(3);
    expect(getExponent("KRW")).toBe(0);
  });

  it("rejects unknown codes", () => {
    expect(isCurrencyCode("XYZ")).toBe(false);
    expect(isCurrencyCode("usd")).toBe(false);
    expect(() => getExponent("XYZ")).toThrow(MoneyError);
  });

  it("parses and formats minor units without floats", () => {
    expect(parseMinor("1500.00", "USD")).toBe(150000);
    expect(parseMinor("1500.5", "USD")).toBe(150050);
    expect(parseMinor("0.1", "KWD")).toBe(100);
    expect(parseMinor("1200", "JPY")).toBe(1200);
    expect(() => parseMinor("12.5", "JPY")).toThrow(MoneyError);
    expect(() => parseMinor("1.234", "USD")).toThrow(MoneyError);
    expect(formatMinor(214795, "EUR")).toBe("2147.95");
    expect(formatMinor(1200, "JPY")).toBe("1200");
    expect(formatMinor(1005, "KWD")).toBe("1.005");
    expect(formatMinor(-5, "USD")).toBe("-0.05");
  });
});

describe("rounding", () => {
  it("rounds half away from zero", () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
    expect(roundDiv(-4n, 3n)).toBe(-1n);
    expect(roundDiv(15n, 10n)).toBe(2n);
    expect(roundDiv(14n, 10n)).toBe(1n);
  });
});

describe("line amounts", () => {
  it("allows up to 3 quantity decimals", () => {
    expect(parseQuantity("0.333")).toBe(333);
    expect(parseQuantity(2)).toBe(2000);
    expect(parseQuantity(0.333)).toBe(333);
    expect(() => parseQuantity("0.3333")).toThrow(MoneyError);
    expect(() => parseQuantity("-1")).toThrow(MoneyError);
  });

  it("rounds 0.333 x 3.00 to 1.00", () => {
    expect(lineAmount("0.333", 300)).toBe(100);
  });

  it("rounds a half minor unit away from zero", () => {
    // 0.5 x 0.03 = 0.015 -> 0.02
    expect(lineAmount("0.5", 3)).toBe(2);
  });
});

describe("calculateTotals", () => {
  it("handles 2 lines with a 5% discount and 19% VAT", () => {
    const t = calculateTotals({
      currency: "EUR",
      lines: [
        { quantity: "1", unitPrice: 150000, tax: VAT19 },
        { quantity: "1", unitPrice: 40000, tax: VAT19 },
      ],
      discount: { type: "percent", percent: "5" },
    });
    expect(t.subtotal).toBe(190000);
    expect(t.discount).toBe(9500);
    expect(t.taxTotal).toBe(34295);
    expect(t.total).toBe(214795);
    expect(t.lines.map((l) => l.discount)).toEqual([7500, 2000]);
    expect(t.lines.map((l) => l.tax)).toEqual([27075, 7220]);
    expect(t.taxes).toEqual([
      { taxId: "vat19", name: "VAT 19%", rate: "19", taxable: 180500, tax: 34295 },
    ]);
  });

  it("allocates a fixed 10.00 discount across 3 lines of 33.33 as 3.34, 3.33, 3.33", () => {
    const t = calculateTotals({
      currency: "USD",
      lines: [
        { quantity: 1, unitPrice: 3333 },
        { quantity: 1, unitPrice: 3333 },
        { quantity: 1, unitPrice: 3333 },
      ],
      discount: { type: "fixed", amount: 1000 },
    });
    expect(t.lines.map((l) => l.discount)).toEqual([334, 333, 333]);
    expect(t.discount).toBe(1000);
    expect(t.total).toBe(9999 - 1000);
  });

  it("produces one tax total per rate", () => {
    const t = calculateTotals({
      currency: "BDT",
      lines: [
        { quantity: 1, unitPrice: 10000, tax: VAT15 },
        { quantity: 2, unitPrice: 5000, tax: VAT19 },
        { quantity: 1, unitPrice: 2000, tax: VAT15 },
        { quantity: 1, unitPrice: 7000, tax: ZERO },
        { quantity: 1, unitPrice: 1000 },
      ],
    });
    expect(t.taxes).toEqual([
      { taxId: "vat15", name: "VAT 15%", rate: "15", taxable: 12000, tax: 1800 },
      { taxId: "vat19", name: "VAT 19%", rate: "19", taxable: 10000, tax: 1900 },
      { taxId: "rc0", name: "Reverse charge 0%", rate: "0", taxable: 7000, tax: 0 },
    ]);
    expect(t.taxTotal).toBe(3700);
    expect(t.subtotal).toBe(30000);
    expect(t.total).toBe(33700);
  });

  it("rounds tax per line, then sums", () => {
    // Each line: 0.10 at 15% = 0.015 -> 0.02. Summed first would be 0.045 -> 0.05.
    const t = calculateTotals({
      currency: "USD",
      lines: [
        { quantity: 1, unitPrice: 10, tax: VAT15 },
        { quantity: 1, unitPrice: 10, tax: VAT15 },
        { quantity: 1, unitPrice: 10, tax: VAT15 },
      ],
    });
    expect(t.lines.map((l) => l.tax)).toEqual([2, 2, 2]);
    expect(t.taxTotal).toBe(6);
  });

  it("keeps JPY amounts in whole yen", () => {
    const t = calculateTotals({
      currency: "JPY",
      lines: [{ quantity: "1.5", unitPrice: 333, tax: { id: "jct", rate: "10" } }],
      discount: { type: "percent", percent: "3" },
    });
    // 1.5 x 333 = 499.5 -> 500. Discount 3% = 15. Net 485. Tax 48.5 -> 49.
    expect(t.subtotal).toBe(500);
    expect(t.discount).toBe(15);
    expect(t.taxTotal).toBe(49);
    expect(t.total).toBe(534);
    for (const value of [t.subtotal, t.discount, t.taxTotal, t.total]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("supports KWD with 3 decimals", () => {
    const t = calculateTotals({
      currency: "KWD",
      lines: [{ quantity: 1, unitPrice: 12345, tax: { id: "v5", rate: "5" } }],
    });
    // 12.345 x 5% = 0.61725 -> 0.617
    expect(t.taxTotal).toBe(617);
    expect(t.total).toBe(12962);
  });

  it("rejects a discount larger than the subtotal", () => {
    const lines = [{ quantity: 1, unitPrice: 5000 }];
    expect(() =>
      calculateTotals({ currency: "USD", lines, discount: { type: "fixed", amount: 5001 } }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateTotals({ currency: "USD", lines, discount: { type: "percent", percent: "100.01" } }),
    ).toThrow(MoneyError);
    expect(
      calculateTotals({ currency: "USD", lines, discount: { type: "fixed", amount: 5000 } }).total,
    ).toBe(0);
  });

  it("rejects invalid inputs", () => {
    expect(() =>
      calculateTotals({ currency: "USD", lines: [{ quantity: 1, unitPrice: 1.5 }] }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateTotals({ currency: "USD", lines: [{ quantity: 1, unitPrice: -100 }] }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateTotals({
        currency: "USD",
        lines: [{ quantity: 1, unitPrice: 100 }],
        discount: { type: "fixed", amount: -1 },
      }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateTotals({
        currency: "USD",
        lines: [{ quantity: 1, unitPrice: 100, tax: { id: "x", rate: "abc" } }],
      }),
    ).toThrow(MoneyError);
  });

  it("returns zeroes for an empty document", () => {
    const t = calculateTotals({ currency: "BDT", lines: [] });
    expect(t).toMatchObject({ subtotal: 0, discount: 0, taxTotal: 0, total: 0, taxes: [] });
  });

  it("allows a discount on a zero subtotal only when it is zero", () => {
    const lines = [{ quantity: 0, unitPrice: 5000 }];
    expect(
      calculateTotals({ currency: "USD", lines, discount: { type: "percent", percent: "10" } })
        .discount,
    ).toBe(0);
    expect(() =>
      calculateTotals({ currency: "USD", lines, discount: { type: "fixed", amount: 1 } }),
    ).toThrow(MoneyError);
  });
});

describe("allocateProportionally (property checks)", () => {
  // Small deterministic PRNG so failures can be reproduced.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("always sums exactly to the amount and never exceeds a weight", () => {
    const rand = rng(42);
    for (let run = 0; run < 2000; run++) {
      const count = 1 + Math.floor(rand() * 12);
      const weights = Array.from({ length: count }, () =>
        rand() < 0.1 ? 0 : Math.floor(rand() * 10_000_000),
      );
      const sum = weights.reduce((a, b) => a + b, 0);
      if (sum === 0) continue;
      const amount = Math.floor(rand() * (sum + 1));
      const parts = allocateProportionally(amount, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(amount);
      parts.forEach((part, i) => {
        expect(Number.isInteger(part)).toBe(true);
        expect(part).toBeGreaterThanOrEqual(0);
        expect(part).toBeLessThanOrEqual(weights[i] ?? 0);
        // Largest remainder keeps each part within 1 of its exact share.
        const exact = (amount * (weights[i] ?? 0)) / sum;
        expect(Math.abs(part - exact)).toBeLessThan(1 + 1e-6);
      });
    }
  });

  it("keeps document totals consistent for random documents", () => {
    const rand = rng(7);
    for (let run = 0; run < 500; run++) {
      const lines = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => ({
        quantity: (Math.floor(rand() * 10_000) / 1000).toFixed(3),
        unitPrice: Math.floor(rand() * 1_000_000),
        tax: rand() < 0.5 ? VAT15 : VAT19,
      }));
      const percent = (Math.floor(rand() * 10_000) / 100).toFixed(2);
      const t = calculateTotals({
        currency: "BDT",
        lines,
        discount: { type: "percent", percent },
      });
      expect(t.lines.reduce((a, l) => a + l.discount, 0)).toBe(t.discount);
      expect(t.lines.reduce((a, l) => a + l.amount, 0)).toBe(t.subtotal);
      expect(t.taxes.reduce((a, x) => a + x.tax, 0)).toBe(t.taxTotal);
      expect(t.taxes.reduce((a, x) => a + x.taxable, 0)).toBe(t.subtotal - t.discount);
      expect(t.total).toBe(t.subtotal - t.discount + t.taxTotal);
    }
  });

  it("breaks ties toward earlier weights", () => {
    expect(allocateProportionally(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(7, [0, 3, 0])).toEqual([0, 7, 0]);
  });
});
