import { and, eq, ne, or, sql } from "drizzle-orm";
import type { UserRole } from "../../shared/domain";
import type { MemberLink, MemberState, TeamMember } from "../../shared/schemas/settings";
import type { Db } from "../db/client";
import { schema } from "../db/client";
import { mailProviders } from "../email/mailer";
import { inviteEmail } from "../email/templates";
import type { AuthUser, Bindings } from "../env";
import { AppError } from "../errors";
import { deliverEmail } from "./email";
import { INVITE_TTL_MS, issueLink, linkUrl } from "./invites";
import { loadWorkspace } from "./settings";

const { sessions, users } = schema;

export const LAST_OWNER_MESSAGE =
  "The workspace needs at least one Owner. Make another member an Owner first.";

/** Active Owners only. An invited Owner cannot sign in yet, so it does not count. */
const ownerCount = sql`(SELECT count(*) FROM ${users} WHERE ${users.role} = 'owner' AND ${users.status} = 'active')`;
/** True when the row is not an active Owner, or when another active Owner exists. */
const keepsAnOwner = or(
  ne(users.role, "owner"),
  ne(users.status, "active"),
  sql`${ownerCount} > 1`,
);

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

/**
 * Removes a member and ends their sessions at once. Removing the last Owner fails with
 * 409 `last_owner`.
 */
