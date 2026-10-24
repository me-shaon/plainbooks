import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { BrandKit, WorkspaceSettings } from "../../shared/schemas/settings";
import { logoUrl } from "../../shared/schemas/settings";
import { type Db, isRequestScoped, schema } from "../db/client";
import type { Workspace } from "../db/schema";
import { AppError } from "../errors";

const { workspace, documents } = schema;

/** Invoice statuses that prove an invoice was sent. */
const SENT_INVOICE_STATUSES = ["sent", "partially_paid", "paid", "void"] as const;

/**
 * Workspace reads per request-scoped handle. Without it a send reads the same row five
 * times and the dashboard four times, and each read counts toward the D1 query limit.
 */
const workspaceReads = new WeakMap<Db, Promise<Workspace>>();

/** Drops the cached workspace row. Call it after every write to the workspace table. */
export function forgetWorkspace(db: Db): void {
  workspaceReads.delete(db);
}

async function readWorkspace(db: Db): Promise<Workspace> {
  const [row] = await db.select().from(workspace).where(eq(workspace.id, 1));
  if (!row) throw new AppError(500, "workspace_missing", "The workspace row is missing");
  return row;
}

/**
 * The workspace row. On a handle from `createRequestDb`, the first read is reused, and each
 * caller gets its own copy so no caller can change another caller's row.
 */
export async function loadWorkspace(db: Db): Promise<Workspace> {
  if (!isRequestScoped(db)) return readWorkspace(db);
  let read = workspaceReads.get(db);
  if (!read) {
    read = readWorkspace(db);
    workspaceReads.set(db, read);
    read.catch(() => workspaceReads.delete(db));
  }
  return structuredClone(await read);
}

/**
 * True after any document got a revision (a finalized invoice or a numbered quote) or any
 * invoice was sent. Revisions store home currency totals, so the home currency cannot change.
 */
export async function isHomeCurrencyLocked(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      or(
        isNotNull(documents.currentRevisionId),
        and(
          eq(documents.kind, "invoice"),
          or(inArray(documents.status, SENT_INVOICE_STATUSES), isNotNull(documents.sentAt)),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getWorkspaceSettings(db: Db): Promise<WorkspaceSettings> {
  const [row, homeCurrencyLocked] = await Promise.all([
    loadWorkspace(db),
    isHomeCurrencyLocked(db),
  ]);
  return {
    name: row.name,
    homeCurrency: row.homeCurrency,
    homeCurrencyLocked,
    timezone: row.timezone,
    invoicePrefix: row.invoicePrefix,
    quotePrefix: row.quotePrefix,
    numberPadding: row.numberPadding,
    defaultPaymentTermsDays: row.defaultPaymentTermsDays,
    defaultQuoteValidityDays: row.defaultQuoteValidityDays,
    defaultTemplateId: row.defaultTemplateId,
    defaultTaxRateId: row.defaultTaxRateId,
    reminderMode: row.reminderMode,
    recurringSendMode: row.recurringSendMode,
    reminderSchedule: row.reminderSchedule,
    overdueReminderCap: row.overdueReminderCap,
    emailFromName: row.emailFromName,
    emailFromAddress: row.emailFromAddress,
    replyToEmail: row.replyToEmail,
  };
}

/**
 * The current brand kit. Drafts and previews read it live. Send copies it into the
 * revision snapshot, so later changes never alter a sent document.
 */
export async function getBrandKit(db: Db): Promise<BrandKit> {
  return brandKitOf(await loadWorkspace(db));
}

/** The brand kit fields of a workspace row. */
export function brandKitOf(row: Workspace): BrandKit {
  return {
    businessName: row.businessName,
    logoKey: row.logoKey,
    logoUrl: logoUrl(row.logoKey),
    accentColor: row.accentColor,
    font: row.font,
    address: row.address,
    taxId: row.taxId,
    bankDetails: row.bankDetails,
    footerText: row.footerText,
  };
}
