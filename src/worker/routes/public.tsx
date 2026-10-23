/** @jsxImportSource hono/jsx */
import { Hono } from "hono";
import type { Child } from "hono/jsx";
import { MAX_DECISION_COMMENT, quoteDecisionInput } from "../../shared/schemas/document";
import { todayIn } from "../../shared/time";
import { createDb, type Db } from "../db/client";
import type { Document } from "../db/schema";
import type { AppEnv } from "../env";
import { AppError } from "../errors";
import { renderDocumentHtml, renderStateOf } from "../render";
import { longDate } from "../render/format";
import { cspNonce, documentHeaders } from "../render/http";
import { DOCUMENT_CSS_PATH } from "../render/styles";
import { guardedActivity } from "../services/activity";
import { decideQuote, getDocumentByToken, getRevision, loadWorkspace } from "../services/documents";
import { enqueue } from "../services/jobs";
import { getPdf, pdfResponse } from "../services/pdf";

/** The job U13 handles: emails the sender and every Owner about a quote decision. */
export const QUOTE_DECISION_JOB = "notify_quote_decision";

export interface QuoteDecisionJobPayload {
  documentId: string;
  decision: "accepted" | "declined";
  recipientUserIds: string[];
}

/** At most one "viewed" activity per document per hour. */
export const VIEW_WINDOW_MS = 60 * 60 * 1000;

const BOT_PATTERN =
  /bot|crawl|spider|preview|slurp|facebookexternalhit|whatsapp|telegram|discord|slack|linkedin|twitter|skype|embedly|vkshare|pinterest|curl|wget|python|httpie|go-http-client|okhttp|java\/|libwww|axios|node-fetch|headless|lighthouse/i;

/** True for link previews, crawlers, and command line clients. They record no view. */
export function isBotUserAgent(userAgent: string | undefined | null): boolean {
  if (!userAgent?.trim()) return true;
  return BOT_PATTERN.test(userAgent);
}

function notFoundPage(): Response {
  const nonce = cspNonce();
  const body = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>Not found</title>
        <link rel="stylesheet" href={DOCUMENT_CSS_PATH} />
      </head>
      <body>
        <main class="not-found">
          <h1>This link does not work</h1>
          <p>Check the link, or ask the sender for a new one.</p>
        </main>
      </body>
    </html>
  );
  return new Response(`<!doctype html>${body.toString()}`, {
    status: 404,
    headers: documentHeaders(nonce),
  });
}

async function recordView(db: Db, doc: Document, now: number): Promise<void> {
  await guardedActivity(
    db.$client,
    { documentId: doc.id, clientId: doc.clientId, type: "viewed", now },
    "NOT EXISTS (SELECT 1 FROM activity WHERE document_id = ? AND type = 'viewed' AND created_at > ?)",
    [doc.id, now - VIEW_WINDOW_MS],
  ).run();
}

/** The user who sent the quote and every Owner, without duplicates. */
async function decisionRecipients(db: Db, doc: Document): Promise<string[]> {
  const rows = await db.$client
    .prepare(
      `SELECT actor_user_id AS id FROM (
         SELECT actor_user_id FROM activity
         WHERE document_id = ? AND type = 'sent' AND actor_user_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1)
       UNION SELECT id FROM users WHERE role = 'owner'`,
    )
    .bind(doc.id)
    .all<{ id: string }>();
  const ids = rows.results.map((r) => r.id);
  if (ids.length === 0 && doc.createdBy) ids.push(doc.createdBy);
  return [...new Set(ids)];
}

function DecisionForm({
  token,
  expiryDate,
  error,
  comment,
}: {
  token: string;
  expiryDate: string | null;
  error?: string;
  comment?: string;
}) {
  return (
    <form class="decision" method="post" action={`/p/${token}/decision`}>
      <h2>Accept this quote?</h2>
      {expiryDate ? <p class="muted">You can accept it until {longDate(expiryDate)}.</p> : null}
      <label for="comment">Comment (optional)</label>
      <textarea
        id="comment"
        name="comment"
        maxlength={MAX_DECISION_COMMENT}
        aria-describedby={error ? "decision-error" : undefined}
      >
        {comment ?? ""}
      </textarea>
      {error ? (
        <p class="error" id="decision-error" role="alert">
          {error}
        </p>
      ) : null}
      <div class="buttons">
        <button class="button" type="submit" name="decision" value="accept">
          Accept quote
        </button>
        <button class="button secondary" type="submit" name="decision" value="decline">
          Decline
        </button>
      </div>
    </form>
  );
}

