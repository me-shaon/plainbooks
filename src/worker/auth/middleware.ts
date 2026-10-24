import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { createRequestDb, type Db, schema } from "../db/client";
import type { AppEnv, AuthUser, Bindings } from "../env";
import { AppError } from "../errors";
import { ACCESS_JWT_HEADER, AccessTokenError, verifyAccessJwt } from "./access";

/** The only `/api/*` path that skips Access. It verifies a Svix signature instead (U13). */
export const AUTH_EXEMPT_PATHS: ReadonlySet<string> = new Set(["/api/webhooks/resend"]);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Methods that do not change data. They skip the origin check. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * True when the raw request path is exactly an exempt path. The check uses the path as
 * sent, so percent-encoded or trailing-slash variants still need Access.
 */
export function isAuthExempt(url: string): boolean {
  return AUTH_EXEMPT_PATHS.has(new URL(url).pathname);
}

/**
 * The origins that may send writes: the origin of APP_URL. In development on a local host,
 * the request's own origin is allowed too, because the dev server is not on APP_URL.
 */
export function allowedOrigins(env: Bindings, url: string): Set<string> {
  const origins = new Set<string>();
  if (env.APP_URL) {
    try {
      origins.add(new URL(env.APP_URL).origin);
    } catch {
      // A malformed APP_URL allows no origin, so browser writes fail closed.
    }
  }
  const requestUrl = new URL(url);
  if (env.APP_ENV === "development" && LOCAL_HOSTS.has(requestUrl.hostname)) {
    origins.add(requestUrl.origin);
  }
  return origins;
}

/**
 * Blocks cross-site writes (CSRF). A write is refused when Sec-Fetch-Site is "cross-site",
 * or when it has an Origin header that is not an allowed origin. Requests with no Origin
 * header come from tools, not browser pages, so they pass.
 */
export function assertSameOriginWrite(request: Request, env: Bindings): void {
  if (SAFE_METHODS.has(request.method)) return;
  const refuse = () => {
    throw new AppError(403, "cross_site_request", "Cross-site requests are not allowed");
  };
  if (request.headers.get("sec-fetch-site") === "cross-site") refuse();
  const origin = request.headers.get("origin");
  if (origin !== null && !allowedOrigins(env, request.url).has(origin)) refuse();
}

/**
 * The dev bypass applies only when APP_ENV is exactly "development", the request host is
 * local, and DEV_USER_EMAIL is set.
 */
export function devBypassEmail(env: Bindings, url: string): string | null {
  if (env.APP_ENV !== "development") return null;
  if (!LOCAL_HOSTS.has(new URL(url).hostname)) return null;
  const email = env.DEV_USER_EMAIL?.trim().toLowerCase();
  return email ? email : null;
}

const userColumns = {
  id: schema.users.id,
  email: schema.users.email,
  name: schema.users.name,
  role: schema.users.role,
};

/**
 * Finds the team member by email. When the users table is empty and the email is
 * OWNER_EMAIL, creates that user as the first Owner. Returns null for anyone else.
 */
export async function resolveUser(db: Db, env: Bindings, email: string): Promise<AuthUser | null> {
  const user = await findUser(db, email);
  if (user) return user;

  if (email !== env.OWNER_EMAIL?.trim().toLowerCase()) return null;
  // One statement, so two first requests cannot both create an Owner.
  const created = await env.DB.prepare(
    `INSERT INTO users (id, email, role)
     SELECT ?1, ?2, 'owner' WHERE NOT EXISTS (SELECT 1 FROM users)
     ON CONFLICT DO NOTHING
     RETURNING id, email, name, role`,
  )
    .bind(crypto.randomUUID(), email)
    .first<AuthUser>();
  if (created) return created;
  // A concurrent first request may have created the Owner a moment ago.
  return findUser(db, email);
}

async function findUser(db: Db, email: string): Promise<AuthUser | null> {
  const [user] = await db
    .select(userColumns)
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  return user ?? null;
}

/**
 * Verifies the Access JWT on `/api/*` and `/render/*` and sets `c.var.user` and `c.var.db`.
 * Cross-site writes get 403 first. Missing or invalid tokens get 401. Valid tokens for
 * unknown emails get 403.
 */
export const accessAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (isAuthExempt(c.req.url)) return next();
  assertSameOriginWrite(c.req.raw, c.env);

  let email = devBypassEmail(c.env, c.req.url);
  if (!email) {
    const token = c.req.header(ACCESS_JWT_HEADER);
    if (!token) throw new AppError(401, "unauthenticated", "Sign in through Cloudflare Access");
    try {
      ({ email } = await verifyAccessJwt(token, {
        teamDomain: c.env.ACCESS_TEAM_DOMAIN,
        audience: c.env.ACCESS_AUD,
      }));
    } catch (err) {
      if (err instanceof AccessTokenError) {
        throw new AppError(401, "unauthenticated", "Your sign-in is not valid. Sign in again.");
      }
      throw err;
    }
  }

  const db = createRequestDb(c.env.DB);
  const user = await resolveUser(db, c.env, email);
  if (!user) {
    throw new AppError(
      403,
      "not_a_member",
      "This email is not on the team. Ask an Owner to add it.",
    );
  }
  c.set("db", db);
  c.set("user", user);
  return next();
});

/** Allows only Owners. Use after `accessAuth` (it runs on every `/api/*` route). */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.user?.role !== "owner") {
    throw new AppError(403, "owner_required", "Only an Owner can do this");
  }
  return next();
});
