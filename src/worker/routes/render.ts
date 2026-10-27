import { Hono } from "hono";
import type { DocumentSnapshot } from "../../shared/schemas/document";
import { renderPreviewInput } from "../../shared/schemas/template";
import type { AppEnv } from "../env";
import { parseJson } from "../errors";
import { previewState, renderDocumentHtml, renderStateOf } from "../render";
import { cspNonce, documentHeaders } from "../render/http";
import { sampleSnapshot } from "../render/sample";
import { listCustomFields } from "../services/custom-fields";
import {
  buildSnapshot,
  getRevision,
  loadDocument,
  loadWorkspace,
  workspaceToday,
} from "../services/documents";
import { getBrandKit } from "../services/settings";

function html(body: string, nonce: string): Response {
  return new Response(body, { headers: documentHeaders(nonce, "'self'") });
}

/**
 * In-app document previews, mounted at /render. `sessionAuth` covers every route. All
 * three render from a snapshot: a stored revision, a transient draft snapshot, or the
 * sample invoice.
 */
export const renderRoutes = new Hono<AppEnv>()
  .get("/draft/:documentId", async (c) => {
    const db = c.var.db;
    const now = Date.now();
    const [ws, doc] = await Promise.all([
      loadWorkspace(db),
      loadDocument(db, c.req.param("documentId")),
    ]);
    const snapshot = await buildSnapshot(db, doc.id, { now });
    const nonce = cspNonce();
    const state = renderStateOf(doc, ws.timezone, now);
    return html(renderDocumentHtml(snapshot, { mode: "page", state, nonce }), nonce);
  })
  .post("/preview", async (c) => {
    const db = c.var.db;
    const now = Date.now();
    const input = await parseJson(c, renderPreviewInput);
    const ws = await loadWorkspace(db);
    let snapshot: DocumentSnapshot;
    if (input.documentId) {
      const built = await buildSnapshot(db, input.documentId, { now });
      snapshot = { ...built, template: { ...built.template, config: input.config } };
    } else {
      const [brandKit, defs] = await Promise.all([getBrandKit(db), listCustomFields(db)]);
      snapshot = sampleSnapshot({
        brandKit,
        config: input.config,
        defs,
        homeCurrency: ws.homeCurrency,
        today: workspaceToday(ws, now),
        now,
      });
    }
    const nonce = cspNonce();
    const state = previewState(ws.timezone, now);
    return html(renderDocumentHtml(snapshot, { mode: "page", state, nonce }), nonce);
  })
  .get("/:revisionId", async (c) => {
    const db = c.var.db;
    const now = Date.now();
    const revision = await getRevision(db, c.req.param("revisionId"));
    const [ws, doc] = await Promise.all([loadWorkspace(db), loadDocument(db, revision.documentId)]);
    const nonce = cspNonce();
    const state = renderStateOf(doc, ws.timezone, now);
    return html(renderDocumentHtml(revision.snapshot, { mode: "page", state, nonce }), nonce);
  });
