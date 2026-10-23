import { describe, expect, it } from "vitest";
import { addDays, isIsoDate, todayIn, WORKSPACE_TIMEZONE } from "./time";

describe("todayIn", () => {
  it("returns the Dhaka date, which is UTC+6", () => {
    expect(todayIn(WORKSPACE_TIMEZONE, Date.parse("2026-10-22T17:59:59Z"))).toBe("2026-10-22");
    expect(todayIn(WORKSPACE_TIMEZONE, Date.parse("2026-10-22T18:00:00Z"))).toBe("2026-10-23");
  });

  it("accepts a Date and other timezones", () => {
    const instant = new Date("2026-01-01T03:00:00Z");
    expect(todayIn("UTC", instant)).toBe("2026-01-01");
    expect(todayIn("America/New_York", instant)).toBe("2025-12-31");
  });

  it("throws for an unknown timezone", () => {
    expect(() => todayIn("Mars/Olympus", 0)).toThrow(RangeError);
  });
});

describe("addDays and isIsoDate", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("validates calendar dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-2-1")).toBe(false);
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });
});