interface PageExtras {
  notice?: Child;
  formError?: string;
  comment?: string;
  status?: 200 | 400 | 409;
}

/** Renders the latest revision of the document behind `token`. */
async function documentPage(
  db: Db,
  doc: Document,
  token: string,
  now: number,
  extras: PageExtras = {},
): Promise<Response> {
  if (!doc.currentRevisionId) return notFoundPage();
  const [revision, ws] = await Promise.all([
    getRevision(db, doc.currentRevisionId),
    loadWorkspace(db),
  ]);
  const state = renderStateOf(doc, ws.timezone, now);
  const today = todayIn(ws.timezone, now);
  const canDecide =
    doc.kind === "quote" &&
    doc.status === "sent" &&
    (doc.expiryDate === null || doc.expiryDate >= today);
  const nonce = cspNonce();
  const html = renderDocumentHtml(revision.snapshot, {
    mode: "page",
    state,
    nonce,
    pdfUrl: `/p/${token}/pdf`,
    notice: extras.notice,
    after: canDecide ? (
      <DecisionForm
        token={token}
        expiryDate={doc.expiryDate}
        error={extras.formError}
        comment={extras.comment}
      />
    ) : undefined,
  });
  return new Response(html, { status: extras.status ?? 200, headers: documentHeaders(nonce) });
}

function Notice({ tone, children }: { tone: "success" | "danger"; children: string }) {
  return (
    <div class={`banner ${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <strong>{children}</strong>
    </div>
  );
}

/**
 * Public document links, mounted at /p. No sign-in: Cloudflare Access bypasses /p/*.
 * Unknown tokens get a 404 page with no detail.
 */
export const publicRoutes = new Hono<AppEnv>()
  .use("*", async (c, next) => {
    c.set("db", createDb(c.env.DB));
    await next();
  })
  .get("/:token", async (c) => {
    const db = c.var.db;
    const token = c.req.param("token");
    const doc = await getDocumentByToken(db, token);
    if (!doc?.currentRevisionId) return notFoundPage();
    const now = Date.now();
    if (c.req.method === "GET" && !isBotUserAgent(c.req.header("user-agent"))) {
      await recordView(db, doc, now);
    }
    return documentPage(db, doc, token, now);
  })
  .get("/:token/pdf", async (c) => {
    const doc = await getDocumentByToken(c.var.db, c.req.param("token"));
    if (!doc?.currentRevisionId) return notFoundPage();
    return pdfResponse(
      await getPdf(c.env, c.var.db, doc.currentRevisionId, { wait: true }),
      "html",
    );
  })
  .post("/:token/decision", async (c) => {
    const db = c.var.db;
    const token = c.req.param("token");
    const doc = await getDocumentByToken(db, token);
    if (doc?.kind !== "quote" || !doc.currentRevisionId) return notFoundPage();
    const now = Date.now();
    const form = await c.req.parseBody();
    const comment = typeof form.comment === "string" ? form.comment : undefined;
    const parsed = quoteDecisionInput.safeParse({ decision: form.decision, comment });
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((i) => i.path[0] === "comment");
      return documentPage(db, doc, token, now, {
        status: 400,
        comment: comment?.slice(0, MAX_DECISION_COMMENT),
        formError: tooLong
          ? `Use ${MAX_DECISION_COMMENT} characters or fewer`
          : "Choose Accept quote or Decline",
      });
    }
    let decided: Document;
    try {
      decided = await decideQuote(db, token, parsed.data, { now });
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      if (err.status === 404) return notFoundPage();
      const current = (await getDocumentByToken(db, token)) ?? doc;
      return documentPage(db, current, token, now, {
        status: err.status === 400 ? 400 : 409,
        notice: <Notice tone="danger">{err.message}</Notice>,
      });
    }
    const decision = decided.status === "accepted" ? "accepted" : "declined";
    const payload: QuoteDecisionJobPayload = {
      documentId: decided.id,
      decision,
      recipientUserIds: await decisionRecipients(db, decided),
    };
    await enqueue(
      db,
      { type: QUOTE_DECISION_JOB, payload, idempotencyKey: `${QUOTE_DECISION_JOB}:${decided.id}` },
      now,
    );
    return documentPage(db, decided, token, now, {
      notice: (
        <Notice tone="success">
          {decision === "accepted"
            ? "Thank you. You accepted this quote."
            : "Thank you. You declined this quote."}
        </Notice>
      ),
    });
  });
