import { env } from "cloudflare:workers";
import type { ResendFetch } from "../../src/worker/services/email";

export interface ResendCall {
  url: string;
  headers: Headers;
  body: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
    reply_to?: string;
    attachments?: { filename: string; content: string }[];
  };
}

/** A Resend stub. `respond` decides each answer; the default accepts with an id. */
export function stubResend(
  respond: (call: ResendCall, index: number) => Response = (_, i) =>
    Response.json({ id: `email-${i + 1}` }),
): ResendFetch & { calls: ResendCall[] } {
  const calls: ResendCall[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    const call: ResendCall = {
      url,
      headers: new Headers(init.headers),
      body: JSON.parse(String(init.body)),
    };
    calls.push(call);
    return respond(call, calls.length - 1);
  }) as ResendFetch & { calls: ResendCall[] };
  fn.calls = calls;
  return fn;
}

/** Clears email, job, and notification rows and sets the sender address. */
export async function resetEmailState(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM email_log"),
    env.DB.prepare("DELETE FROM jobs"),
    env.DB.prepare("DELETE FROM notifications"),
    env.DB.prepare(
      "UPDATE workspace SET email_from_address = 'billing@studio.test', email_from_name = 'Studio One', reply_to_email = 'hello@studio.test'",
    ),
  ]);
}

/** Inserts `count` accepted emails for `day`, to reach the daily cap. */
export async function fillEmailLog(day: string, count: number): Promise<void> {
  const statements = Array.from({ length: count }, (_, i) =>
    env.DB.prepare(
      "INSERT INTO email_log (id, day, kind, trigger, recipients, subject, status, created_at) VALUES (?, ?, 'document', 'manual', '[]', 's', 'sent', 0)",
    ).bind(`fill-${day}-${i}`, day),
  );
  await env.DB.batch(statements);
}
