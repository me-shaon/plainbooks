import { createMiddleware } from "hono/factory";
import { createRequestDb } from "../db/client";
import type { AppEnv, AuthUser, Bindings } from "../env";
import { AppError } from "../errors";
import { createAuth } from "./auth";

/**
 * The `/api/*` path prefixes that need no session. better-auth signs people in, setup
 * creates the first Owner, and invite links set a first password. Each webhook route
 * checks the signature of its provider instead.
 */
export const SESSION_EXEMPT_PREFIXES: readonly string[] = [
  "/api/auth/",
  "/api/setup/",
  "/api/invites/",
  "/api/webhooks/",
];

/**
 * The `/api/*` path prefixes that skip the cross-site guard. Providers post webhooks from
 * their own servers, so these requests are cross-site by design.
 */
export const CSRF_EXEMPT_PREFIXES: readonly string[] = ["/api/webhooks/"];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Methods that do not change data. They skip the origin check. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * True when the request path starts with one of the prefixes. The check uses the path as
 * sent (after dot-segment removal), so a percent-encoded variant is not exempt.
 */
function startsWithAny(url: string, prefixes: readonly string[]): boolean {
  const path = new URL(url).pathname;
  return prefixes.some((prefix) => path.startsWith(prefix));
}

/** True when the request needs no session. */
export function isSessionExempt(url: string): boolean {
  return startsWithAny(url, SESSION_EXEMPT_PREFIXES);
}

/** True when the request skips the cross-site guard. */
export function isCsrfExempt(url: string): boolean {
  return startsWithAny(url, CSRF_EXEMPT_PREFIXES);
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
 * Reads the better-auth session for the request and returns the signed-in member. Returns
 * null when the cookie is missing, tampered, or expired, or when the session is gone.
 * `headers` gets the Set-Cookie headers of a session refresh.
 */
async function readSession(
  env: Bindings,
  request: Request,
): Promise<{ user: SessionUser | null; headers: Headers }> {
  const auth = createAuth(env, request);
  const { headers, response } = await auth.api.getSession({
    headers: request.headers,
    returnHeaders: true,
  });
  if (!response) return { user: null, headers };
  const user = response.user as typeof response.user & { role?: unknown; status?: unknown };
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      role: user.role === "owner" ? "owner" : user.role === "member" ? "member" : null,
      status: typeof user.status === "string" ? user.status : null,
    },
    headers,
  };
}

interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: AuthUser["role"] | null;
  status: string | null;
}

/**
 * Reads the better-auth session on `/api/*` and `/render/*` and sets `c.var.user` and
 * `c.var.db`. Cross-site writes get 403 first. A missing, expired, or tampered session
 * gets 401. A user who is not an active member (status `invited`, or no known role) gets
 * 403.
 */
export const sessionAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!isCsrfExempt(c.req.url)) assertSameOriginWrite(c.req.raw, c.env);
  if (isSessionExempt(c.req.url)) return next();

  const { user, headers } = await readSession(c.env, c.req.raw);
  if (!user) throw new AppError(401, "unauthenticated", "Sign in to continue.");
  if (user.status !== "active" || !user.role) {
    throw new AppError(
      403,
      "not_a_member",
      "This email is not on the team. Ask an Owner to add it.",
    );
  }
  c.set("db", createRequestDb(c.env.DB));
  c.set("user", { id: user.id, email: user.email, name: user.name, role: user.role });
  await next();
  // A session refresh sends a new cookie with a later expiry.
  for (const cookie of headers.getSetCookie()) c.res.headers.append("set-cookie", cookie);
});

/** Allows only Owners. Use after `sessionAuth` (it runs on every `/api/*` route). */
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => {
  if (c.var.user?.role !== "owner") {
    throw new AppError(403, "owner_required", "Only an Owner can do this");
  }
  return next();
});
