import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAppMailer, mailProviders } from "../../src/worker/email/mailer";
import {
  FAKE_FX_RATE,
  fakeExternals,
  fakeExternalsEnabled,
  fakeOutbox,
  fxFetcher,
  tinyPdf,
} from "../../src/worker/externals";
import { getPdf, setPdfRendererForTesting } from "../../src/worker/services/pdf";
import { db, resetDocuments, seedClient, sentInvoice } from "../helpers/documents";
import { resetPdfState } from "../helpers/pdf";

const FX_URL = "https://api.frankfurter.dev/v2/rate/USD/BDT?date=2026-10-23";

afterEach(() => vi.restoreAllMocks());

describe("fakeExternalsEnabled", () => {
  it("is true only for development with FAKE_EXTERNALS=1", () => {
    expect(fakeExternalsEnabled({ APP_ENV: "development", FAKE_EXTERNALS: "1" })).toBe(true);
    expect(fakeExternalsEnabled({ APP_ENV: "development" })).toBe(false);
    expect(fakeExternalsEnabled({ APP_ENV: "development", FAKE_EXTERNALS: "true" })).toBe(false);
    expect(fakeExternalsEnabled({ APP_ENV: "production", FAKE_EXTERNALS: "1" })).toBe(false);
    expect(fakeExternalsEnabled({ APP_ENV: "Development", FAKE_EXTERNALS: "1" })).toBe(false);
  });
});

describe("in production", () => {
  const prod = { APP_ENV: "production", FAKE_EXTERNALS: "1" } as const;

  it("ignores FAKE_EXTERNALS and calls the real Frankfurter", async () => {
    expect(fakeExternals(prod)).toBeNull();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ real: true }));

    await fxFetcher(prod)(FX_URL);

    expect(spy.mock.calls.map(([input]) => String(input))).toEqual([FX_URL]);
  });

  it("needs a saved email provider", async () => {
    await env.DB.prepare("DELETE FROM email_providers").run();
    await expect(mailProviders({ ...env, ...prod }, db)).rejects.toMatchObject({
      status: 422,
      code: "email_not_configured",
    });
  });

  describe("PDF", () => {
    beforeEach(async () => {
      await resetDocuments();
      await resetPdfState();
      setPdfRendererForTesting(null);
    });

    it("renders with the Browser Run binding, not the fake", async () => {
      const id = await sentInvoice({ clientId: (await seedClient()).id });
      const row = await env.DB.prepare(
        "SELECT current_revision_id AS r FROM documents WHERE id = ?",
      )
        .bind(id)
        .first<{ r: string }>();
      const quickAction = vi.fn(async () => new Response("%PDF-1.7 browser run"));
      const browser = { quickAction } as unknown as BrowserRun;

      const result = await getPdf({ ...env, ...prod, BROWSER: browser }, db, row?.r ?? "");

      expect(quickAction).toHaveBeenCalledOnce();
      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(new TextDecoder().decode(result.bytes)).toBe("%PDF-1.7 browser run");
      }
    });
  });
});

describe("in development with FAKE_EXTERNALS=1", () => {
  const dev = { APP_ENV: "development", FAKE_EXTERNALS: "1" } as const;

  it("answers Frankfurter and sends email through the mailswitch fake, without the network", async () => {
    await env.DB.prepare("DELETE FROM email_providers").run();
    const spy = vi.spyOn(globalThis, "fetch");

    const fx = await (await fxFetcher(dev)(FX_URL)).json();
    expect(fx).toEqual({ date: "2026-10-23", base: "USD", quote: "BDT", rate: FAKE_FX_RATE });

    // With no saved provider, the fakes still give a toSend primary.
    const devEnv = { ...env, ...dev };
    const providers = await mailProviders(devEnv, db);
    expect(providers.map((p) => [p.role, p.providerId])).toEqual([["primary", "tosend"]]);
    const before = fakeOutbox.length;
    const result = await createAppMailer(devEnv, db, providers, Date.now()).send({
      from: "billing@studio.test",
      to: ["a@example.com"],
      subject: "Invoice",
      text: "Hello",
      idempotencyKey: `externals-test:${crypto.randomUUID()}`,
    });
    expect(result).toMatchObject({ status: "sent", provider: "tosend" });
    const id = result.status === "sent" ? result.providerMessageId : undefined;
    expect(fakeOutbox.slice(before)).toEqual([{ id, to: ["a@example.com"], subject: "Invoice" }]);

    expect(spy).not.toHaveBeenCalled();
  });

  it("returns a valid PDF from the fake renderer", async () => {
    const outcome = await fakeExternals(dev)?.pdfRenderer.render("<p>x</p>");
    expect(outcome?.ok).toBe(true);
    const text = new TextDecoder().decode(tinyPdf());
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // The xref offset points at the "xref" keyword.
    const startxref = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });
});
