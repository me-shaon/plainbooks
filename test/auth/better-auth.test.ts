import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/worker/app";
import { createAuth, googleEnabled } from "../../src/worker/auth/auth";
import { hashPassword, parseHash } from "../../src/worker/auth/pbkdf2";
import { setRateBackendForTesting } from "../../src/worker/auth/rate-limit";
import { createDb, schema } from "../../src/worker/db/client";
import { clearUsers } from "../helpers/auth";
import { resetEmailState, useFakeEmail } from "../helpers/email";

const db = createDb(env.DB);
const ORIGIN = "https://invoices.example.com";
const PASSWORD = "correct horse battery staple";

/** Creates a user and its password the way setup and invites do: through better-auth. */
async function createAuthUser(
  email: string,
  options: { password?: string; hash?: string; role?: "owner" | "member" } = {},
) {
  const ctx = await createAuth(env, new Request(`${ORIGIN}/`)).$context;
  const user = await ctx.internalAdapter.createUser(
    {
      email,
      name: "Test User",
      emailVerified: false,
      ...(options.role ? { role: options.role } : {}),
    },
    { method: "email-password" },
  );
  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: options.hash ?? (await ctx.password.hash(options.password ?? PASSWORD)),
  });
  return user;
}

let ipCounter = 0;
/** A client IP that no other request in this file uses. */
const freshIp = () => `203.0.113.${++ipCounter}`;

function authFetch(path: string, init: { json?: unknown; ip?: string; cookie?: string } = {}) {
  const headers = new Headers({ "cf-connecting-ip": init.ip ?? freshIp(), origin: ORIGIN });
  if (init.cookie) headers.set("cookie", init.cookie);
  let body: string | undefined;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const request = new Request(`${ORIGIN}/api/auth${path}`, {
    method: init.json === undefined ? "GET" : "POST",
    headers,
    body,
  });
  return fetchAndWait(request);
}

/**
 * Sends a request and waits for its waitUntil work, such as the reset email, so a test
 * sees the result and no work runs into the next test.
 */
