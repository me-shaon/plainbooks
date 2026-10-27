import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/worker/app";
import { setRateBackendForTesting } from "../../src/worker/auth/rate-limit";
import type { Bindings } from "../../src/worker/env";
import { apiFetch, buildRequest, clearUsers, createSession, sessionCookie } from "../helpers/auth";
import { resetEmailState, restoreEmail, useFakeEmail } from "../helpers/email";
import { memoryRateBackend } from "../helpers/rate-limit";

const T1 = "first-setup-token-0123456789abcdef-T1";
const T2 = "second-setup-token-0123456789abcdef-T2";
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new passphrase";

/** Sends a request with other bindings, for example another SETUP_TOKEN. */
async function fetchWith(bindings: Partial<Bindings>, request: Request) {
  const ctx = createExecutionContext();
  const res = await app.fetch(request, { ...env, ...bindings }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

let ipCounter = 0;
/** A fresh client IP per call, unless the test passes one. */
const nextIp = () => `198.51.100.${++ipCounter}`;

async function post(
  path: string,
  json: unknown,
  options: { token?: string; ip?: string; headers?: Record<string, string> } = {},
) {
  const request = await buildRequest(`/api/setup/${path}`, {
    method: "POST",
    json,
    headers: { "cf-connecting-ip": options.ip ?? nextIp(), ...options.headers },
  });
  return fetchWith({ SETUP_TOKEN: options.token ?? T1 }, request);
}

const owner = (overrides: Record<string, unknown> = {}) => ({
  token: T1,
  name: "Avery Owner",
  email: "Owner@Example.com",
  password: PASSWORD,
  ...overrides,
});

async function status() {
  const res = await fetchWith({ SETUP_TOKEN: T1 }, await buildRequest("/api/setup/status"));
  return res.json<{ needsSetup: boolean; setupEnabled: boolean; emailConfigured: boolean }>();
}

async function signInWithPassword(email: string, password: string) {
  return apiFetch("/api/auth/sign-in/email", {
    method: "POST",
    json: { email, password },
    headers: { "cf-connecting-ip": nextIp() },
  });
}

async function userCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  setRateBackendForTesting(memoryRateBackend());
  await clearUsers();
  await env.DB.prepare("DELETE FROM setup_token_uses").run();
  await env.DB.prepare("DELETE FROM activity WHERE type = 'owner_recovered'").run();
  await resetEmailState();
});

afterEach(() => {
  setRateBackendForTesting(null);
  restoreEmail();
});

describe("GET /api/setup/status", () => {
  it("reports setup needed until an Owner exists", async () => {
    expect(await status()).toMatchObject({
      needsSetup: true,
      setupEnabled: true,
      emailConfigured: false,
    });
    expect((await post("owner", owner())).status).toBe(201);
    expect(await status()).toMatchObject({ needsSetup: false });
  });

  it("reports email configured when a primary provider is saved", async () => {
    await useFakeEmail();
    expect(await status()).toMatchObject({ emailConfigured: true });
  });
});

describe("POST /api/setup/owner", () => {
  it("creates the Owner, signs them in, and closes setup", async () => {
    const res = await post("owner", owner());
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      user: { email: "owner@example.com", name: "Avery Owner", role: "owner" },
    });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Secure-plainbooks\.session_token=/);
    expect(setCookie).toMatch(/HttpOnly/i);

    const cookie = setCookie.split(";")[0] ?? "";
    const me = await apiFetch("/api/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ user: { email: "owner@example.com", role: "owner" } });

    // The password works for sign-in.
    expect((await signInWithPassword("owner@example.com", PASSWORD)).status).toBe(200);

    // Setup is closed, even with a new token.
    const again = await post("owner", owner({ token: T2 }), { token: T2 });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "setup_closed" });
  });

  it("refuses a wrong token with 401, and the sixth attempt from one IP with 429", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 5; i++) {
      const res = await post("owner", owner({ token: "wrong-token" }), { ip });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "invalid_setup_token" });
    }
    const limited = await post("owner", owner(), { ip });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await limited.json()).toMatchObject({ code: "rate_limited" });
    expect(await userCount()).toBe(0);
  });

  it("hits the global limit after 20 wrong attempts across 20 IPs", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await post("owner", owner({ token: "wrong-token" }))).status).toBe(401);
    }
    const limited = await post("owner", owner());
    expect(limited.status).toBe(429);
    expect(await userCount()).toBe(0);
  });

  it("fails closed when the rate limiter is down", async () => {
    setRateBackendForTesting(async () => {
      throw new Error("Durable Object unavailable");
    });
    const res = await post("owner", owner());
    expect(res.status).toBe(500);
    expect(await userCount()).toBe(0);
  });

  it("creates one Owner for two parallel calls", async () => {
    const results = await Promise.all([
      post("owner", owner({ email: "a@example.com" })),
      post("owner", owner({ email: "b@example.com" })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await userCount()).toBe(1);
  });

  it("refuses a password shorter than 12 or longer than 128 characters", async () => {
    for (const password of ["x".repeat(11), "x".repeat(129)]) {
      const res = await post("owner", owner({ password }));
      expect(res.status).toBe(400);
      const body = await res.json<{ issues: { path: string }[] }>();
      expect(body.issues.map((i) => i.path)).toContain("password");
    }
    expect(await userCount()).toBe(0);
  });

  it("returns 404 for both routes when SETUP_TOKEN is missing or short", async () => {
    for (const token of ["", "short-token"]) {
      for (const path of ["owner", "recover"]) {
        const res = await post(path, owner(), { token });
        expect(res.status).toBe(404);
      }
    }
    const res = await fetchWith(
      { SETUP_TOKEN: undefined },
      await buildRequest("/api/setup/status"),
    );
    expect(await res.json()).toMatchObject({ setupEnabled: false });
  });

  it("refuses a cross-site POST with 403", async () => {
    const res = await post("owner", owner(), {
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "cross_site_request" });
    expect(await userCount()).toBe(0);
  });
});

