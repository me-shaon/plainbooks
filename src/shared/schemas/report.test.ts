import { describe, expect, it } from "vitest";
import { periodLabel, reportQuery } from "./report";

describe("report schema", () => {
  it("labels periods", () => {
    expect(periodLabel("2026-10")).toBe("Oct 2026");
    expect(periodLabel("2026-Q3")).toBe("Q3 2026");
    expect(periodLabel("2026")).toBe("2026");
  });

  it("rejects a reversed range", () => {
    expect(reportQuery.safeParse({ from: "2026-10-02", to: "2026-10-01" }).success).toBe(false);
    expect(reportQuery.parse({}).period).toBe("month");
  });
});
