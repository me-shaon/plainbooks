import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberLink } from "../../src/shared/schemas/settings";
import { app } from "../../src/worker/app";
import { setRateBackendForTesting } from "../../src/worker/auth/rate-limit";
import type { Bindings } from "../../src/worker/env";
import {
  activateInvitedUser,
  hashLinkToken,
  newLinkToken,
} from "../../src/worker/services/invites";
import { apiFetch, clearUsers, seedUser } from "../helpers/auth";
import { resetEmailState } from "../helpers/email";

// Google sign-in runs through better-auth's real start and callback endpoints. Only the
// call to Google's token endpoint is stubbed. It returns an ID token with the test claims.

const ORIGIN = "https://invoices.example.com";
const OWNER = "owner@google.test";
const GOOGLE: Partial<Bindings> = {
  GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "client-secret",
};
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

async function fetchWithGoogle(request: Request) {
  const ctx = createExecutionContext();
  const res = await app.fetch(request, { ...env, ...GOOGLE }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const base64Url = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** An ID token with the claims. Its signature is not checked on the code flow. */
function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://accounts.google.com",
    aud: GOOGLE.GOOGLE_CLIENT_ID,
    iat: now,
    exp: now + 3600,
    name: "Google Person",
    ...claims,
  };
  return `${base64Url({ alg: "RS256", kid: "test", typ: "JWT" })}.${base64Url(payload)}.sig`;
}

const cookiePairs = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/**
 * Runs a Google sign-in: starts it, then calls the callback with a code that the stubbed
 * token endpoint exchanges for an ID token with the claims. Returns the callback response.
 */
async function googleSignIn(claims: { email: string; sub?: string; email_verified?: unknown }) {
  const start = await fetchWithGoogle(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        provider: "google",
        callbackURL: `${ORIGIN}/`,
        errorCallbackURL: `${ORIGIN}/sign-in`,
        disableRedirect: true,
      }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";

  const realFetch = globalThis.fetch;
  const tokenCalls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const target = input instanceof Request ? input.url : String(input);
    if (target.startsWith(TOKEN_ENDPOINT)) {
      tokenCalls.push(target);
      return Response.json({
        access_token: "google-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email profile",
        id_token: idToken({
          sub: claims.sub ?? `sub-${claims.email}`,
          email: claims.email,
          email_verified: claims.email_verified ?? true,
        }),
      });
    }
    return realFetch(input, init);
  });
  try {
    const res = await fetchWithGoogle(
      new Request(`${ORIGIN}/api/auth/callback/google?code=test-code&state=${state}`, {
        headers: { cookie: cookiePairs(start) },
        redirect: "manual",
      }),
    );
    expect(tokenCalls).toHaveLength(1);
    return res;
  } finally {
    vi.mocked(globalThis.fetch).mockRestore();
  }
}

/** The `error` code of a refused callback, or null when it signed in. */
function refusal(res: Response): string | null {
  const location = new URL(res.headers.get("location") ?? "", ORIGIN);
  return location.searchParams.get("error");
}

async function invite(email: string): Promise<MemberLink> {
  const res = await apiFetch("/api/team", { as: OWNER, method: "POST", json: { email } });
  expect(res.status).toBe(201);
  return (await res.json()) as MemberLink;
}

async function statusOf(email: string) {
  return env.DB.prepare("SELECT status FROM users WHERE email = ?").bind(email).first("status");
}

async function googleAccounts(email: string) {
  return env.DB.prepare(
    `SELECT count(*) AS n FROM accounts a JOIN users u ON u.id = a.user_id
     WHERE u.email = ? AND a.provider_id = 'google'`,
  )
    .bind(email)
    .first("n");
}

beforeEach(async () => {
  setRateBackendForTesting(async () => ({ allowed: true, count: 1, retryAfterMs: 0 }));
  await clearUsers();
  await resetEmailState();
  await seedUser(OWNER, "owner");
});

afterEach(() => {
  setRateBackendForTesting(null);
  vi.restoreAllMocks();
});

