// PDF service (U12). Renders a revision to PDF with a Browser Run Quick Action, caches the
// result in R2 per revision, and spaces Quick Actions 10 s apart with a D1 lease row.
import { eq } from "drizzle-orm";
import type { DocumentSnapshot } from "../../shared/schemas/document";
import { todayIn } from "../../shared/time";
import { type Db, schema } from "../db/client";
import type { Bindings } from "../env";
import { fakeExternals } from "../externals";
import type { RenderState } from "../render";
import { renderDocument } from "../render";
import { getRevision, loadWorkspace } from "./documents";

const { documentRevisions } = schema;

/** The Browser Run free tier allows one Quick Action every 10 s. */
export const BROWSER_LEASE_MS = 10_000;
export const BROWSER_LEASE_NAME = "browser";
/** Interactive downloads wait this long for the lease before they show "being prepared". */
export const PDF_MAX_WAIT_MS = 10_000;

export function pdfKey(revisionId: string): string {
  return `pdfs/${revisionId}.pdf`;
}

// ---------------------------------------------------------------------------
// Renderer abstraction (Quick Actions do not run locally, so tests stub this)
// ---------------------------------------------------------------------------

export type RenderOutcome =
  | { ok: true; bytes: ArrayBuffer; browserMs: number | null }
  | { ok: false; status: number; message: string; rateLimited: boolean };

export interface PdfRenderer {
  render(html: string): Promise<RenderOutcome>;
}

function browserMsOf(res: Response): number | null {
  const value = Number(res.headers.get("X-Browser-Ms-Used"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function errorMessageOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: { message?: string }[] };
    const message = body.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join("; ");
    if (message) return message;
  } catch {
    // Not JSON. Use the status below.
  }
  return `Browser Run returned HTTP ${res.status}`;
}

/** A Quick Action that takes longer than this counts as a failed render. */
export const PDF_RENDER_TIMEOUT_MS = 25_000;

