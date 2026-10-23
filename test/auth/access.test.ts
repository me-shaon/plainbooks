import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { generateKeyPair } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/worker/app";
import { verifyAccessJwt } from "../../src/worker/auth/access";
import { accessAuth, requireOwner, resolveUser } from "../../src/worker/auth/middleware";
import { createDb } from "../../src/worker/db/client";
import type { AppEnv, Bindings } from "../../src/worker/env";
import { handleError } from "../../src/worker/errors";
import { LAST_OWNER_MESSAGE, removeUser, setUserRole } from "../../src/worker/services/team";
import {
  accessToken,
  apiFetch,
  buildRequest,
  clearUsers,
  installAccessKeys,
  jwksFetchCount,
  seedUser,
} from "../helpers/auth";

const db = createDb(env.DB);

async function fetchWith(bindings: Partial<Bindings>, request: Request, target = app) {
  const ctx = createExecutionContext();
  const res = await target.fetch(request, { ...env, ...bindings }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

beforeAll(() => installAccessKeys());
beforeEach(async () => {
  await clearUsers();
});

describe("Access JWT verification", () => {
  it("returns /api/me for a team member with role Member", async () => {
    const member = await seedUser("member@example.com", "member");
    const res = await apiFetch("/api/me", { as: "member@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: member.id, email: "member@example.com", name: null, role: "member" },
    });
  });

  it("fetches the team JWKS from /cdn-cgi/access/certs and caches it", async () => {
    await seedUser("member@example.com");
    installAccessKeys();
    for (let i = 0; i < 3; i++) {
      expect((await apiFetch("/api/me", { as: "member@example.com" })).status).toBe(200);
    }
    expect(jwksFetchCount).toBe(1);
  });

  it("matches the email case-insensitively", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/me", { as: "Member@Example.COM" });
    expect(res.status).toBe(200);
  });

  it("returns 401 when the header is missing", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "unauthenticated" });
  });

  it("returns 401 for an expired token", async () => {
    await seedUser("member@example.com");
    const expiresAt = Math.floor(Date.now() / 1000) - 60;
    const res = await apiFetch("/api/me", { as: "member@example.com", token: { expiresAt } });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a wrong audience", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/me", {
      as: "member@example.com",
      token: { audience: "another-application" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a wrong issuer", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/me", {
      as: "member@example.com",
      token: { issuer: "https://other-team.cloudflareaccess.com" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token signed by another key", async () => {
    await seedUser("member@example.com");
    const { privateKey } = await generateKeyPair("RS256");
    const res = await apiFetch("/api/me", { as: "member@example.com", token: { key: privateKey } });
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed token", async () => {
    const res = await apiFetch("/api/me", {
      headers: { "cf-access-jwt-assertion": "not-a-jwt" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 403 for a valid token with an unknown email", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/me", { as: "stranger@example.com" });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "not_a_member" });
  });

  it("returns 401 for an unauthenticated /render/:revisionId request", async () => {
    const res = await apiFetch("/render/rev_123");
    expect(res.status).toBe(401);
  });

  it("lets an authenticated /render request through the middleware", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/render/rev_123", { as: "member@example.com" });
    expect(res.status).toBe(404);
  });

  it("checks the JWT on every /api/* path except exactly /api/webhooks/resend", async () => {
    const paths = [
      "/api/health",
      "/api/me",
      "/api/nope",
      "/api/webhooks",
      "/api/webhooks/resend/",
      "/api/webhooks/resend/extra",
      "/api/webhooks/resendx",
      "/api/webhooks/Resend",
    ];
    for (const path of paths) {
      for (const method of ["GET", "POST"]) {
        const res = await apiFetch(path, { method });
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    }
    const exempt = await apiFetch("/api/webhooks/resend", { method: "POST" });
    expect(exempt.status).not.toBe(401);
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

describe("first Owner bootstrap", () => {
  it("creates OWNER_EMAIL as Owner when the users table is empty", async () => {
    const res = await apiFetch("/api/me", { as: env.OWNER_EMAIL.toUpperCase() });
    expect(res.status).toBe(200);
    const body = await res.json<{ user: { email: string; role: string } }>();
    expect(body.user).toMatchObject({ email: env.OWNER_EMAIL, role: "owner" });
    const again = await apiFetch("/api/me", { as: env.OWNER_EMAIL });
    expect(again.status).toBe(200);
    const { results } = await env.DB.prepare("SELECT role FROM users").all();
    expect(results).toEqual([{ role: "owner" }]);
  });

  it("does not bootstrap any other email", async () => {
    const res = await apiFetch("/api/me", { as: "someone@example.com" });
    expect(res.status).toBe(403);
  });

  it("does not bootstrap OWNER_EMAIL once the team has members", async () => {
    await seedUser("member@example.com");
    const res = await apiFetch("/api/me", { as: env.OWNER_EMAIL });
    expect(res.status).toBe(403);
  });

  it("creates one Owner when two first requests race", async () => {
    const results = await Promise.all([
      resolveUser(db, env, env.OWNER_EMAIL),
      resolveUser(db, env, env.OWNER_EMAIL),
    ]);
    const { results: rows } = await env.DB.prepare("SELECT count(*) AS n FROM users").all();
    expect(rows).toEqual([{ n: 1 }]);
    expect(results[0]?.role).toBe("owner");
    expect(results[1]?.id).toBe(results[0]?.id);
  });
});

describe("requireOwner", () => {
  const guarded = new Hono<AppEnv>();
  guarded.onError(handleError);
  guarded.use("/api/*", accessAuth);
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
});

describe("dev bypass", () => {
  const dev = { APP_ENV: "development", DEV_USER_EMAIL: "dev@example.com" };

  it("accepts DEV_USER_EMAIL on localhost when APP_ENV is development", async () => {
    await seedUser("dev@example.com", "owner");
    for (const host of ["http://localhost:5173", "http://127.0.0.1:8787"]) {
      const res = await fetchWith(dev, new Request(`${host}/api/me`));
      expect(res.status, host).toBe(200);
      expect(await res.json()).toMatchObject({ user: { email: "dev@example.com" } });
    }
  });

  it("is ignored when APP_ENV is production, missing, or another value", async () => {
    await seedUser("dev@example.com", "owner");
    for (const APP_ENV of ["production", undefined, "", "Development", "dev", "development "]) {
      const res = await fetchWith(
        { ...dev, APP_ENV: APP_ENV as string },
        new Request("http://localhost:5173/api/me"),
      );
      expect(res.status, String(APP_ENV)).toBe(401);
    }
  });

  it("is ignored when the host is not localhost", async () => {
    await seedUser("dev@example.com", "owner");
    for (const host of [
      "https://app.example.com",
      "http://localhost.example.com",
      "http://10.0.0.2",
    ]) {
      const res = await fetchWith(dev, new Request(`${host}/api/me`));
      expect(res.status, host).toBe(401);
    }
  });

  it("is ignored when DEV_USER_EMAIL is not set", async () => {
    const res = await fetchWith(
      { APP_ENV: "development", DEV_USER_EMAIL: undefined },
      new Request("http://localhost:5173/api/me"),
    );
    expect(res.status).toBe(401);
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
  it("verifies a JWT and looks up the user well within 10 ms", async () => {
    await seedUser("member@example.com");
    const token = await accessToken("member@example.com");
    const config = { teamDomain: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD };
    // Warm the JWKS cache and the code paths.
    await verifyAccessJwt(token, config);

    const iterations = 200;
    let verifyMs = 0;
    let totalMs = 0;
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      const { email } = await verifyAccessJwt(token, config);
      const verified = performance.now();
      const user = await resolveUser(db, env, email);
      const end = performance.now();
      expect(user).not.toBeNull();
      verifyMs += verified - start;
      totalMs += end - start;
    }
    const perVerify = verifyMs / iterations;
    const perRequest = totalMs / iterations;
    console.log(
      `auth benchmark: verify ${perVerify.toFixed(3)} ms, verify + D1 lookup ${perRequest.toFixed(3)} ms (wall time, mean of ${iterations})`,
    );
    // Wall time includes local D1 I/O, so it is an upper bound on CPU time.
    expect(perRequest).toBeLessThan(10);
  });
});