describe("Google sign-in", () => {
  it("signs in an invited email within 7 days and activates the user (AE1)", async () => {
    const added = await invite("invited@google.test");
    const res = await googleSignIn({ email: "invited@google.test" });
    expect(res.status).toBe(302);
    expect(refusal(res)).toBeNull();
    expect(res.headers.get("location")).toBe(`${ORIGIN}/`);

    const sessionCookie = res.headers
      .getSetCookie()
      .find((c) => c.startsWith("__Secure-plainbooks.session_token="));
    expect(sessionCookie).toBeDefined();
    const me = await apiFetch("/api/me", {
      headers: { cookie: sessionCookie?.split(";")[0] ?? "" },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { email: "invited@google.test" } });

    expect(await statusOf("invited@google.test")).toBe("active");
    expect(await googleAccounts("invited@google.test")).toBe(1);
    // The invite is used up, so its link no longer works.
    const token = decodeURIComponent(added.link.split("/invite/")[1] ?? "");
    const accept = await apiFetch("/api/invites/accept", {
      method: "POST",
      json: { token, password: "correct horse battery" },
      headers: { "cf-connecting-ip": "203.0.113.200" },
    });
    expect(accept.status).toBe(410);
  });

  it("refuses an unknown Google email with signup_disabled", async () => {
    const res = await googleSignIn({ email: "stranger@google.test" });
    expect(res.status).toBe(302);
    expect(refusal(res)).toBe("signup_disabled");
    expect(res.headers.get("location")).toMatch(/^https:\/\/invoices\.example\.com\/sign-in\?/);
    expect(await statusOf("stranger@google.test")).toBeNull();
  });

  it("refuses an invite older than 7 days", async () => {
    await invite("old@google.test");
    await env.DB.prepare("UPDATE invites SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    const res = await googleSignIn({ email: "old@google.test" });
    expect(refusal(res)).toBe("invite_expired");
    expect(await statusOf("old@google.test")).toBe("invited");
    expect(await googleAccounts("old@google.test")).toBe(0);
    const sessions = await env.DB.prepare(
      "SELECT count(*) AS n FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?",
    )
      .bind("old@google.test")
      .first("n");
    expect(sessions).toBe(0);
  });

  it("signs in an active member with no invite check", async () => {
    await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").bind(OWNER).run();
    expect(await env.DB.prepare("SELECT count(*) AS n FROM invites").first("n")).toBe(0);
    const first = await googleSignIn({ email: OWNER, sub: "owner-sub" });
    expect(refusal(first)).toBeNull();
    // The second sign-in uses the linked account.
    const second = await googleSignIn({ email: OWNER, sub: "owner-sub" });
    expect(refusal(second)).toBeNull();
    expect(second.headers.get("location")).toBe(`${ORIGIN}/`);
    expect(await googleAccounts(OWNER)).toBe(1);
  });

  it("refuses a Google login whose email_verified claim is false", async () => {
    await invite("unverified@google.test");
    const res = await googleSignIn({ email: "unverified@google.test", email_verified: false });
    expect(refusal(res)).toBe("email_not_verified");
    expect(await statusOf("unverified@google.test")).toBe("invited");
    expect(await googleAccounts("unverified@google.test")).toBe(0);
  });

  it("refuses an unverified claim on an already linked account", async () => {
    await env.DB.prepare("UPDATE users SET email_verified = 1 WHERE email = ?").bind(OWNER).run();
    expect(refusal(await googleSignIn({ email: OWNER, sub: "linked" }))).toBeNull();
    const res = await googleSignIn({ email: OWNER, sub: "linked", email_verified: false });
    expect(refusal(res)).toBe("email_not_verified");
  });
});

describe("activateInvitedUser", () => {
  it("uses an open invite once, and refuses an expired one", async () => {
    const user = await seedUser("hook@google.test", "member", { status: "invited" });
    const now = Date.now();
    const insert = (expiresAt: number) =>
      hashLinkToken(newLinkToken()).then((hash) =>
        env.DB.prepare(
          `INSERT INTO invites (id, user_id, kind, token_hash, expires_at, created_at)
           VALUES (?, ?, 'invite', ?, ?, ?)`,
        )
          .bind(crypto.randomUUID(), user.id, hash, expiresAt, now)
          .run(),
      );
    await insert(now - 1);
    expect(await activateInvitedUser(env.DB, user.id, now)).toBe(false);
    expect(await statusOf("hook@google.test")).toBe("invited");

    await insert(now + 60_000);
    expect(await activateInvitedUser(env.DB, user.id, now)).toBe(true);
    expect(await statusOf("hook@google.test")).toBe("active");
    expect(await activateInvitedUser(env.DB, user.id, now + 1)).toBe(false);
  });
});
