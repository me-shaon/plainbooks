import { desc, eq, sql } from "drizzle-orm";
import type { ActivityEntry } from "../../shared/schemas/document";
import { type Db, schema } from "../db/client";

const { activity } = schema;

/**
 * Activity types. Each state change writes exactly one row, in the same D1 batch as the
 * change. The scheduler writes invoice_overdue and quote_expired. U11 writes viewed.
 * U13 and U16 add their own email types (for example reminder_sent and email_bounced).
 */
export const ACTIVITY_TYPES = [
  "created",
  "updated",
  "finalized",
  "sent",
  "revised",
  "payment_recorded",
  "payment_deleted",
  "written_off",
  "voided",
  "duplicated",
  "converted",
  "quote_accepted",
  "quote_declined",
  "viewed",
  "invoice_overdue",
  "quote_expired",
  "send_failed",
  "email_bounced",
  "email_complained",
  "reminder_sent",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityInput {
  documentId: string;
  clientId: string;
  type: ActivityType | (string & {});
  actorUserId?: string | null;
  data?: Record<string, unknown> | null;
  now: number;
}

/** A Drizzle insert for a batch. */
export function activityInsert(db: Db, input: ActivityInput) {
  return db.insert(activity).values({
    documentId: input.documentId,
    clientId: input.clientId,
    type: input.type,
    actorUserId: input.actorUserId ?? null,
    data: input.data ?? null,
    createdAt: input.now,
  });
}

/**
 * A raw D1 insert that only writes the row when `guard` (an SQL condition) holds when the
 * batch runs. Use it after a conditional UPDATE, so a lost race writes no activity.
 */
export function guardedActivity(
  d1: D1Database,
  input: ActivityInput,
  guard: string,
  guardParams: unknown[],
): D1PreparedStatement {
  return d1
    .prepare(
      `INSERT INTO activity (id, document_id, client_id, type, actor_user_id, data, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
    )
    .bind(
      crypto.randomUUID(),
      input.documentId,
      input.clientId,
      input.type,
      input.actorUserId ?? null,
      input.data ? JSON.stringify(input.data) : null,
      input.now,
      ...guardParams,
    );
}

/** Writes one activity row on its own. */
export async function recordActivity(db: Db, input: ActivityInput): Promise<void> {
  await activityInsert(db, input);
}

/** The document's history, newest first. */
export async function listActivity(db: Db, documentId: string): Promise<ActivityEntry[]> {
  return db
    .select({
      id: activity.id,
      type: activity.type,
      actorUserId: activity.actorUserId,
      data: activity.data,
      createdAt: activity.createdAt,
    })
    .from(activity)
    .where(eq(activity.documentId, documentId))
    .orderBy(desc(activity.createdAt), desc(sql`rowid`))
    .limit(500);
}
