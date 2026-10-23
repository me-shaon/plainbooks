// CPU benchmark for a full layout render (plan U10). Runs in Node, because workerd
// freezes timers during synchronous work. Workers Free allows 10 ms CPU per request.
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE_CONFIG, TEMPLATE_LAYOUTS } from "../../shared/domain";
import { calculateTotals } from "../../shared/money";
import type { DocumentSnapshot } from "../../shared/schemas/document";
import { renderDocumentHtml } from "./index";
import { sampleSnapshot } from "./sample";

function thirtyLineSnapshot(layout: (typeof TEMPLATE_LAYOUTS)[number]): DocumentSnapshot {
  const base = sampleSnapshot({
    brandKit: {
      businessName: "Studio One",
      logoKey: "logos/abc.png",
      logoUrl: "/p/assets/logo/abc.png",
      accentColor: "#2f7f6f",
      font: "instrument-sans",
      address: "House 12, Road 5\nDhaka",
      taxId: "BIN 1234",
      bankDetails: "City Bank\nAccount 0042",
      footerText: "Thank you",
    },
    config: { ...DEFAULT_TEMPLATE_CONFIG, layout },
    defs: [],
    homeCurrency: "BDT",
    today: "2026-10-23",
    now: Date.UTC(2026, 9, 23),
  });
  const tax = { id: "vat", name: "VAT", rate: "15", note: null };
  const lines = Array.from({ length: 30 }, (_, i) => ({
    description: `Design sprint ${i + 1}: research, wireframes, and review`,
    quantity: String((i % 4) + 1),
    unitPrice: 12500 + i * 100,
    tax,
  }));
  const totals = calculateTotals({ currency: base.document.currency, lines });
  return {
    ...base,
    lines: lines.map((line, position) => ({
      position,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      tax,
      amount: totals.lines[position]?.amount ?? 0,
      discount: 0,
      net: totals.lines[position]?.net ?? 0,
      taxAmount: totals.lines[position]?.tax ?? 0,
    })),
    totals,
  };
}

const state = {
  status: "partially_paid" as const,
  amountPaid: 50000,
  today: "2026-10-23",
  timeZone: "Asia/Dhaka",
  decidedAt: null,
  decisionComment: null,
};

describe("render CPU benchmark", () => {
  for (const layout of TEMPLATE_LAYOUTS) {
    it(`renders a 30-line ${layout} invoice in under 10 ms`, () => {
      const snapshot = thirtyLineSnapshot(layout);
      const coldStart = performance.now();
      const html = renderDocumentHtml(snapshot, { mode: "page", state });
      const cold = performance.now() - coldStart;
      expect(html.match(/<tr>|<tr /g)?.length).toBe(31);
      for (let i = 0; i < 20; i++) renderDocumentHtml(snapshot, { mode: "page", state });
      const times: number[] = [];
      for (let i = 0; i < 50; i++) {
        const start = performance.now();
        renderDocumentHtml(snapshot, { mode: i % 2 ? "page" : "pdf", state });
        times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      const median = times[Math.floor(times.length / 2)] ?? 0;
      const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
      console.log(
        `render benchmark ${layout}: first ${cold.toFixed(2)} ms, median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`,
      );
      expect(median).toBeLessThan(10);
      expect(cold).toBeLessThan(10);
    });
  }
});
