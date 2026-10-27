import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import type { UserRole } from "../../src/shared/domain";
import { createAuth } from "../../src/worker/auth/auth";
import { createDb, schema } from "../../src/worker/db/client";

/** The better-auth context for tests: the internal adapter and the cookie names. */
async function authContext() {
  return createAuth(env, new Request(env.APP_URL)).$context;
}

/**
 * Signs a cookie value the way better-auth does: `value.base64(HMAC-SHA256(value))` with
 * AUTH_SECRET as the key, then URL-encoded.
 */
export async function signCookieValue(value: string, secret = env.AUTH_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const signature = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return encodeURIComponent(`${value}.${signature}`);
}

/** The name of the better-auth session cookie. */
export async function sessionCookieName(): Promise<string> {
  return (await authContext()).authCookies.sessionToken.name;
}

/** The Cookie header for a session token. */
export async function sessionCookie(token: string): Promise<string> {
  return `${await sessionCookieName()}=${await signCookieValue(token)}`;
}

/** Creates a better-auth session for the user and returns its token. */
export async function createSession(userId: string): Promise<string> {
  const session = await (await authContext()).internalAdapter.createSession(userId);
  return session.token;
}

/**
 * Creates a session for `email` and returns its Cookie header. Seeds the email as a
 * Member when no user has it.
 */
export async function signInAs(email: string): Promise<string> {
  const db = createDb(env.DB);
  const normalized = email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, normalized))
    .limit(1);
  const userId = existing?.id ?? (await seedUser(normalized)).id;
  return sessionCookie(await createSession(userId));
}

export interface AuthedInit extends RequestInit {
  /** Signs the request in as this email. Omit for an unauthenticated request. */
  as?: string;
  /** Sends a JSON body with the right content type. */
  json?: unknown;
}

/** Builds a Request for the Worker, with a session cookie when `as` is set. */
export async function buildRequest(path: string, init: AuthedInit = {}): Promise<Request> {
  const { as, json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (as) {
    const cookie = await signInAs(as);
    const current = headers.get("cookie");
    headers.set("cookie", current ? `${current}; ${cookie}` : cookie);
  }
  let body = rest.body;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  const url = path.startsWith("http") ? path : `https://app.test${path}`;
  return new Request(url, { ...rest, headers, body });
}

/** Sends a request through the Worker's fetch handler. */
export async function apiFetch(path: string, init: AuthedInit = {}): Promise<Response> {
  return exports.default.fetch(await buildRequest(path, init));
}

/** Inserts a team member. Emails are stored lowercase. The name is the part before "@". */
export async function seedUser(
  email: string,
  role: UserRole = "member",
  options: { status?: "invited" | "active" } = {},
) {
  const db = createDb(env.DB);
  const normalized = email.toLowerCase();
  const [user] = await db
    .insert(schema.users)
    .values({
      email: normalized,
      name: normalized.split("@")[0] || normalized,
      role,
      ...(options.status ? { status: options.status } : {}),
    })
    .returning();
  if (!user) throw new Error("user insert failed");
  return user;
}

/** Deletes every team member. Their sessions and accounts go with them. */
export async function clearUsers(): Promise<void> {
  await env.DB.prepare("DELETE FROM users").run();
}
