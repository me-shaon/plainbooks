import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { documentUpdateInput } from "../../src/shared/schemas/document";
import { finalize, revise } from "../../src/worker/services/documents";
import {
  BROWSER_LEASE_MS,
  getPdf,
  pdfKey,
  setPdfRendererForTesting,
} from "../../src/worker/services/pdf";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
import {
  db,
  draft,
  NOW,
  noFetch,
  resetDocuments,
  seedClient,
  sentInvoice,
} from "../helpers/documents";
import { failingRenderer, resetPdfState, stubRenderer } from "../helpers/pdf";

async function currentRevision(id: string): Promise<string> {
  const row = await env.DB.prepare("SELECT current_revision_id AS r FROM documents WHERE id = ?")
    .bind(id)
    .first<{ r: string }>();
  if (!row) throw new Error("no revision");
  return row.r;
}

let clientId: string;
let renderer: ReturnType<typeof stubRenderer>;

beforeAll(installAccessKeys);

beforeEach(async () => {
  await resetDocuments();
  await resetPdfState();
  clientId = (await seedClient()).id;
  renderer = stubRenderer();
  setPdfRendererForTesting(renderer);
});

afterEach(() => setPdfRendererForTesting(null));

describe("getPdf", () => {
  it("renders and stores the PDF, then serves the cached copy without the browser", async () => {
    const id = await sentInvoice({ clientId });
    const revisionId = await currentRevision(id);

    const first = await getPdf(env, db, revisionId);
    expect(first).toMatchObject({ status: "ready", cached: false, browserMs: 1234 });
    expect(renderer.calls).toHaveLength(1);
    // Fonts are inlined, so the browser makes no network calls.
    expect(renderer.calls[0]).toContain("data:font/woff2;base64,");
    expect(renderer.calls[0]).toContain("INV-0001");

    const stored = await env.BUCKET.get(pdfKey(revisionId));
    expect(stored?.httpMetadata?.contentType).toBe("application/pdf");
    expect(stored?.customMetadata?.browserMs).toBe("1234");
    const row = await env.DB.prepare("SELECT pdf_key AS k FROM document_revisions WHERE id = ?")
      .bind(revisionId)
      .first<{ k: string }>();
    expect(row?.k).toBe(pdfKey(revisionId));

    // The lease is still active, but a cached PDF never needs it.
    const second = await getPdf(env, db, revisionId);
    expect(second).toMatchObject({ status: "ready", cached: true, filename: "INV-0001.pdf" });
    if (second.status === "ready") expect(new TextDecoder().decode(second.bytes)).toContain("%PDF");
    expect(renderer.calls).toHaveLength(1);
  });

  it("returns retry-later while another render holds the lease", async () => {
    const id = await sentInvoice({ clientId });
    await env.DB.prepare("INSERT INTO leases (name, holder, expires_at) VALUES ('browser', 'x', ?)")
      .bind(Date.now() + 5000)
      .run();
    const result = await getPdf(env, db, await currentRevision(id));
    expect(result.status).toBe("pending");
    if (result.status === "pending") expect(result.retryAfterSeconds).toBeGreaterThan(0);
    expect(renderer.calls).toHaveLength(0);
  });

  it("waits for the lease when asked, then renders", async () => {
    const id = await sentInvoice({ clientId });
    let clock = 1_000_000;
    await env.DB.prepare("INSERT INTO leases (name, holder, expires_at) VALUES ('browser', 'x', ?)")
      .bind(clock + 4000)
      .run();
    const sleeps: number[] = [];
    const result = await getPdf(env, db, await currentRevision(id), {
      wait: true,
      clock: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
    expect(result.status).toBe("ready");
    expect(sleeps).toHaveLength(1);
    expect(renderer.calls).toHaveLength(1);
  });

  it("gives up after the wait limit and shows pending", async () => {
    const id = await sentInvoice({ clientId });
    const clock = 1_000_000;
    await env.DB.prepare("INSERT INTO leases (name, holder, expires_at) VALUES ('browser', 'x', ?)")
      .bind(clock + 30_000)
      .run();
    const result = await getPdf(env, db, await currentRevision(id), {
      wait: true,
      clock: () => clock,
      sleep: async () => {
        throw new Error("should not sleep past the deadline");
      },
    });
    expect(result.status).toBe("pending");
  });

  it("allows only one Quick Action per 10 s", async () => {
    const a = await sentInvoice({ clientId });
    const b = await sentInvoice({ clientId });
    const clock = 2_000_000;
    expect((await getPdf(env, db, await currentRevision(a), { clock: () => clock })).status).toBe(
      "ready",
    );
    expect(
      (await getPdf(env, db, await currentRevision(b), { clock: () => clock + 9000 })).status,
    ).toBe("pending");
    expect(
      (await getPdf(env, db, await currentRevision(b), { clock: () => clock + BROWSER_LEASE_MS }))
        .status,
    ).toBe("ready");
    expect(renderer.calls).toHaveLength(2);
  });

  it("returns a typed failure on a browser error and stores nothing", async () => {
    setPdfRendererForTesting(failingRenderer());
    const id = await sentInvoice({ clientId });
    const revisionId = await currentRevision(id);
    const result = await getPdf(env, db, revisionId);
    expect(result).toEqual({ status: "failed", code: "pdf_render_failed", message: "boom" });
    expect(await env.BUCKET.head(pdfKey(revisionId))).toBeNull();
    const row = await env.DB.prepare("SELECT pdf_key AS k FROM document_revisions WHERE id = ?")
      .bind(revisionId)
      .first<{ k: string | null }>();
    expect(row?.k).toBeNull();
  });

  it("treats a Browser Run 429 as retry-later", async () => {
    setPdfRendererForTesting(
      stubRenderer(() => ({ ok: false, status: 429, message: "rate", rateLimited: true })),
    );
    const id = await sentInvoice({ clientId });
    expect((await getPdf(env, db, await currentRevision(id))).status).toBe("pending");
  });

  it("renders the new revision after a revise", async () => {
    const id = await sentInvoice({ clientId });
    const first = await currentRevision(id);
    let clock = 3_000_000;
    await getPdf(env, db, first, { clock: () => clock });
    await revise(db, id, documentUpdateInput.parse({ notes: "Revised notes" }), {
      now: NOW,
      fetcher: noFetch,
    });
    const second = await currentRevision(id);
    expect(second).not.toBe(first);
    clock += BROWSER_LEASE_MS;
    const result = await getPdf(env, db, second, { clock: () => clock });
    expect(result).toMatchObject({ status: "ready", cached: false });
    expect(renderer.calls).toHaveLength(2);
    expect(renderer.calls[1]).toContain("Revised notes");
    expect(await env.BUCKET.head(pdfKey(first))).not.toBeNull();
  });
});

describe("PDF download routes", () => {
  beforeEach(async () => {
    await clearUsers();
    await seedUser("owner@example.com", "owner");
  });

  async function tokenOf(id: string): Promise<string> {
    const row = await env.DB.prepare("SELECT public_token AS t FROM documents WHERE id = ?")
      .bind(id)
      .first<{ t: string }>();
    return row?.t ?? "";
  }

  it("serves the public PDF as an attachment named after the number", async () => {
    const id = await sentInvoice({ clientId });
    const res = await apiFetch(`/p/${await tokenOf(id)}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="INV-0001.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toContain("%PDF");
    expect((await apiFetch("/p/nope/pdf")).status).toBe(404);
  });

  it("shows a being-prepared page when the lease stays busy", async () => {
    const id = await sentInvoice({ clientId });
    await env.DB.prepare("INSERT INTO leases (name, holder, expires_at) VALUES ('browser', 'x', ?)")
      .bind(Date.now() + 60_000)
      .run();
    const res = await apiFetch(`/p/${await tokenOf(id)}/pdf`);
    expect(res.status).toBe(202);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(await res.text()).toContain("being prepared");
  });

  it("serves the authenticated PDF for a chosen revision", async () => {
    const id = await sentInvoice({ clientId });
    await revise(db, id, documentUpdateInput.parse({ notes: "Second" }), {
      now: NOW,
      fetcher: noFetch,
    });
    const res = await apiFetch(`/api/documents/${id}/pdf?revision=1`, { as: "owner@example.com" });
    expect(res.status).toBe(200);
    expect(renderer.calls[0]).not.toContain("Second");
    const missing = await apiFetch(`/api/documents/${id}/pdf?revision=9`, {
      as: "owner@example.com",
    });
    expect(missing.status).toBe(404);
    expect((await apiFetch(`/api/documents/${id}/pdf`)).status).toBe(401);
  });

  it("returns 409 for a draft and 502 JSON when the render fails", async () => {
    const draftId = await draft({ clientId });
    const res = await apiFetch(`/api/documents/${draftId}/pdf`, { as: "owner@example.com" });
    expect(res.status).toBe(409);

    setPdfRendererForTesting(failingRenderer());
    await finalize(db, draftId, { now: NOW, fetcher: noFetch });
    const failed = await apiFetch(`/api/documents/${draftId}/pdf`, { as: "owner@example.com" });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: "pdf_render_failed" });
  });
});