export async function removeUser(db: Db, userId: string): Promise<void> {
  const [deleted] = await db
    .delete(users)
    .where(and(eq(users.id, userId), keepsAnOwner))
    .returning({ id: users.id });
  if (!deleted) await failMissingOrLastOwner(db, userId);
  // The foreign key cascade already deletes the sessions. This statement makes sure that
  // a removed member is signed out even if the cascade does not run.
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ---------------------------------------------------------------------------
// Invites and sign-in resets
// ---------------------------------------------------------------------------

interface MemberRow {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: string;
  createdAt: number;
  inviteExpiresAt: number | null;
  resetExpiresAt: number | null;
}

const MEMBER_SELECT = `
  SELECT u.id, u.email, u.name, u.role, u.status, u.created_at AS createdAt,
    (SELECT max(expires_at) FROM invites
      WHERE user_id = u.id AND kind = 'invite' AND used_at IS NULL) AS inviteExpiresAt,
    (SELECT max(expires_at) FROM invites
      WHERE user_id = u.id AND kind = 'reset' AND used_at IS NULL) AS resetExpiresAt
  FROM users u`;

function toMember(row: MemberRow, now: number): TeamMember {
  let state: MemberState = "active";
  let linkExpiresAt: number | null = null;
  if (row.status === "invited") {
    linkExpiresAt = row.inviteExpiresAt;
    state = linkExpiresAt !== null && linkExpiresAt > now ? "invited" : "expired";
  } else if (row.resetExpiresAt !== null) {
    state = "reset_pending";
    linkExpiresAt = row.resetExpiresAt;
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    state,
    linkExpiresAt,
    createdAt: row.createdAt,
  };
}

/** Every team member with its sign-in state, by email. */
export async function listTeam(d1: D1Database, now: number): Promise<TeamMember[]> {
  const { results } = await d1.prepare(`${MEMBER_SELECT} ORDER BY u.email`).all<MemberRow>();
  return results.map((row) => toMember(row, now));
}

async function memberById(d1: D1Database, userId: string, now: number): Promise<TeamMember> {
  const row = await d1.prepare(`${MEMBER_SELECT} WHERE u.id = ?`).bind(userId).first<MemberRow>();
  if (!row) throw new AppError(404, "user_not_found", "This team member does not exist");
  return toMember(row, now);
}

/** A display name from an email: the part before "@". better-auth needs a name. */
export function nameFromEmail(email: string): string {
  return email.split("@")[0]?.trim() || email;
}

export interface LinkContext {
  env: Bindings;
  db: Db;
  /** The Owner who issues the link. */
  actor: AuthUser;
  /** The public origin for the link, without a trailing slash. */
  origin: string;
  now: number;
}

/**
 * Emails an invite link. Returns false, and sends nothing, when email is not configured.
 * A failed send is logged and also returns false, so the Owner copies the link instead.
 */
async function sendInviteEmail(
  ctx: LinkContext,
  member: TeamMember,
  url: string,
): Promise<boolean> {
  try {
    const providers = await mailProviders(ctx.env, ctx.db);
    const ws = await loadWorkspace(ctx.db);
    const content = inviteEmail({
      workspace: ws.businessName || ws.name,
      accent: ws.accentColor,
      url,
      inviter: ctx.actor.name || ctx.actor.email,
      role: member.role === "owner" ? "an Owner" : "a Member",
      expiresInDays: INVITE_TTL_MS / (24 * 60 * 60 * 1000),
    });
    const { result } = await deliverEmail(
      ctx.env,
      ctx.db,
      {
        to: [member.email],
        subject: content.subject,
        html: content.html,
        text: content.text,
        kind: "notification",
      },
      { now: ctx.now, workspace: ws, providers },
    );
    return result.status === "sent";
  } catch (err) {
    if (!(err instanceof AppError && err.code === "email_not_configured")) {
      console.error("invite email failed", err instanceof Error ? err.message : err);
    }
    return false;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

const MEMBER_EXISTS = () => new AppError(409, "member_exists", "This email is already on the team");

/**
 * Adds a person as an `invited` user with a 7-day invite link. The email is marked
 * verified, so a Google sign-in with the same address links to this user. The invite
 * email goes out when email is configured. The link is in the answer either way.
 */
export async function addMember(
  ctx: LinkContext,
  input: { email: string; name: string | null; role: UserRole },
): Promise<MemberLink> {
  const d1 = ctx.env.DB;
  const existing = await d1
    .prepare("SELECT 1 FROM users WHERE email = ?")
    .bind(input.email)
    .first();
  if (existing) throw MEMBER_EXISTS();
  const userId = crypto.randomUUID();
  const issued = await issueLink(d1, {
    userId,
    kind: "invite",
    createdBy: ctx.actor.id,
    now: ctx.now,
  });
  try {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO users (id, email, name, role, status, email_verified, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'invited', 1, ?, ?)`,
        )
        .bind(
          userId,
          input.email,
          input.name || nameFromEmail(input.email),
          input.role,
          ctx.now,
          ctx.now,
        ),
      ...issued.statements,
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) throw MEMBER_EXISTS();
    throw err;
  }
  const member = await memberById(d1, userId, ctx.now);
  const link = linkUrl(ctx.origin, issued.token);
  const emailSent = await sendInviteEmail(ctx, member, link);
  return { member, link, kind: "invite", expiresAt: issued.expiresAt, emailSent };
}

/**
 * Replaces the invite link of an invited user with a new one that expires in 7 days.
 * The old link stops working. Fails with 409 `member_active` once the user has joined.
 */
export async function resendInvite(ctx: LinkContext, userId: string): Promise<MemberLink> {
  const d1 = ctx.env.DB;
  const current = await memberById(d1, userId, ctx.now);
  if (current.state !== "invited" && current.state !== "expired") {
    throw new AppError(409, "member_active", "This member has already joined");
  }
  const issued = await issueLink(d1, {
    userId,
    kind: "invite",
    createdBy: ctx.actor.id,
    now: ctx.now,
  });
  await d1.batch(issued.statements);
  const member = await memberById(d1, userId, ctx.now);
  const link = linkUrl(ctx.origin, issued.token);
  const emailSent = await sendInviteEmail(ctx, member, link);
  return { member, link, kind: "invite", expiresAt: issued.expiresAt, emailSent };
}

/**
 * Resets the sign-in of an active member: ends every session, removes the password, and
 * issues a reset link that expires in 24 hours. The link is not emailed. The Owner gives
 * it to the member.
 */
export async function resetSignIn(ctx: LinkContext, userId: string): Promise<MemberLink> {
  const d1 = ctx.env.DB;
  const current = await memberById(d1, userId, ctx.now);
  if (current.state === "invited" || current.state === "expired") {
    throw new AppError(409, "member_invited", "This person has not joined yet. Resend the invite.");
  }
  const issued = await issueLink(d1, {
    userId,
    kind: "reset",
    createdBy: ctx.actor.id,
    now: ctx.now,
  });
  await d1.batch([
    d1.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    d1
      .prepare("DELETE FROM accounts WHERE user_id = ? AND provider_id = 'credential'")
      .bind(userId),
    ...issued.statements,
  ]);
  const member = await memberById(d1, userId, ctx.now);
  return {
    member,
    link: linkUrl(ctx.origin, issued.token),
    kind: "reset",
    expiresAt: issued.expiresAt,
    emailSent: false,
  };
}
