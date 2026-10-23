import { env } from "cloudflare:workers";
import type { DocumentCreateInput } from "../../src/shared/schemas/document";
import { documentCreateInput } from "../../src/shared/schemas/document";
import { createDb, schema } from "../../src/worker/db/client";
import type { AuthUser } from "../../src/worker/env";
import { createDraft, finalize, markSent } from "../../src/worker/services/documents";
import type { Fetcher } from "../../src/worker/services/fx";

export const db = createDb(env.DB);

/** 2026-10-23 12:00 in Asia/Dhaka. */
export const NOW = Date.UTC(2026, 9, 23, 6, 0, 0);
export const TODAY = "2026-10-23";

/** A fetcher that fails the test if anything calls it. */
export const noFetch: Fetcher = async (url) => {
  throw new Error(`unexpected fetch: ${url}`);
};

/** Deletes documents, clients, and related rows, and resets the counters and brand kit. */
export async function resetDocuments(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM revision_tax_totals"),
    env.DB.prepare("DELETE FROM document_revisions"),
    env.DB.prepare("DELETE FROM payments"),
    env.DB.prepare("DELETE FROM activity"),
    env.DB.prepare("DELETE FROM custom_field_values"),
    env.DB.prepare("DELETE FROM custom_field_defs"),
    env.DB.prepare("DELETE FROM document_lines"),
    env.DB.prepare("DELETE FROM documents"),
    env.DB.prepare("DELETE FROM client_contacts"),
    env.DB.prepare("DELETE FROM clients"),
    env.DB.prepare("DELETE FROM tax_rates"),
    env.DB.prepare("DELETE FROM templates"),
    env.DB.prepare("DELETE FROM fx_rates"),
    env.DB.prepare("UPDATE counters SET value = 0"),
    env.DB.prepare(
      "UPDATE workspace SET business_name = 'Studio One', logo_key = NULL, default_template_id = NULL",
    ),
  ]);
}

export async function seedClient(values: Partial<typeof schema.clients.$inferInsert> = {}) {
  const [client] = await db
    .insert(schema.clients)
    .values({ name: "Northwind", defaultCurrency: "BDT", ...values })
    .returning();
  if (!client) throw new Error("client insert failed");
  await db
    .insert(schema.clientContacts)
    .values({ clientId: client.id, email: "ap@northwind.test", isPrimary: true });
  return client;
}

export async function seedTaxRate(rate = "15", name = `VAT ${rate}%`) {
  const [row] = await db.insert(schema.taxRates).values({ name, rate }).returning();
  if (!row) throw new Error("tax rate insert failed");
  return row;
}

export async function draft(
  input: Partial<DocumentCreateInput> & { clientId: string },
  actor: AuthUser | null = null,
): Promise<string> {
  const data = documentCreateInput.parse({
    kind: "invoice",
    lines: [{ description: "Design", quantity: "1", unitPrice: 200000 }],
    ...input,
  });
  return createDraft(db, data, { actor, now: NOW });
}

/** Creates, finalizes, and marks sent an invoice. Returns the document ID. */
export async function sentInvoice(
  input: Partial<DocumentCreateInput> & { clientId: string },
  now = NOW,
): Promise<string> {
  const id = await draft(input);
  const { revision } = await finalize(db, id, { now, fetcher: noFetch });
  await markSent(db, id, { revisionId: revision.id, now });
  return id;
}

export async function activityTypes(documentId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    "SELECT type FROM activity WHERE document_id = ? ORDER BY created_at, rowid",
  )
    .bind(documentId)
    .all<{ type: string }>();
  return rows.results.map((r) => r.type);
}

export async function counterValue(kind: "invoice" | "quote"): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM counters WHERE name = ?")
    .bind(kind)
    .first<{ value: number }>();
  return row?.value ?? -1;
}
