import { env } from "cloudflare:workers";
import type { PdfRenderer, RenderOutcome } from "../../src/worker/services/pdf";

export const PDF_BYTES = new TextEncoder().encode("%PDF-1.7 test");

/** A renderer stub that records each HTML input and answers with `outcome`. */
export function stubRenderer(outcome?: () => RenderOutcome): PdfRenderer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async render(html) {
      calls.push(html);
      return outcome?.() ?? { ok: true, bytes: PDF_BYTES.slice().buffer, browserMs: 1234 };
    },
  };
}

export const failingRenderer = () =>
  stubRenderer(() => ({ ok: false, status: 500, message: "boom", rateLimited: false }));

/** Deletes the browser lease and every cached PDF. */
export async function resetPdfState(): Promise<void> {
  await env.DB.prepare("DELETE FROM leases").run();
  const listed = await env.BUCKET.list({ prefix: "pdfs/" });
  if (listed.objects.length) await env.BUCKET.delete(listed.objects.map((o) => o.key));
}
