import { and, eq, ne, or, sql } from "drizzle-orm";
import type { UserRole } from "../../shared/domain";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import type { AuthUser } from "../env";
import { AppError } from "../errors";

const { users } = schema;

export const LAST_OWNER_MESSAGE =
  "The workspace needs at least one Owner. Make another member an Owner first.";

const ownerCount = sql`(SELECT count(*) FROM ${users} WHERE ${users.role} = 'owner')`;
/** True when the row is not an Owner, or when another Owner exists. */
const keepsAnOwner = or(ne(users.role, "owner"), sql`${ownerCount} > 1`);

const columns = { id: users.id, email: users.email, name: users.name, role: users.role };

async function failMissingOrLastOwner(db: Db, userId: string): Promise<never> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!existing) throw new AppError(404, "user_not_found", "This team member does not exist");
  throw new AppError(409, "last_owner", LAST_OWNER_MESSAGE);
}

/**
 * Changes a member's role. Demoting the last Owner fails with 409 `last_owner`.
 * The guard is part of the UPDATE, so two concurrent demotions cannot remove both Owners.
 */
export async function setUserRole(db: Db, userId: string, role: UserRole): Promise<AuthUser> {
  const guard = role === "owner" ? undefined : keepsAnOwner;
  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(users.id, userId), guard))
    .returning(columns);
  return updated ?? failMissingOrLastOwner(db, userId);
}

/** Removes a member. Removing the last Owner fails with 409 `last_owner`. */
export async function removeUser(db: Db, userId: string): Promise<void> {
  const [deleted] = await db
    .delete(users)
    .where(and(eq(users.id, userId), keepsAnOwner))
    .returning({ id: users.id });
  if (!deleted) await failMissingOrLastOwner(db, userId);
}