/** The production renderer: `env.BROWSER.quickAction("pdf", ...)` with raw HTML. */
export function browserRunRenderer(
  browser: Pick<BrowserRun, "quickAction">,
  timeoutMs = PDF_RENDER_TIMEOUT_MS,
): PdfRenderer {
  return {
    async render(html) {
      let res: Response;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Browser Run did not answer within ${timeoutMs} ms`)),
            timeoutMs,
          );
        });
        res = await Promise.race([
          browser.quickAction("pdf", {
            html,
            gotoOptions: { waitUntil: "networkidle0", timeout: 20_000 },
            pdfOptions: { format: "a4", printBackground: true, preferCSSPageSize: true },
          }),
          timeout,
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, status: 0, message, rateLimited: false };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (res.ok) {
        return { ok: true, bytes: await res.arrayBuffer(), browserMs: browserMsOf(res) };
      }
      return {
        ok: false,
        status: res.status,
        message: await errorMessageOf(res),
        rateLimited: res.status === 429,
      };
    },
  };
}

let testRenderer: PdfRenderer | null = null;

/** Tests only: replaces the Browser Run renderer. Pass null to restore it. */
export function setPdfRendererForTesting(renderer: PdfRenderer | null): void {
  testRenderer = renderer;
}

function rendererFor(env: PdfEnv): PdfRenderer {
  return testRenderer ?? fakeExternals(env)?.pdfRenderer ?? browserRunRenderer(env.BROWSER);
}

// ---------------------------------------------------------------------------
// Lease
// ---------------------------------------------------------------------------

/**
 * Takes the "browser" lease for 10 s with one conditional upsert. When another call holds
 * it, returns the time the current lease ends.
 */
export async function acquireBrowserLease(
  d1: D1Database,
  now: number,
): Promise<{ acquired: true } | { acquired: false; until: number }> {
  const holder = crypto.randomUUID();
  const row = await d1
    .prepare(
      `INSERT INTO leases (name, holder, expires_at, last_used_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at,
         last_used_at = excluded.last_used_at
       WHERE leases.expires_at <= ?4
       RETURNING holder`,
    )
    .bind(BROWSER_LEASE_NAME, holder, now + BROWSER_LEASE_MS, now)
    .first<{ holder: string }>();
  if (row?.holder === holder) return { acquired: true };
  const current = await d1
    .prepare("SELECT expires_at AS until FROM leases WHERE name = ?")
    .bind(BROWSER_LEASE_NAME)
    .first<{ until: number }>();
  return { acquired: false, until: current?.until ?? now + BROWSER_LEASE_MS };
}

/** Pushes the lease end out, for example after Browser Run answered 429. */
async function extendBrowserLease(d1: D1Database, until: number): Promise<void> {
  await d1
    .prepare("UPDATE leases SET expires_at = max(expires_at, ?) WHERE name = ?")
    .bind(until, BROWSER_LEASE_NAME)
    .run();
}

// ---------------------------------------------------------------------------
// getPdf
// ---------------------------------------------------------------------------

export type PdfEnv = Pick<Bindings, "APP_ENV" | "FAKE_EXTERNALS"> & {
  BROWSER: BrowserRun;
  BUCKET: R2Bucket;
};

export interface GetPdfOptions {
  /** Wait for the lease (interactive downloads and sends). False returns pending at once. */
  wait?: boolean;
  /** The longest wait for the lease. Defaults to 10 s. */
  maxWaitMs?: number;
  /** The revision row when the caller already read it. Saves one D1 query. */
  revision?: Awaited<ReturnType<typeof getRevision>>;
  /** Tests only. */
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type PdfResult =
  | {
      status: "ready";
      bytes: Uint8Array;
      key: string;
      /** True when the PDF came from R2 without a browser call. */
      cached: boolean;
      filename: string;
      browserMs: number | null;
    }
  | { status: "pending"; retryAfterSeconds: number }
  | { status: "failed"; code: "pdf_render_failed"; message: string };

/** "INV-0042.pdf". Characters that are unsafe in a file name become "-". */
export function pdfFilename(snapshot: Pick<DocumentSnapshot, "document">): string {
  const base = snapshot.document.number ?? `${snapshot.document.kind}-draft`;
  return `${base.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
}

/**
 * The PDF shows the document as sent: no payments, no overdue or decision banners. It is
 * cached per revision, so live state would go stale. The public page shows the live state.
 */
export function pdfRenderState(snapshot: DocumentSnapshot, timeZone: string): RenderState {
  return {
    status: "sent",
    amountPaid: 0,
    today: snapshot.document.issueDate ?? todayIn(timeZone, snapshot.createdAt),
    timeZone,
    decidedAt: null,
    decisionComment: null,
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Returns the PDF of a revision. Order: the R2 cache, then the lease, then one Quick Action.
 * A browser error returns `failed` and stores nothing.
 */
export async function getPdf(
  env: PdfEnv,
  db: Db,
  revisionId: string,
  opts: GetPdfOptions = {},
): Promise<PdfResult> {
  const clock = opts.clock ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const key = pdfKey(revisionId);
  const revision =
    opts.revision?.id === revisionId ? opts.revision : await getRevision(db, revisionId);
  const filename = pdfFilename(revision.snapshot);

  const fromCache = async (): Promise<PdfResult | null> => {
    const object = await env.BUCKET.get(key);
    if (!object) return null;
    const bytes = new Uint8Array(await object.arrayBuffer());
    const browserMs = Number(object.customMetadata?.browserMs) || null;
    return { status: "ready", bytes, key, cached: true, filename, browserMs };
  };

  const cached = await fromCache();
  if (cached) return cached;

  const deadline = clock() + (opts.wait ? (opts.maxWaitMs ?? PDF_MAX_WAIT_MS) : 0);
  for (;;) {
    const lease = await acquireBrowserLease(db.$client, clock());
    if (lease.acquired) break;
    if (!opts.wait || lease.until > deadline) {
      return { status: "pending", retryAfterSeconds: retryAfter(lease.until, clock()) };
    }
    await sleep(Math.max(50, lease.until - clock() + 50));
    // Another request may have rendered this revision while we waited.
    const rendered = await fromCache();
    if (rendered) return rendered;
  }

  const ws = await loadWorkspace(db);
  const html = await renderDocument(env, revision.snapshot, {
    mode: "pdf",
    state: pdfRenderState(revision.snapshot, ws.timezone),
  });
  const outcome = await rendererFor(env).render(html);
  if (!outcome.ok) {
    console.error("pdf render failed", JSON.stringify({ revisionId, status: outcome.status }));
    if (outcome.rateLimited) {
      const until = clock() + BROWSER_LEASE_MS;
      await extendBrowserLease(db.$client, until);
      return { status: "pending", retryAfterSeconds: retryAfter(until, clock()) };
    }
    return { status: "failed", code: "pdf_render_failed", message: outcome.message };
  }

  console.log(
    "pdf rendered",
    JSON.stringify({ revisionId, browserMs: outcome.browserMs, bytes: outcome.bytes.byteLength }),
  );
  await env.BUCKET.put(key, outcome.bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: outcome.browserMs === null ? {} : { browserMs: String(outcome.browserMs) },
  });
  await db
    .update(documentRevisions)
    .set({ pdfKey: key })
    .where(eq(documentRevisions.id, revisionId));
  return {
    status: "ready",
    bytes: new Uint8Array(outcome.bytes),
    key,
    cached: false,
    filename,
    browserMs: outcome.browserMs,
  };
}

function retryAfter(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}

// ---------------------------------------------------------------------------
// HTTP helpers for the download routes
// ---------------------------------------------------------------------------

const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export const PDF_PENDING_MESSAGE = "The PDF is being prepared. Try again in a few seconds.";

/**
 * The download response for a PDF result. `pending` is 202 with Retry-After, as JSON for
 * the API or as a small HTML page for public links. `failed` is 502.
 */
export function pdfResponse(result: PdfResult, format: "json" | "html"): Response {
  if (result.status === "ready") {
    return new Response(result.bytes, {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Length": String(result.bytes.byteLength),
      },
    });
  }
  const pending = result.status === "pending";
  const status = pending ? 202 : 502;
  const message = pending ? PDF_PENDING_MESSAGE : "The PDF could not be created. Try again later.";
  const headers: Record<string, string> = { ...PRIVATE_HEADERS };
  if (pending) headers["Retry-After"] = String(result.retryAfterSeconds);
  if (format === "json") {
    return Response.json(
      pending
        ? {
            status: "pending",
            error: message,
            code: "pdf_pending",
            retryAfter: result.retryAfterSeconds,
          }
        : { status: "failed", error: message, code: result.code },
      { status, headers },
    );
  }
  headers["Content-Type"] = "text/html; charset=utf-8";
  headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  const refresh = pending
    ? `<meta http-equiv="refresh" content="${result.retryAfterSeconds}">`
    : "";
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">${refresh}<title>PDF</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#222}</style></head><body><h1>${pending ? "Preparing the PDF" : "PDF not available"}</h1><p>${message}</p></body></html>`;
  return new Response(body, { status, headers });
}
