import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documentUpdateInput } from "../../src/shared/schemas/document";
import {
  finalize,
  markSent,
  revise,
  updateDraft,
  voidDocument,
} from "../../src/worker/services/documents";
import type { Fetcher } from "../../src/worker/services/fx";
import { recordPayment, writeOffRemainder } from "../../src/worker/services/payments";
import { agingReport, csvCell, incomeReport, taxSummary } from "../../src/worker/services/reports";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
import {
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
  seedTaxRate,
  sentInvoice,
} from "../helpers/documents";

const MEMBER = "member@reports.test";
const Q3 = { period: "quarter", from: "2026-07-01", to: "2026-12-31" } as const;

let vat15: string;
let vat5: string;

beforeAll(async () => {
  installAccessKeys();
  await clearUsers();
  await seedUser(MEMBER, "member");
});

beforeEach(async () => {
  await resetDocuments();
  vat15 = (await seedTaxRate("15", "VAT 15%")).id;
  vat5 = (await seedTaxRate("5", "VAT 5%")).id;
});

function line(unitPrice: number, taxRateId: string | null = null) {
  return { description: "Work", quantity: "1", unitPrice, taxRateId };
}

/** Two VAT invoices in Q3, one in Q4, plus a void Q3 invoice and a Q3 draft. */
async function seedTaxInvoices() {
  const bd = await seedClient({ name: "Dhaka Foods" });
  const us = await seedClient({ name: "Northwind" });
  await sentInvoice({ clientId: bd.id, issueDate: "2026-07-15", lines: [line(100000, vat15)] });
  await sentInvoice({
    clientId: us.id,
    currency: "USD",
    issueDate: "2026-09-10",
    fxRate: { rate: "120", date: "2026-09-10" },
    lines: [line(50000, vat15), line(20000, vat5)],
  });
  await sentInvoice({ clientId: bd.id, issueDate: "2026-10-05", lines: [line(40000, vat15)] });
  const voided = await sentInvoice({
    clientId: bd.id,
    issueDate: "2026-08-01",
    lines: [line(900000, vat15)],
  });
  await voidDocument(db, voided, { now: NOW });
  await draft({ clientId: bd.id, issueDate: "2026-08-02", lines: [line(800000, vat15)] });
  return { bd, us };
}

describe("tax summary", () => {
  it("sums two Q3 VAT invoices per rate in BDT", async () => {
    await seedTaxInvoices();
    const report = await taxSummary(db, Q3, NOW);
    expect(report.homeCurrency).toBe("BDT");
    expect(report.rows).toEqual([
      // 1,000.00 BDT + 500.00 USD x 120. Tax 150.00 + 75.00 x 120.
      {
        period: "2026-Q3",
        taxRateId: vat15,
        name: "VAT 15%",
        rate: "15",
        taxable: 6100000,
        tax: 915000,
        invoiceCount: 2,
      },
      {
        period: "2026-Q3",
        taxRateId: vat5,
        name: "VAT 5%",
        rate: "5",
        taxable: 2400000,
        tax: 120000,
        invoiceCount: 1,
      },
      {
        period: "2026-Q4",
        taxRateId: vat15,
        name: "VAT 15%",
        rate: "15",
        taxable: 40000,
        tax: 6000,
        invoiceCount: 1,
      },
    ]);
    expect(report.total).toEqual({ taxable: 8540000, tax: 1041000 });
  });

  it("groups by month and by year, and honors the date range", async () => {
    await seedTaxInvoices();
    const months = await taxSummary(db, { ...Q3, period: "month" }, NOW);
    expect([...new Set(months.rows.map((r) => r.period))]).toEqual([
      "2026-07",
      "2026-09",
      "2026-10",
    ]);
    const year = await taxSummary(
      db,
      { period: "year", from: "2026-07-01", to: "2026-09-30" },
      NOW,
    );
    expect(year.rows.map((r) => [r.period, r.rate, r.tax])).toEqual([
      ["2026", "15", 915000],
      ["2026", "5", 120000],
    ]);
  });

  it("rejects a start date after the end date", async () => {
    await expect(
      taxSummary(db, { period: "month", from: "2026-10-01", to: "2026-09-01" }, NOW),
    ).rejects.toThrow();
  });
});