async function fetchAndWait(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await app.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function signIn(email: string, password: string, ip?: string) {
  return authFetch("/sign-in/email", { json: { email, password }, ...(ip ? { ip } : {}) });
}

/** The `name=value` pairs of the Set-Cookie headers, for a Cookie header. */
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

beforeEach(async () => {
  await clearUsers();
});
afterEach(async () => {
  setRateBackendForTesting(null);
  await resetEmailState();
  vi.restoreAllMocks();
});

describe("better-auth on the users table", () => {
  it("stores created_at as epoch ms and email_verified as a boolean", async () => {
    const before = Date.now();
    const user = await createAuthUser("new@example.com");
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.emailVerified).toBe(false);

    const raw = await env.DB.prepare(
      "SELECT created_at, updated_at, email_verified, status, role FROM users WHERE id = ?",
    )
      .bind(user.id)
      .first<Record<string, unknown>>();
    expect(typeof raw?.created_at).toBe("number");
    expect(raw?.created_at).toBeGreaterThanOrEqual(before);
    expect(raw?.created_at).toBeLessThanOrEqual(Date.now());
    expect(raw).toMatchObject({ email_verified: 0, status: "active", role: "member" });

    const [row] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(row?.emailVerified).toBe(false);
    expect(row?.createdAt.getTime()).toBe(raw?.created_at);

    const ctx = await createAuth(env, new Request(`${ORIGIN}/`)).$context;
    const found = await ctx.internalAdapter.findUserByEmail("new@example.com");
    expect(found?.user.emailVerified).toBe(false);
    expect(found?.user.createdAt.getTime()).toBe(raw?.created_at);
  });

  it("uses UUIDs for user IDs, like the rest of the app", async () => {
    const user = await createAuthUser("uuid@example.com");
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("POST /api/auth/sign-in/email", () => {
  it("signs in a seeded user and returns a session with the app role", async () => {
    await createAuthUser("owner@example.com", { role: "owner" });
    const res = await signIn("owner@example.com", PASSWORD);
    expect(res.status).toBe(200);
    const cookie = cookieHeader(res);
    expect(cookie).toContain("__Secure-plainbooks.session_token=");

    const session = await authFetch("/get-session", { cookie });
    expect(session.status).toBe(200);
    const body = (await session.json()) as { user: Record<string, unknown> };
    expect(body.user).toMatchObject({ email: "owner@example.com", role: "owner" });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM sessions").first("n")).toBe(1);
  });

  it("refuses a wrong password", async () => {
    await createAuthUser("member@example.com");
    const res = await signIn("member@example.com", "wrong password here");
    expect(res.status).toBe(401);
  });

  it("refuses sign-up", async () => {
    const res = await authFetch("/sign-up/email", {
      json: { email: "stranger@example.com", password: PASSWORD, name: "Stranger" },
    });
    expect(res.status).toBe(400);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM users").first("n")).toBe(0);
  });

  it("refuses a cross-site sign-in request", async () => {
    await createAuthUser("member@example.com");
    const res = await exports.default.fetch(
      new Request(`${ORIGIN}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ email: "member@example.com", password: PASSWORD }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rehashes a password that uses a lower iteration count", async () => {
    const user = await createAuthUser("old@example.com", {
      hash: await hashPassword(PASSWORD, 1_000),
    });
    expect((await signIn("old@example.com", PASSWORD)).status).toBe(200);
    const [account] = await db
      .select({ password: schema.accounts.password })
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, user.id));
    expect(parseHash(account?.password ?? "")?.iterations).toBe(100_000);
    expect((await signIn("old@example.com", PASSWORD)).status).toBe(200);
  });
});

describe("sign-in rate limits", () => {
  it("gives 429 on the sixth attempt from one IP in 15 minutes", async () => {
    await createAuthUser("member@example.com");
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      expect((await signIn("member@example.com", "wrong password here", ip)).status).toBe(401);
    }
    const res = await signIn("member@example.com", PASSWORD, ip);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("gives 429 on the 21st attempt for one email from 21 IPs", async () => {
    await createAuthUser("target@example.com");
    for (let i = 0; i < 20; i++) {
      expect((await signIn("target@example.com", "wrong password here")).status).toBe(401);
    }
    expect((await signIn("target@example.com", PASSWORD)).status).toBe(429);
    // Another email from a new IP is not limited.
    await createAuthUser("other@example.com");
    expect((await signIn("other@example.com", PASSWORD)).status).toBe(200);
  });

  it("counts failed sign-ins only, so a correct password does not use an attempt", async () => {
    await createAuthUser("counted@example.com");
    const ip = freshIp();
    for (let i = 0; i < 4; i++) {
      expect((await signIn("counted@example.com", "wrong password here", ip)).status).toBe(401);
    }
    // Another client used 4 of 5 attempts. The correct password still signs in.
    for (let i = 0; i < 3; i++) {
      expect((await signIn("counted@example.com", PASSWORD, ip)).status).toBe(200);
    }
    // The fifth failure fills the window. The successes did not count.
    expect((await signIn("counted@example.com", "wrong password here", ip)).status).toBe(401);
    expect((await signIn("counted@example.com", PASSWORD, ip)).status).toBe(429);
  });

  it("lets the owner of an email sign in after 19 failures from other IPs", async () => {
    await createAuthUser("victim@example.com");
    for (let i = 0; i < 19; i++) {
      expect((await signIn("victim@example.com", "wrong password here")).status).toBe(401);
    }
    expect((await signIn("victim@example.com", PASSWORD)).status).toBe(200);
    expect((await signIn("victim@example.com", PASSWORD)).status).toBe(200);
  });

  it("counts IPv6 clients by their /64 prefix", async () => {
    await createAuthUser("ipv6@example.com");
    for (let i = 1; i <= 5; i++) {
      const ip = `2001:db8:1:2::${i.toString(16)}`;
      expect((await signIn("ipv6@example.com", "wrong password here", ip)).status).toBe(401);
    }
    const sameNetwork = await signIn("ipv6@example.com", PASSWORD, "2001:db8:1:2:ffff::1");
    expect(sameNetwork.status).toBe(429);
    expect((await signIn("ipv6@example.com", PASSWORD, "2001:db8:1:3::1")).status).toBe(200);
  });

  it("fails open and logs an error when the Durable Object call throws", async () => {
    await createAuthUser("member@example.com");
    setRateBackendForTesting(async () => {
      throw new Error("Durable Object unavailable");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await signIn("member@example.com", PASSWORD);
    expect(res.status).toBe(200);
    expect(logged).toHaveBeenCalledWith(
      "rate limit check failed, allowing the attempt",
      expect.stringContaining("Durable Object unavailable"),
    );
  });
});

describe("password rules and reset", () => {
  it("refuses a new password of 11 or 129 characters", async () => {
    for (const newPassword of ["a".repeat(11), "a".repeat(129)]) {
      const res = await authFetch("/reset-password", {
        json: { token: "not-a-real-token", newPassword },
      });
      expect(res.status, `${newPassword.length} characters`).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toMatch(/^PASSWORD_TOO_(SHORT|LONG)$/);
    }
  });

  it("resets a password with the emailed token and ends the old sessions", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = await createAuthUser("member@example.com");
    const oldCookie = cookieHeader(await signIn("member@example.com", PASSWORD));

    // No provider is saved, so the email fails. The response stays the same.
    const requested = await authFetch("/request-password-reset", {
      json: { email: "member@example.com", redirectTo: "/reset-password" },
    });
    expect(requested.status).toBe(200);
    const unknown = await authFetch("/request-password-reset", {
      json: { email: "nobody@example.com", redirectTo: "/reset-password" },
    });
    expect(unknown.status).toBe(200);

    const verification = await env.DB.prepare(
      "SELECT identifier FROM verifications WHERE value = ?",
    )
      .bind(user.id)
      .first<{ identifier: string }>();
    const token = verification?.identifier.replace("reset-password:", "") ?? "";
    expect(token).not.toBe("");

    const newPassword = "a brand new passphrase";
    const reset = await authFetch("/reset-password", { json: { token, newPassword } });
    expect(reset.status).toBe(200);

    const session = await authFetch("/get-session", { cookie: oldCookie });
    expect(await session.json()).toBeNull();
    expect((await signIn("member@example.com", PASSWORD)).status).toBe(401);
    expect((await signIn("member@example.com", newPassword)).status).toBe(200);
  });
});

describe("password reset rate limits", () => {
  it("gives 429 on the sixth reset request from one IP", async () => {
    const ip = freshIp();
    for (let i = 0; i < 5; i++) {
      const res = await authFetch("/request-password-reset", {
        json: { email: `nobody-${i}@example.com` },
        ip,
      });
      expect(res.status).toBe(200);
    }
    const res = await authFetch("/request-password-reset", {
      json: { email: "nobody-6@example.com" },
      ip,
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("gives 429 on the 21st reset request for one email from 21 IPs", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await authFetch("/request-password-reset", {
        json: { email: "flooded@example.com" },
      });
      expect(res.status).toBe(200);
    }
    const res = await authFetch("/request-password-reset", {
      json: { email: "flooded@example.com" },
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("gives 429 on the sixth bad reset token from one IP", async () => {
    const ip = freshIp();
    const newPassword = "a brand new passphrase";
    for (let i = 0; i < 5; i++) {
      const res = await authFetch("/reset-password", {
        json: { token: `not-a-real-token-${i}`, newPassword },
        ip,
      });
      expect(res.status).toBe(400);
    }
    const res = await authFetch("/reset-password", {
      json: { token: "not-a-real-token-6", newPassword },
      ip,
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("sends at most 2 reset emails to one address in an hour, with the same answer", async () => {
    await resetEmailState();
    const email = await useFakeEmail();
    await createAuthUser("capped@example.com");
    for (let i = 0; i < 3; i++) {
      const res = await authFetch("/request-password-reset", {
        json: { email: "capped@example.com" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: true });
    }
    expect(email.messages()).toHaveLength(2);
  });
});

describe("the reset email", () => {
  it("links to the /reset-password page with a token that works", async () => {
    await resetEmailState();
    const email = await useFakeEmail();
    await createAuthUser("member@example.com");

    const requested = await authFetch("/request-password-reset", {
      json: { email: "member@example.com" },
    });
    expect(requested.status).toBe(200);
    const [message] = email.messages();
    expect(JSON.stringify(message?.to)).toContain("member@example.com");
    const link = message?.text?.match(/https:\/\/\S+/)?.[0] ?? "";
    const url = new URL(link);
    expect(`${url.origin}${url.pathname}`).toBe(`${ORIGIN}/reset-password`);
    expect(message?.html).toContain(`${ORIGIN}/reset-password?token=`);

    const token = url.searchParams.get("token") ?? "";
    const newPassword = "a brand new passphrase";
    expect((await authFetch("/reset-password", { json: { token, newPassword } })).status).toBe(200);
    // The token works once.
    const again = await authFetch("/reset-password", { json: { token, newPassword } });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { code: string }).code).toBe("INVALID_TOKEN");
    expect((await signIn("member@example.com", newPassword)).status).toBe(200);
  });

  it("sends nothing for an unknown email and gives the same response", async () => {
    await resetEmailState();
    const email = await useFakeEmail();
    const res = await authFetch("/request-password-reset", {
      json: { email: "nobody@example.com" },
    });
    expect(res.status).toBe(200);
    expect(email.messages()).toEqual([]);
  });
});

describe("Google sign-in", () => {
  it("is on only when both Google secrets are set", () => {
    expect(googleEnabled(env)).toBe(false);
    expect(googleEnabled({ ...env, GOOGLE_CLIENT_ID: "id" })).toBe(false);
    expect(googleEnabled({ ...env, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })).toBe(
      true,
    );
  });

  it("offers the Google provider only when it is configured", async () => {
    const without = await createAuth(env, new Request(`${ORIGIN}/`)).$context;
    expect(without.socialProviders.map((p) => p.id)).toEqual([]);
    const withGoogle = await createAuth(
      { ...env, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" },
      new Request(`${ORIGIN}/`),
    ).$context;
    expect(withGoogle.socialProviders.map((p) => p.id)).toEqual(["google"]);
  });
});
