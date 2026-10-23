import { Hono } from "hono";
import {
  documentCreateInput,
  documentUpdateInput,
  finalizeInput,
  paymentInput,
  writeOffInput,
} from "../../shared/schemas/document";
import type { AppEnv } from "../env";
import { parseJson } from "../errors";
import { listActivity } from "../services/activity";
import {
  convertQuote,
  createDraft,
  deleteDraft,
  duplicateDocument,
  finalize,
  getDocumentDetail,
  listDocuments,
  listRevisions,
  loadDocument,
  revise,
  updateDraft,
  voidDocument,
} from "../services/documents";
import { deletePayment, recordPayment, writeOffRemainder } from "../services/payments";

/**
 * Quotes and invoices, mounted at /api/documents. Owners and Members can do everything
 * here, except that only an Owner can set auto-send reminders on a document (R55).
 */
export const documentRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listDocuments(c.var.db, c.req.query(), { now: Date.now() })))
  .post("/", async (c) => {
    const data = await parseJson(c, documentCreateInput);
    const now = Date.now();
    const id = await createDraft(c.var.db, data, { actor: c.var.user, now });
    return c.json(await getDocumentDetail(c.var.db, id, { now }), 201);
  })
  .get("/:id", async (c) =>
    c.json(await getDocumentDetail(c.var.db, c.req.param("id"), { now: Date.now() })),
  )
  .patch("/:id", async (c) => {
    const data = await parseJson(c, documentUpdateInput);
    const now = Date.now();
    await updateDraft(c.var.db, c.req.param("id"), data, { actor: c.var.user, now });
    return c.json(await getDocumentDetail(c.var.db, c.req.param("id"), { now }));
  })
  .delete("/:id", async (c) => {
    await deleteDraft(c.var.db, c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/:id/finalize", async (c) => {
    const input = await parseJson(c, finalizeInput);
    const now = Date.now();
    const result = await finalize(c.var.db, c.req.param("id"), {
      actor: c.var.user,
      now,
      issueDate: input.issueDate,
    });
    return c.json({
      document: await getDocumentDetail(c.var.db, result.document.id, { now }),
      revisionId: result.revision.id,
      allocated: result.allocated,
    });
  })
  .post("/:id/revise", async (c) => {
    const data = await parseJson(c, documentUpdateInput);
    const now = Date.now();
    const result = await revise(c.var.db, c.req.param("id"), data, { actor: c.var.user, now });
    return c.json({
      document: await getDocumentDetail(c.var.db, result.document.id, { now }),
      revisionId: result.revision.id,
      revisionNumber: result.revision.revisionNumber,
    });
  })
  .post("/:id/void", async (c) => {
    const now = Date.now();
    await voidDocument(c.var.db, c.req.param("id"), { actor: c.var.user, now });
    return c.json(await getDocumentDetail(c.var.db, c.req.param("id"), { now }));
  })
  .post("/:id/duplicate", async (c) => {
    const now = Date.now();
    const id = await duplicateDocument(c.var.db, c.req.param("id"), { actor: c.var.user, now });
    return c.json(await getDocumentDetail(c.var.db, id, { now }), 201);
  })
  .post("/:id/convert", async (c) => {
    const now = Date.now();
    const id = await convertQuote(c.var.db, c.req.param("id"), { actor: c.var.user, now });
    return c.json(await getDocumentDetail(c.var.db, id, { now }), 201);
  })
  .post("/:id/payments", async (c) => {
    const input = await parseJson(c, paymentInput);
    const now = Date.now();
    await recordPayment(c.var.db, c.req.param("id"), input, { actor: c.var.user, now });
    return c.json(await getDocumentDetail(c.var.db, c.req.param("id"), { now }), 201);
  })
  .delete("/:id/payments/:paymentId", async (c) => {
    const now = Date.now();
    await deletePayment(c.var.db, c.req.param("id"), c.req.param("paymentId"), {
      actor: c.var.user,
      now,
    });
    return c.json(await getDocumentDetail(c.var.db, c.req.param("id"), { now }));
  })
  .post("/:id/write-off", async (c) => {
    const input = await parseJson(c, writeOffInput);
    const now = Date.now();
    await writeOffRemainder(c.var.db, c.req.param("id"), input, { actor: c.var.user, now });
    return c.json(await getDocumentDetail(c.var.db, c.req.param("id"), { now }));
  })
  .get("/:id/activity", async (c) => {
    await loadDocument(c.var.db, c.req.param("id"));
    return c.json({ items: await listActivity(c.var.db, c.req.param("id")) });
  })
  .get("/:id/revisions", async (c) =>
    c.json({ items: await listRevisions(c.var.db, c.req.param("id")) }),
  );