describe("POST /api/setup/recover", () => {
  const recover = (overrides: Record<string, unknown> = {}, token = T2) =>
    post(
      "recover",
      { token, email: "owner@example.com", password: NEW_PASSWORD, ...overrides },
      { token },
    );

  async function setUpOwner() {
    expect((await post("owner", owner())).status).toBe(201);
    const row = await env.DB.prepare(
      "SELECT id FROM users WHERE email = 'owner@example.com'",
    ).first<{
      id: string;
    }>();
    if (!row) throw new Error("no owner");
    return row.id;
  }

  it("covers AE2: T1 is refused after setup, and T2 works once", async () => {
    await setUpOwner();
    const withT1 = await recover({ token: T1 }, T1);
    expect(withT1.status).toBe(401);

    const first = await recover();
    expect(first.status).toBe(200);
    expect((await signInWithPassword("owner@example.com", NEW_PASSWORD)).status).toBe(200);
    expect((await signInWithPassword("owner@example.com", PASSWORD)).status).toBe(401);

    const second = await recover({ password: "yet another passphrase" });
    expect(second.status).toBe(401);
  });

  it("revokes the Owner's old sessions and writes an activity row", async () => {
    const ownerId = await setUpOwner();
    const cookie = await sessionCookie(await createSession(ownerId));
    expect((await apiFetch("/api/me", { headers: { cookie } })).status).toBe(200);

    expect((await recover()).status).toBe(200);
    expect((await apiFetch("/api/me", { headers: { cookie } })).status).toBe(401);
    const row = await env.DB.prepare(
      "SELECT actor_user_id, data FROM activity WHERE type = 'owner_recovered'",
    ).first<{ actor_user_id: string; data: string }>();
    expect(row?.actor_user_id).toBe(ownerId);
    expect(JSON.parse(row?.data ?? "{}")).toEqual({ email: "owner@example.com" });
  });

  it("gives the same 401 for an unknown email, a Member email, and a bad token", async () => {
    await setUpOwner();
    await env.DB.prepare(
      "INSERT INTO users (id, email, name, role) VALUES (?, 'member@example.com', 'member', 'member')",
    )
      .bind(crypto.randomUUID())
      .run();
    const responses = [
      await recover({ email: "nobody@example.com" }),
      await recover({ email: "member@example.com" }),
      await recover({ token: "wrong-token-0123456789abcdef-0123456" }),
    ];
    const bodies = await Promise.all(responses.map((r) => r.json()));
    expect(responses.map((r) => r.status)).toEqual([401, 401, 401]);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toEqual(bodies[2]);
    // A refused attempt does not use the token.
    expect((await recover()).status).toBe(200);
  });

  it("emails every Owner when email is configured", async () => {
    await setUpOwner();
    const email = await useFakeEmail();
    expect((await recover()).status).toBe(200);
    const [message] = email.messages();
    expect(message?.to).toEqual(["owner@example.com"]);
    expect(message?.subject).toMatch(/Owner password was reset/);
  });

  it("succeeds with no email configured", async () => {
    await setUpOwner();
    expect((await recover()).status).toBe(200);
  });
});
