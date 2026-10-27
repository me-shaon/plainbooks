import type { InviteKind } from "../../shared/domain";
import { createPasswordHasher, resolveIterations } from "../auth/pbkdf2";
import type { Bindings } from "../env";
import { AppError } from "../errors";

// Invite links for new members and sign-in reset links that an Owner issued. Both live in
// the `invites` table. A token is 32 random bytes. Only its SHA-256 (hex) is stored, and a
// link is found by that hash. Opening the link loads a page. Only the page's POST uses the
// token, so a mail scanner that prefetches the link does not use it up.

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 24 * 60 * 60 * 1000;

/** The web page that an invite or reset link opens. */
export const INVITE_PAGE_PATH = "/invite";

const TTL_BY_KIND: Record<InviteKind, number> = { invite: INVITE_TTL_MS, reset: RESET_TTL_MS };

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A new link token: 32 random bytes from the Web Crypto RNG, base64url encoded. */
export function newLinkToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The SHA-256 of a token, as hex. The table stores only this value. */
export async function hashLinkToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The link that the Owner copies or the invite email holds. */
export function linkUrl(origin: string, token: string): string {
  return `${origin}${INVITE_PAGE_PATH}/${encodeURIComponent(token)}`;
}

export interface IssuedLink {
  token: string;
  expiresAt: number;
  /** The statements that replace the user's open link of this kind. Run them in a batch. */
  statements: D1PreparedStatement[];
}

/**
 * Builds the statements for a new link. An unused link of the same kind for the user is
 * deleted first, so the old link stops working and each user has at most one open link
 * per kind.
 */
export async function issueLink(
  d1: D1Database,
  input: { userId: string; kind: InviteKind; createdBy: string | null; now: number },
): Promise<IssuedLink> {
  const token = newLinkToken();
  const expiresAt = input.now + TTL_BY_KIND[input.kind];
  const statements = [
    d1
      .prepare("DELETE FROM invites WHERE user_id = ? AND kind = ? AND used_at IS NULL")
      .bind(input.userId, input.kind),
    d1
      .prepare(
        `INSERT INTO invites (id, user_id, kind, token_hash, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.userId,
        input.kind,
        await hashLinkToken(token),
        expiresAt,
        input.createdBy,
        input.now,
      ),
  ];
  return { token, expiresAt, statements };
}

/** One link with its user, as the invite page and the accept call read it. */
export interface LinkRecord {
  id: string;
  kind: InviteKind;
  userId: string;
  email: string;
  name: string | null;
  status: string;
  expiresAt: number;
  usedAt: number | null;
}

/** Finds a link by its token. Returns null for an unknown token. */
export async function findLink(d1: D1Database, token: string): Promise<LinkRecord | null> {
  const row = await d1
    .prepare(
      `SELECT i.id, i.kind, i.user_id AS userId, u.email, u.name, u.status,
              i.expires_at AS expiresAt, i.used_at AS usedAt
       FROM invites i JOIN users u ON u.id = i.user_id
       WHERE i.token_hash = ?`,
    )
    .bind(await hashLinkToken(token))
    .first<LinkRecord>();
  return row ?? null;
}

/** True when the link was not used and has not expired. */
export function isOpen(link: Pick<LinkRecord, "usedAt" | "expiresAt">, now: number): boolean {
  return link.usedAt === null && link.expiresAt > now;
}

/** One answer for an unknown, used, and expired link. */
export const LINK_INVALID = () =>
  new AppError(
    410,
    "link_invalid",
    "This link was used or has expired. Ask your Owner for a new link.",
  );

/**
 * Uses up the user's open invite and marks the user active, in one D1 batch. Returns
 * false when the user has no unused, unexpired invite. The session-create hook calls it
 * for an `invited` user, for example at a Google sign-in.
 */
export async function activateInvitedUser(
  d1: D1Database,
  userId: string,
  now: number,
): Promise<boolean> {
  const [used] = await d1.batch([
    d1
      .prepare(
        `UPDATE invites SET used_at = ?
         WHERE user_id = ? AND kind = 'invite' AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(now, userId, now),
    d1
      .prepare(
        `UPDATE users SET status = 'active', updated_at = ?
         WHERE id = ? AND status = 'invited' AND EXISTS (
           SELECT 1 FROM invites WHERE user_id = ? AND kind = 'invite' AND used_at = ?
         )`,
      )
      .bind(now, userId, userId, now),
  ]);
  return (used?.meta.changes ?? 0) > 0;
}

/** True when the user is `invited` and has an unused, unexpired invite. */
export async function hasOpenInvite(d1: D1Database, userId: string, now: number) {
  const row = await d1
    .prepare(
      `SELECT 1 FROM invites
       WHERE user_id = ? AND kind = 'invite' AND used_at IS NULL AND expires_at > ?`,
    )
    .bind(userId, now)
    .first();
  return row !== null;
}

/** The status of a user, or null for an unknown user. */
export async function userStatus(d1: D1Database, userId: string): Promise<string | null> {
  const row = await d1
    .prepare("SELECT status FROM users WHERE id = ?")
    .bind(userId)
    .first<{ status: string }>();
  return row?.status ?? null;
}

/**
 * Uses a link with a new password. For an invite it also sets the name and marks the
 * user active. Both kinds replace the password and end every session of the user. The
 * link use is the first statement and guards the rest, so a used or expired link
 * changes nothing. Returns the user ID. Throws 410 `link_invalid`.
 */
export async function acceptLink(
  env: Bindings,
  input: { token: string; name?: string | null; password: string; now: number },
): Promise<{ userId: string; kind: InviteKind }> {
  const d1 = env.DB;
  const link = await findLink(d1, input.token);
  if (!link || !isOpen(link, input.now)) throw LINK_INVALID();

  const hasher = createPasswordHasher(resolveIterations(env.PBKDF2_ITERATIONS));
  const passwordHash = await hasher.hash(input.password);
  const { now } = input;
  const usedNow = "EXISTS (SELECT 1 FROM invites WHERE id = ? AND used_at = ?)";
  const name = link.kind === "invite" ? input.name?.trim() || link.name : link.name;
  const results = await d1.batch([
    d1
      .prepare("UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?")
      .bind(now, link.id, now),
    d1
      .prepare(
        `UPDATE users SET name = ?, status = 'active', updated_at = ? WHERE id = ? AND ${usedNow}`,
      )
      .bind(name, now, link.userId, link.id, now),
    d1
      .prepare(
        `DELETE FROM accounts WHERE user_id = ? AND provider_id = 'credential' AND ${usedNow}`,
      )
      .bind(link.userId, link.id, now),
    d1
      .prepare(
        `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
         SELECT ?, ?, ?, 'credential', ?, ?, ? WHERE ${usedNow}`,
      )
      .bind(crypto.randomUUID(), link.userId, link.userId, passwordHash, now, now, link.id, now),
    // A reset or a first password ends every older session of the user.
    d1
      .prepare(`DELETE FROM sessions WHERE user_id = ? AND ${usedNow}`)
      .bind(link.userId, link.id, now),
    // An accepted invite also closes an open reset link, and the other way round.
    d1
      .prepare(`DELETE FROM invites WHERE user_id = ? AND used_at IS NULL AND ${usedNow}`)
      .bind(link.userId, link.id, now),
  ]);
  if ((results[0]?.meta.changes ?? 0) === 0) throw LINK_INVALID();
  return { userId: link.userId, kind: link.kind };
}
