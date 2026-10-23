import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { BrandKit, WorkspaceSettings } from "../../shared/schemas/settings";
import { logoUrl } from "../../shared/schemas/settings";
import { type Db, schema } from "../db/client";
import { AppError } from "../errors";

const { workspace, documents } = schema;

/** Invoice statuses that prove an invoice was sent. */
const SENT_INVOICE_STATUSES = ["sent", "partially_paid", "paid", "void"] as const;

async function workspaceRow(db: Db) {
  const [row] = await db.select().from(workspace).where(eq(workspace.id, 1));
  if (!row) throw new AppError(500, "workspace_missing", "The workspace row is missing");
  return row;
}

/** True after any invoice was sent. Then the home currency cannot change. */
export async function isHomeCurrencyLocked(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.kind, "invoice"),
        or(inArray(documents.status, SENT_INVOICE_STATUSES), isNotNull(documents.sentAt)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function getWorkspaceSettings(db: Db): Promise<WorkspaceSettings> {
  const [row, homeCurrencyLocked] = await Promise.all([workspaceRow(db), isHomeCurrencyLocked(db)]);
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
  const row = await workspaceRow(db);
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