describe("income", () => {
  it("reports invoiced and paid per client per period at the stored rate", async () => {
    const { us } = await seedTaxInvoices();
    const usd = await sentInvoice({
      clientId: us.id,
      currency: "USD",
      issueDate: "2026-09-20",
      fxRate: { rate: "121", date: "2026-09-20" },
      lines: [line(100000)],
    });
    await recordPayment(db, usd, { amount: 40000, paidOn: "2026-10-01" }, { now: NOW });
    await writeOffRemainder(db, usd, { paidOn: "2026-10-02" }, { now: NOW });

    const report = await incomeReport(db, Q3, NOW);
    const northwind = report.rows.find((r) => r.period === "2026-Q3" && r.clientId === us.id);
    // 785.00 USD x 120 + 1,000.00 USD x 121. Paid 400.00 and wrote off 600.00 at 121.
    expect(northwind).toMatchObject({
      clientName: "Northwind",
      invoiceCount: 2,
      invoiced: 9420000 + 12100000,
      paid: 4840000,
      writtenOff: 7260000,
      open: 9420000,
    });
    expect(report.rows.map((r) => `${r.period} ${r.clientName}`)).toEqual([
      "2026-Q3 Northwind",
      "2026-Q3 Dhaka Foods",
      "2026-Q4 Dhaka Foods",
    ]);
  });

  it("uses the edited rate of 130.00, not the fetched 128.50 (AE4)", async () => {
    const client = await seedClient({ name: "Halden & Co", defaultCurrency: "EUR" });
    const id = await draft({
      clientId: client.id,
      currency: "EUR",
      issueDate: "2026-10-01",
      lines: [line(100000)],
    });
    // The user edits the suggested rate before sending.
    await updateDraft(
      db,
      id,
      documentUpdateInput.parse({ fxRate: { rate: "130.00", date: "2026-10-01" } }),
      { now: NOW },
    );
    const fetched: Fetcher = async () =>
      Response.json({ date: "2026-10-01", base: "EUR", quote: "BDT", rate: 128.5 });
    const { revision } = await finalize(db, id, { now: NOW, fetcher: fetched });
    await markSent(db, id, { revisionId: revision.id, now: NOW });
    await recordPayment(db, id, { amount: 40000, paidOn: "2026-10-10" }, { now: NOW });

    const report = await incomeReport(
      db,
      { period: "month", from: "2026-10-01", to: "2026-10-31" },
      NOW,
    );
    expect(report.rows).toEqual([
      {
        period: "2026-10",
        clientId: client.id,
        clientName: "Halden & Co",
        invoiceCount: 1,
        invoiced: 13000000,
        paid: 5200000,
        writtenOff: 0,
        open: 7800000,
      },
    ]);
  });
});

describe("latest revision", () => {
  it("uses the amounts of the latest revision after a revise", async () => {
    const client = await seedClient();
    const id = await sentInvoice({
      clientId: client.id,
      issueDate: "2026-08-10",
      lines: [line(100000, vat15)],
    });
    await revise(db, id, documentUpdateInput.parse({ lines: [line(300000, vat15)] }), {
      now: NOW,
      fetcher: noFetch,
    });
    const tax = await taxSummary(db, Q3, NOW);
    expect(tax.rows).toEqual([
      expect.objectContaining({ taxable: 300000, tax: 45000, invoiceCount: 1 }),
    ]);
    const income = await incomeReport(db, Q3, NOW);
    expect(income.rows.map((r) => r.invoiced)).toEqual([345000]);
  });
});

describe("aging", () => {
  it("buckets open balances by days overdue as of today", async () => {
    const client = await seedClient({ name: "Northwind" });
    const other = await seedClient({ name: "Moss Coffee" });
    const due = async (clientId: string, dueDate: string, unitPrice: number) =>
      sentInvoice({ clientId, issueDate: "2026-01-01", dueDate, lines: [line(unitPrice)] });
    await due(client.id, "2026-10-30", 10000); // current
    await due(client.id, "2026-10-23", 20000); // due today: current
    await due(client.id, "2026-10-22", 30000); // 1 day
    await due(client.id, "2026-09-23", 40000); // 30 days
    await due(other.id, "2026-09-22", 50000); // 31 days
    await due(other.id, "2026-07-25", 60000); // 90 days
    await due(other.id, "2026-07-24", 70000); // 91 days
    const partly = await due(client.id, "2026-08-24", 80000); // 60 days
    await recordPayment(db, partly, { amount: 30000, paidOn: "2026-10-01" }, { now: NOW });
    const voided = await due(client.id, "2026-01-31", 99000);
    await voidDocument(db, voided, { now: NOW });
    await draft({ clientId: client.id, dueDate: "2026-01-31", lines: [line(98000)] });

    const report = await agingReport(db, NOW);
    expect(report.asOf).toBe("2026-10-23");
    expect(report.totals).toEqual({
      current: 30000,
      "1_30": 70000,
      "31_60": 100000,
      "61_90": 60000,
      over_90: 70000,
    });
    expect(report.total).toBe(330000);
    expect(report.rows.map((r) => [r.clientName, r.total, r.invoiceCount])).toEqual([
      ["Moss Coffee", 180000, 3],
      ["Northwind", 150000, 5],
    ]);
  });
});

