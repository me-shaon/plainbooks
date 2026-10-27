import { type Context, Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import {
  recoverOwnerInput,
  SETUP_TOKEN_MIN_LENGTH,
  type SetupStatus,
  setupOwnerInput,
} from "../../shared/schemas/setup";
import { createAuth, googleEnabled, SESSION_EXPIRES_IN_SECONDS } from "../auth/auth";
import { createPasswordHasher, resolveIterations } from "../auth/pbkdf2";
import { assertRateLimits, clientIp, RATE_RULES, rateKeys } from "../auth/rate-limit";
import { createDb } from "../db/client";
import { mailProviders } from "../email/mailer";
import { ownerRecoveredEmail } from "../email/templates";
import type { AppEnv, Bindings } from "../env";
import { AppError, parseJson } from "../errors";
import { appOrigin, deliverEmail, ownerEmails } from "../services/email";
import { loadWorkspace } from "../services/settings";

// First run and Owner recovery. These routes need no session (SESSION_EXEMPT_PREFIXES),
// and `sessionAuth` has already run the cross-site guard on the POSTs. Each setup token
// works once: its SHA-256 goes into `setup_token_uses` in the same D1 batch as the change.

/** The setup token from the environment, or null when it is missing or too short. */
function configuredToken(env: Bindings): string | null {
  const token = env.SETUP_TOKEN?.trim() ?? "";
  return token.length >= SETUP_TOKEN_MIN_LENGTH ? token : null;
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two digests of the same length in constant time. */
function sameDigest(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Turns the routes off without a usable token (404), then counts the attempt per IP and
 * for the whole deployment. A counter failure refuses the attempt (fail closed).
 */
async function guardAttempt(c: Context<AppEnv>): Promise<string> {
  const token = configuredToken(c.env);
  if (!token) throw new AppError(404, "setup_disabled", "Setup is turned off");
  await assertRateLimits(c.env, [
    { key: rateKeys.ip("setup", clientIp(c.req.raw)), rule: RATE_RULES.setupIp },
    { key: rateKeys.global("setup"), rule: RATE_RULES.setupGlobal },
  ]);
  return token;
}

/** The SHA-256 of the submitted token, as hex, when it matches SETUP_TOKEN. Else null. */
async function matchingTokenHash(submitted: string, configured: string): Promise<string | null> {
  const [given, expected] = await Promise.all([sha256(submitted), sha256(configured)]);
  return sameDigest(given, expected) ? toHex(given) : null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

const WRONG_TOKEN = () => new AppError(401, "invalid_setup_token", "The setup token is not right");
/** One answer for an unknown email, a non-Owner email, and a bad or used token. */
const RECOVERY_REFUSED = () =>
  new AppError(401, "recovery_refused", "The setup token or the Owner email is not right");
const SETUP_CLOSED = () =>
  new AppError(409, "setup_closed", "Setup is closed. An Owner already exists.");

async function hasUsers(d1: D1Database): Promise<boolean> {
  return (await d1.prepare("SELECT 1 FROM users LIMIT 1").first()) !== null;
}

async function emailConfigured(env: Bindings): Promise<boolean> {
  try {
    return (await mailProviders(env, createDb(env.DB))).length > 0;
  } catch {
    return false;
  }
}

/** Creates a better-auth session for the user and sets the signed session cookie. */
async function signIn(c: Context<AppEnv>, userId: string): Promise<void> {
  const ctx = await createAuth(c.env, c.req.raw).$context;
  const session = await ctx.internalAdapter.createSession(userId, false, {
    ipAddress: clientIp(c.req.raw),
    userAgent: c.req.header("user-agent") ?? "",
  });
  const cookie = ctx.authCookies.sessionToken;
  const secret = c.env.AUTH_SECRET?.trim() ?? "";
  await setSignedCookie(c, cookie.name, session.token, secret, {
    path: cookie.attributes.path ?? "/",
    httpOnly: cookie.attributes.httpOnly ?? true,
    secure: cookie.attributes.secure ?? false,
    sameSite: cookie.attributes.sameSite ?? "lax",
    maxAge: SESSION_EXPIRES_IN_SECONDS,
  });
}

/** Emails every Owner about a recovery. Errors are logged, so the recovery still succeeds. */
async function notifyOwners(env: Bindings, email: string, now: number): Promise<void> {
  try {
    const db = createDb(env.DB);
    const providers = await mailProviders(env, db).catch(() => null);
    if (!providers) return;
    const ws = await loadWorkspace(db);
    const to = await ownerEmails(db);
    if (to.length === 0) return;
    const when = new Date(now).toLocaleString("en-US", {
      timeZone: ws.timezone,
      dateStyle: "medium",
      timeStyle: "short",
    });
    const content = ownerRecoveredEmail({
      workspace: ws.businessName || ws.name,
      accent: ws.accentColor,
      url: `${appOrigin(env)}/`,
      email,
      when,
    });
    await deliverEmail(
      env,
      db,
      {
        to,
        subject: content.subject,
        html: content.html,
        text: content.text,
        kind: "notification",
      },
      { now, workspace: ws, providers },
    );
  } catch (err) {
    console.error("owner recovery email failed", err instanceof Error ? err.message : err);
  }
}

export const setupRoutes = new Hono<AppEnv>()
  /** GET /api/setup/status: what the setup and sign-in screens need before a session. */
  .get("/status", async (c) => {
    const [users, email] = await Promise.all([hasUsers(c.env.DB), emailConfigured(c.env)]);
    c.header("cache-control", "no-store");
    return c.json<SetupStatus>({
      needsSetup: !users,
      setupEnabled: configuredToken(c.env) !== null,
      googleEnabled: googleEnabled(c.env),
      emailConfigured: email,
    });
  })

  /** POST /api/setup/owner: creates the first Owner with the setup token and signs them in. */
  .post("/owner", async (c) => {
    const configured = await guardAttempt(c);
    const input = await parseJson(c, setupOwnerInput);
    const tokenHash = await matchingTokenHash(input.token, configured);
    if (!tokenHash) throw WRONG_TOKEN();
    // A cheap check first, so a closed setup does no hash work. The batch guard decides.
    if (await hasUsers(c.env.DB)) throw SETUP_CLOSED();

    const hasher = createPasswordHasher(resolveIterations(c.env.PBKDF2_ITERATIONS));
    const passwordHash = await hasher.hash(input.password);
    const now = Date.now();
    const userId = crypto.randomUUID();
    const noUsers = "NOT EXISTS (SELECT 1 FROM users)";
    const d1 = c.env.DB;
    let results: D1Result[];
    try {
      // One transaction: the token use, the Owner, and the password. Every insert is
      // guarded, so a parallel call that loses the race writes nothing.
      results = await d1.batch([
        d1
          .prepare(
            `INSERT INTO setup_token_uses (token_hash, kind, used_at)
             SELECT ?, 'setup', ? WHERE ${noUsers}`,
          )
          .bind(tokenHash, now),
        d1
          .prepare(
            `INSERT INTO users (id, email, name, role, status, email_verified, created_at, updated_at)
             SELECT ?, ?, ?, 'owner', 'active', 1, ?, ? WHERE ${noUsers}`,
          )
          .bind(userId, input.email, input.name, now, now),
        d1
          .prepare(
            `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
             SELECT ?, ?, ?, 'credential', ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
          )
          .bind(crypto.randomUUID(), userId, userId, passwordHash, now, now, userId),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) throw WRONG_TOKEN();
      throw err;
    }
    if ((results[1]?.meta.changes ?? 0) === 0) throw SETUP_CLOSED();

    await signIn(c, userId);
    return c.json(
      { user: { id: userId, email: input.email, name: input.name, role: "owner" as const } },
      201,
    );
  })

  /**
   * POST /api/setup/recover: sets a new password for an Owner with an unused setup token,
   * and ends that Owner's sessions.
   */
  .post("/recover", async (c) => {
    const configured = await guardAttempt(c);
    const input = await parseJson(c, recoverOwnerInput);
    const tokenHash = await matchingTokenHash(input.token, configured);
    if (!tokenHash) throw RECOVERY_REFUSED();
    const d1 = c.env.DB;
    const owner = await d1
      .prepare("SELECT id FROM users WHERE email = ? AND role = 'owner' AND status = 'active'")
      .bind(input.email)
      .first<{ id: string }>();
    if (!owner) throw RECOVERY_REFUSED();
    const used = await d1
      .prepare("SELECT 1 FROM setup_token_uses WHERE token_hash = ?")
      .bind(tokenHash)
      .first();
    if (used) throw RECOVERY_REFUSED();

    const hasher = createPasswordHasher(resolveIterations(c.env.PBKDF2_ITERATIONS));
    const passwordHash = await hasher.hash(input.password);
    const now = Date.now();
    const credential = "user_id = ? AND provider_id = 'credential'";
    try {
      // One transaction. The token insert comes first, so a used token rolls back the rest.
      await d1.batch([
        d1
          .prepare(
            "INSERT INTO setup_token_uses (token_hash, kind, used_at) VALUES (?, 'recover', ?)",
          )
          .bind(tokenHash, now),
        d1
          .prepare(`UPDATE accounts SET password = ?, updated_at = ? WHERE ${credential}`)
          .bind(passwordHash, now, owner.id),
        d1
          .prepare(
            `INSERT INTO accounts (id, user_id, account_id, provider_id, password, created_at, updated_at)
             SELECT ?, ?, ?, 'credential', ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE ${credential})`,
          )
          .bind(crypto.randomUUID(), owner.id, owner.id, passwordHash, now, now, owner.id),
        d1.prepare("DELETE FROM sessions WHERE user_id = ?").bind(owner.id),
        d1
          .prepare(
            `INSERT INTO activity (id, type, actor_user_id, data, created_at)
             VALUES (?, 'owner_recovered', ?, ?, ?)`,
          )
          .bind(crypto.randomUUID(), owner.id, JSON.stringify({ email: input.email }), now),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) throw RECOVERY_REFUSED();
      throw err;
    }

    await notifyOwners(c.env, input.email, now);
    return c.json({ ok: true });
  });
