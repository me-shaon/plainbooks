import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DocumentSummary, FxQuote, SendPreview } from "../../src/shared/schemas/document";
import { apiFetch, clearUsers, seedUser } from "../helpers/auth";
import { draft, resetDocuments, seedClient } from "../helpers/documents";
import { fillDailyCap, resetEmailState, restoreEmail, useFakeEmail } from "../helpers/email";

const MEMBER = "member@docs-ui.test";
let clientId: string;

beforeAll(async () => {
  await clearUsers();
  await seedUser(MEMBER, "member");
});

beforeEach(async () => {
  await resetDocuments();
  await resetEmailState();
  // Resend has a default cap of 100 a day.
  await useFakeEmail({ primary: { providerId: "resend" } });
  clientId = (await seedClient()).id;
});

afterEach(() => restoreEmail());

describe("endpoints for the document UI", () => {
  it("lists rows with the first line as the summary", async () => {
    await draft({ clientId });
    const res = await apiFetch("/api/documents?kind=invoice", { as: MEMBER });
    const body = (await res.json()) as { items: DocumentSummary[] };
    expect(body.items[0]?.summary).toBe("Design");
  });

  it("previews a send without using a number", async () => {
    const id = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${id}/send-preview`, { as: MEMBER });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SendPreview;
    expect(body.recipients).toEqual(["ap@northwind.test"]);
    expect(body.subject).toBe("Invoice INV-0001 from Studio One");
    expect(body.emailConfigured).toBe(true);
    expect(body.fx).toBeNull();

    const again = (await (
      await apiFetch(`/api/documents/${id}/send-preview?revise=1`, { as: MEMBER })
    ).json()) as SendPreview;
    expect(again.subject).toBe("Updated invoice INV-0001 from Studio One");
    const doc = await (await apiFetch(`/api/documents/${id}`, { as: MEMBER })).json();
    expect((doc as { number: string | null }).number).toBeNull();
  });

  it("reports the email count and a manual rate", async () => {
    const id = await draft({
      clientId,
      currency: "EUR",
      fxRate: { rate: "130", date: "2026-10-23" },
    });
    await fillDailyCap({ providerId: "resend", role: "primary" }, 3, Date.now());
    const body = (await (
      await apiFetch(`/api/documents/${id}/send-preview`, { as: MEMBER })
    ).json()) as SendPreview;
    expect(body.fx).toEqual({
      status: "ok",
      rate: "130",
      rateDate: "2026-10-23",
      provider: "manual",
    });
    expect(body.dailyLimit).toBe(100);
    expect(body.emailsSentToday).toBe(3);
  });

  it("reports no limit for a provider with no cap, and no email without a provider", async () => {
    const id = await draft({ clientId });
    await resetEmailState();
    await useFakeEmail({ primary: { providerId: "tosend" } });
    const uncapped = (await (
      await apiFetch(`/api/documents/${id}/send-preview`, { as: MEMBER })
    ).json()) as SendPreview;
    expect(uncapped).toMatchObject({ emailConfigured: true, dailyLimit: null, emailsSentToday: 0 });

    await resetEmailState();
    const none = (await (
      await apiFetch(`/api/documents/${id}/send-preview`, { as: MEMBER })
    ).json()) as SendPreview;
    expect(none).toMatchObject({ emailConfigured: false, dailyLimit: null });
  });

  it("returns an identity rate for the home currency and rejects a bad query", async () => {
    const ok = await apiFetch("/api/fx/rate?currency=BDT&date=2026-10-23", { as: MEMBER });
    expect((await ok.json()) as FxQuote).toEqual({
      status: "ok",
      rate: "1",
      rateDate: "2026-10-23",
      provider: "identity",
    });
    const bad = await apiFetch("/api/fx/rate?currency=XYZ&date=nope", { as: MEMBER });
    expect(bad.status).toBe(400);
  });
});