describe("void invoices", () => {
  it("are absent from every report and export", async () => {
    const client = await seedClient({ name: "Void Client" });
    const id = await sentInvoice({
      clientId: client.id,
      issueDate: "2026-08-01",
      lines: [line(123400, vat15)],
    });
    await voidDocument(db, id, { now: NOW });
    expect((await taxSummary(db, Q3, NOW)).rows).toEqual([]);
    expect((await incomeReport(db, Q3, NOW)).rows).toEqual([]);
    expect((await agingReport(db, NOW)).rows).toEqual([]);
    const csv = await (
      await apiFetch("/api/reports/export/invoices?from=2026-01-01&to=2026-12-31", { as: MEMBER })
    ).text();
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(1);
    expect(csv).not.toContain("1234.00");
  });
});

describe("CSV export", () => {
  it("quotes a name with a comma and a quote per RFC 4180", async () => {
    await seedClient({ name: 'Halden, "The Studio" & Co' });
    const res = await apiFetch("/api/reports/export/clients", { as: MEMBER });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="clients-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const text = await res.text();
    const [header, row] = text.replace(/^﻿/, "").split("\r\n");
    expect(header).toBe(
      "Name,Primary email,Default currency,Tax ID,Billing address,Payment terms (days),Archived,Created",
    );
    expect(row?.startsWith('"Halden, ""The Studio"" & Co",ap@northwind.test,BDT,')).toBe(true);
  });

  it("neutralizes a name that starts with =", async () => {
    await seedClient({ name: '=HYPERLINK("http://evil.test","x")' });
    const text = await (await apiFetch("/api/reports/export/clients", { as: MEMBER })).text();
    expect(text).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`);
  });

  it("neutralizes every formula prefix", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tx")).toBe("'\tx");
    expect(csvCell("\rx")).toBe('"\'\rx"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
  });

  it("exports invoices and payments in the range with dated filenames", async () => {
    const client = await seedClient({ name: "Northwind" });
    const id = await sentInvoice({
      clientId: client.id,
      currency: "USD",
      issueDate: "2026-09-10",
      paymentTermsDays: 30,
      fxRate: { rate: "120", date: "2026-09-10" },
      lines: [line(50000, vat15)],
    });
    await recordPayment(
      db,
      id,
      { amount: 10000, paidOn: "2026-09-20", note: "-wire" },
      { now: NOW },
    );
    await draft({ clientId: client.id, issueDate: "2026-09-11", lines: [line(1)] });

    const inv = await apiFetch("/api/reports/export/invoices.csv?from=2026-09-01&to=2026-09-30", {
      as: MEMBER,
    });
    expect(inv.headers.get("content-disposition")).toBe(
      'attachment; filename="invoices-2026-09-01-to-2026-09-30.csv"',
    );
    const invLines = (await inv.text()).split("\r\n").filter(Boolean);
    expect(invLines).toHaveLength(2);
    expect(invLines[1]).toBe(
      "INV-0001,partially_paid,Northwind,USD,2026-09-10,2026-10-10,500.00,0.00,75.00,575.00,100.00,475.00,120,69000.00,1",
    );

    const pay = await apiFetch("/api/reports/export/payments?from=2026-09-01&to=2026-09-30", {
      as: MEMBER,
    });
    const payLines = (await pay.text()).split("\r\n").filter(Boolean);
    expect(payLines[1]).toBe(
      "2026-09-20,INV-0001,Northwind,Payment,USD,100.00,120,12000.00,'-wire",
    );

    const missing = await apiFetch("/api/reports/export/nope", { as: MEMBER });
    expect(missing.status).toBe(404);
  });
});
