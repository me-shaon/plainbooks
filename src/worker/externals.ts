// The one place that picks real or fake adapters for the external services: Resend,
// Frankfurter, and Browser Run. The fakes exist for the end-to-end tests. They are used
// only when APP_ENV is exactly "development" and FAKE_EXTERNALS is "1".
import type { Bindings } from "./env";
import type { Fetcher } from "./services/fx";
import type { PdfRenderer, RenderOutcome } from "./services/pdf";

type ExternalsEnv = Pick<Bindings, "APP_ENV" | "FAKE_EXTERNALS">;

/** The fixed rate the fake Frankfurter returns: 1 unit of any currency = 120 home units. */
export const FAKE_FX_RATE = 120;

export interface FakeEmail {
  id: string;
  to: string[];
  subject: string;
}

/** Emails the fake Resend accepted, newest last. In memory only. */
export const fakeOutbox: FakeEmail[] = [];

export interface FakeExternals {
  fxFetch: Fetcher;
  resendFetch: Fetcher;
  pdfRenderer: PdfRenderer;
}

/** True only for local development with FAKE_EXTERNALS=1. Production never uses fakes. */
export function fakeExternalsEnabled(env: ExternalsEnv): boolean {
  return env.APP_ENV === "development" && env.FAKE_EXTERNALS === "1";
}

/** The fake adapters, or null when the real services apply. */
export function fakeExternals(env: ExternalsEnv): FakeExternals | null {
  if (!fakeExternalsEnabled(env)) return null;
  return { fxFetch: fakeFrankfurter, resendFetch: fakeResend, pdfRenderer: fakePdfRenderer };
}

const realFetch: Fetcher = (input, init) => fetch(input, init);

/** The fetch for Frankfurter exchange rates. */
export function fxFetcher(env: ExternalsEnv): Fetcher {
  return fakeExternals(env)?.fxFetch ?? realFetch;
}

/** The fetch for the Resend API. */
export function resendFetcher(env: ExternalsEnv): Fetcher {
  return fakeExternals(env)?.resendFetch ?? realFetch;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const fakeFrankfurter: Fetcher = async (input) => {
  // https://api.frankfurter.dev/v2/rate/USD/BDT?date=2026-10-23
  const url = new URL(input);
  const [, , , from = "", to = ""] = url.pathname.split("/");
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  return Response.json({ date, base: from, quote: to, rate: FAKE_FX_RATE });
};

const fakeResend: Fetcher = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { to?: string[]; subject?: string };
  const email: FakeEmail = {
    id: `fake_${crypto.randomUUID()}`,
    to: body.to ?? [],
    subject: body.subject ?? "",
  };
  fakeOutbox.push(email);
  console.log("fake resend", JSON.stringify(email));
  return Response.json({ id: email.id });
};

const fakePdfRenderer: PdfRenderer = {
  async render(): Promise<RenderOutcome> {
    return { ok: true, bytes: tinyPdf(), browserMs: null };
  },
};

/** A one-page, valid PDF with correct cross-reference offsets. */
export function tinyPdf(): ArrayBuffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out).buffer as ArrayBuffer;
}
