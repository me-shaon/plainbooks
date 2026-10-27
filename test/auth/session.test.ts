import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/worker/app";
import { createAuth, SESSION_EXPIRES_IN_SECONDS } from "../../src/worker/auth/auth";
import { requireOwner, sessionAuth } from "../../src/worker/auth/middleware";
import { createDb } from "../../src/worker/db/client";
import type { AppEnv, Bindings } from "../../src/worker/env";
import { handleError } from "../../src/worker/errors";
import { LAST_OWNER_MESSAGE, removeUser, setUserRole } from "../../src/worker/services/team";
import {
  apiFetch,
  buildRequest,
  clearUsers,
  createSession,
  seedUser,
  sessionCookie,
  sessionCookieName,
  signCookieValue,
  signInAs,
} from "../helpers/auth";

const db = createDb(env.DB);

async function fetchWith(bindings: Partial<Bindings>, request: Request, target = app) {
  const ctx = createExecutionContext();
  const res = await target.fetch(request, { ...env, ...bindings }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function me(cookie?: string) {
  return apiFetch("/api/me", cookie ? { headers: { cookie } } : {});
}

async function sessionCount(userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  await clearUsers();
});

describe("sessionAuth", () => {
  it("sets the signed-in member for a valid session", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/me", { as: "MEMBER@example.com" });
    expect(res.status).toBe(200);
    const body = await res.json<{ user: { email: string; role: string } }>();
    expect(body.user).toMatchObject({ email: "member@example.com", role: "member" });
  });

  it("returns 401 with no session cookie", async () => {
    const res = await me();
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("returns 401 for an expired session and deletes it", async () => {
    const user = await seedUser("member@example.com");
    const token = await createSession(user.id);
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?")
      .bind(Date.now() - 1000, token)
      .run();
    const res = await me(await sessionCookie(token));
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    expect(await sessionCount(user.id)).toBe(0);
  });

  it("returns 401 for a tampered cookie", async () => {
    const user = await seedUser("member@example.com");
    const token = await createSession(user.id);
    const name = await sessionCookieName();
    const signed = decodeURIComponent(await signCookieValue(token));
    const [value = "", signature = ""] = signed.split(".");
    const cookies = [
      // Another token with the old signature.
      `${name}=${encodeURIComponent(`${value.slice(0, -1)}x.${signature}`)}`,
      // The token with a signature from another secret.
      `${name}=${await signCookieValue(token, "another-secret-0123456789abcdef0123")}`,
      // The token with no signature.
      `${name}=${token}`,
      // A garbage value.
      `${name}=not-a-cookie`,
    ];
    for (const cookie of cookies) {
      const res = await me(cookie);
      expect(res.status, cookie).toBe(401);
      expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    }
    // The real cookie still works.
    expect((await me(await sessionCookie(token))).status).toBe(200);
  });

  it("returns 401 for a signed token that has no session", async () => {
    await seedUser("member@example.com");
    const res = await me(await sessionCookie("no-such-session-token-0123456789"));
    expect(res.status).toBe(401);
  });

  it("returns 403 not_a_member for an invited user", async () => {
    await seedUser("invited@example.com", "member", { status: "invited" });
    const res = await apiFetch("/api/me", { as: "invited@example.com" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "not_a_member" });
  });

  it("refreshes a session that is older than the update age", async () => {
    const user = await seedUser("member@example.com");
    const token = await createSession(user.id);
    // Two days old: the update age (one day) has passed.
    const twoDaysOld = Date.now() + (SESSION_EXPIRES_IN_SECONDS - 2 * 24 * 60 * 60) * 1000;
    await env.DB.prepare("UPDATE sessions SET expires_at = ? WHERE token = ?")
      .bind(twoDaysOld, token)
      .run();
    const res = await me(await sessionCookie(token));
    expect(res.status).toBe(200);
    const name = await sessionCookieName();
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${name}=`))).toBe(true);
    const row = await env.DB.prepare("SELECT expires_at AS e FROM sessions WHERE token = ?")
      .bind(token)
      .first<{ e: number }>();
    expect(row?.e).toBeGreaterThan(twoDaysOld);
  });

  it("does not send a cookie when the session needs no refresh", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/me", { as: "member@example.com" });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("returns 401 for an unauthenticated /render request", async () => {
    const res = await apiFetch("/render/rev_123");
    expect(res.status).toBe(401);
  });

  it("lets an authenticated /render request through the middleware", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/render/rev_123", { as: "member@example.com" });
    expect(res.status).toBe(404);
  });

  it("checks the session on every /api/* path except the exempt prefixes", async () => {
    const paths = [
      "/api/health",
      "/api/me",
      "/api/nope",
      "/api/webhooks",
      "/api/setup",
      "/api/invites",
      "/api/webhooksx/email/primary",
      "/api/Webhooks/email/primary",
      "/api/%77ebhooks/email/primary",
      "/api/webhooks%2Femail/primary",
      "/api/webhooks/../me",
      "/api/webhooks/%2e%2e/me",
      "/api/setup/../me",
      "/api/invites/%2e%2e/me",
    ];
    for (const path of paths) {
      for (const method of ["GET", "POST"]) {
        const res = await apiFetch(path, { method });
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(await res.json(), `${method} ${path}`).toMatchObject({ code: "unauthenticated" });
      }
    }
    // The webhook route answers itself: no provider is saved, so the signature check fails.
    const exempt = await apiFetch("/api/webhooks/email/primary", { method: "POST" });
    expect(exempt.status).toBe(401);
    expect(await exempt.json()).toMatchObject({ code: "invalid_signature" });
    // Setup and invite routes need no session. U9 and U10 add them, so these are 404 now.
    for (const path of ["/api/setup/status", "/api/invites/abc"]) {
      const res = await apiFetch(path);
      expect(res.status, path).toBe(404);
    }
  });

  it("does not run on /p/* public links", async () => {
    const res = await apiFetch("/p/some-token");
    expect(res.status).toBe(404);
  });

  it("returns JSON 404 for unknown API routes after sign-in", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/nope", { as: "member@example.com" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});

describe("member removal (AE4)", () => {
  it("ends every session of the removed member at once", async () => {
    await seedUser("owner@example.com", "owner");
    const member = await seedUser("member@example.com");
    const laptop = await signInAs("member@example.com");
    const phone = await signInAs("member@example.com");
    expect((await me(laptop)).status).toBe(200);
    expect(await sessionCount(member.id)).toBe(2);

    const removed = await apiFetch(`/api/team/${member.id}`, {
      as: "owner@example.com",
      method: "DELETE",
    });
    expect(removed.status).toBe(204);
    expect(await sessionCount(member.id)).toBe(0);
    for (const cookie of [laptop, phone]) {
      const res = await me(cookie);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "unauthenticated" });
    }
  });

  it("keeps the sessions when the last-Owner guard refuses the removal", async () => {
    const owner = await seedUser("owner@example.com", "owner");
    const cookie = await signInAs("owner@example.com");
    await expect(removeUser(db, owner.id)).rejects.toMatchObject({ code: "last_owner" });
    expect((await me(cookie)).status).toBe(200);
  });
});

describe("cross-site writes", () => {
  const OWNER = "owner@example.com";
  const APP_ORIGIN = new URL(env.APP_URL).origin;
  const addMember = (headers: Record<string, string>, email = "new@example.com") =>
    apiFetch("/api/team", { as: OWNER, method: "POST", headers, json: { email } });

  beforeEach(async () => {
    await seedUser(OWNER, "owner");
  });

  it("refuses a write with a valid session when it is cross-site or from another origin", async () => {
    const cases: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: `${APP_ORIGIN}.evil.example` },
    ];
    for (const headers of cases) {
      const res = await addMember(headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(await res.json()).toMatchObject({ code: "cross_site_request" });
    }
    const bodiless = await apiFetch("/api/jobs/job_1/retry", {
      as: OWNER,
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(bodiless.status).toBe(403);
  });

  it("refuses a cross-site write to the session-exempt setup, invite, and auth routes", async () => {
    for (const path of ["/api/setup/claim", "/api/invites/accept", "/api/auth/sign-out"]) {
      const res = await apiFetch(path, {
        method: "POST",
        headers: { origin: "https://evil.example" },
        json: {},
      });
      expect(res.status, path).toBe(403);
      expect(await res.json()).toMatchObject({ code: "cross_site_request" });
    }
  });

  it("allows a same-origin write and a write with no Origin header", async () => {
    const same = await addMember({ origin: APP_ORIGIN, "sec-fetch-site": "same-origin" });
    expect(same.status).toBe(201);
    const tool = await addMember({}, "tool@example.com");
    expect(tool.status).toBe(201);
  });

  it("lets cross-site reads through", async () => {
    const res = await apiFetch("/api/me", {
      as: OWNER,
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 415 for JSON sent as text/plain", async () => {
    const res = await apiFetch("/api/team", {
      as: OWNER,
      method: "POST",
      headers: { origin: APP_ORIGIN, "content-type": "text/plain" },
      body: JSON.stringify({ email: "plain@example.com" }),
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: "unsupported_media_type" });
  });

  it("does not apply to the email webhooks", async () => {
    const res = await apiFetch("/api/webhooks/email/primary", {
      method: "POST",
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "invalid_signature" });
  });

  it("allows the local origin only in development", async () => {
    const cookie = await signInAs(OWNER);
    const dev = { APP_ENV: "development" };
    const post = (origin: string) =>
      new Request("http://localhost:5173/api/team", {
        method: "POST",
        headers: { origin, cookie, "content-type": "application/json" },
        body: JSON.stringify({ email: `x${crypto.randomUUID()}@example.com` }),
      });
    expect((await fetchWith(dev, post("http://localhost:5173"))).status).toBe(201);
    expect((await fetchWith(dev, post("http://localhost:9999"))).status).toBe(403);
    expect((await fetchWith({ APP_ENV: "production" }, post("http://localhost:5173"))).status).toBe(
      403,
    );
  });

  it("refuses browser writes when APP_URL is not set outside development", async () => {
    const res = await fetchWith(
      { APP_URL: "" },
      await buildRequest("/api/team", {
        as: OWNER,
        method: "POST",
        headers: { origin: "https://app.test" },
        json: { email: "unset@example.com" },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("requireOwner", () => {
  const guarded = new Hono<AppEnv>();
  guarded.onError(handleError);
  guarded.use("/api/*", sessionAuth);
  guarded.put("/api/settings/brand-kit", requireOwner, (c) => c.json({ ok: true }));

  it("returns 403 for a Member on an Owner-only route", async () => {
    await seedUser("member@example.com", "member");
    const req = await buildRequest("/api/settings/brand-kit", {
      method: "PUT",
      as: "member@example.com",
    });
    const res = await fetchWith({}, req, guarded);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_required" });
  });

  it("allows an Owner", async () => {
    await seedUser("boss@example.com", "owner");
    const req = await buildRequest("/api/settings/brand-kit", {
      method: "PUT",
      as: "boss@example.com",
    });
    const res = await fetchWith({}, req, guarded);
    expect(res.status).toBe(200);
  });

  it("refuses a Member on the team routes of the app", async () => {
    await seedUser("boss@example.com", "owner");
    await seedUser("member@example.com", "member");
    const res = await apiFetch("/api/team", { as: "member@example.com" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "owner_required" });
  });
});

describe("last Owner guard", () => {
  it("refuses to demote the only Owner", async () => {
    const owner = await seedUser("boss@example.com", "owner");
    await seedUser("member@example.com", "member");
    await expect(setUserRole(db, owner.id, "member")).rejects.toMatchObject({
      status: 409,
      code: "last_owner",
      message: LAST_OWNER_MESSAGE,
    });
  });

  it("refuses to remove the only Owner", async () => {
    const owner = await seedUser("boss@example.com", "owner");
    await expect(removeUser(db, owner.id)).rejects.toMatchObject({ code: "last_owner" });
  });

  it("allows demoting an Owner when another Owner exists", async () => {
    const first = await seedUser("boss@example.com", "owner");
    await seedUser("partner@example.com", "owner");
    const updated = await setUserRole(db, first.id, "member");
    expect(updated.role).toBe("member");
  });

  it("keeps one Owner when two Owners demote each other at the same time", async () => {
    const a = await seedUser("a@example.com", "owner");
    const b = await seedUser("b@example.com", "owner");
    const results = await Promise.allSettled([
      setUserRole(db, a.id, "member"),
      setUserRole(db, b.id, "member"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const { results: owners } = await env.DB.prepare(
      "SELECT count(*) AS n FROM users WHERE role = 'owner'",
    ).all();
    expect(owners).toEqual([{ n: 1 }]);
  });

  it("promotes and removes Members freely", async () => {
    await seedUser("boss@example.com", "owner");
    const member = await seedUser("member@example.com", "member");
    expect((await setUserRole(db, member.id, "owner")).role).toBe("owner");
    await removeUser(db, member.id);
    await expect(removeUser(db, member.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("CPU budget", () => {
  it("builds the auth instance and reads the session well within 10 ms", async () => {
    const cookie = await signInAs("member@example.com");
    const request = new Request(`${env.APP_URL}/api/me`, { headers: { cookie } });
    // Warm the code paths.
    await createAuth(env, request).api.getSession({ headers: request.headers });

    const iterations = 100;
    let totalMs = 0;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const session = await createAuth(env, request).api.getSession({ headers: request.headers });
      totalMs += performance.now() - start;
      expect(session?.user.email).toBe("member@example.com");
    }
    const perRequest = totalMs / iterations;
    console.log(
      `auth benchmark: auth instance + session read ${perRequest.toFixed(3)} ms (wall time, mean of ${iterations})`,
    );
    // Wall time includes local D1 I/O, so it is an upper bound on CPU time.
    expect(perRequest).toBeLessThan(10);
  });
});
