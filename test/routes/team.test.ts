import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MemberLink, TeamMember } from "../../src/shared/schemas/settings";
import {
  type RateBackend,
  type RateResult,
  setRateBackendForTesting,
} from "../../src/worker/auth/rate-limit";
import { createDb } from "../../src/worker/db/client";
import { removeUser } from "../../src/worker/services/team";
import { apiFetch, clearUsers, seedUser, signInAs } from "../helpers/auth";
import { resetEmailState, restoreEmail, useFakeEmail } from "../helpers/email";

const OWNER = "owner@team.test";
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new passphrase";

/** In-memory counters with the same rule logic as the Durable Object. */
function memoryBackend(): RateBackend {
  const counters = new Map<string, number>();
  return async (_env, check): Promise<RateResult> => {
    const count = counters.get(check.key) ?? 0;
    if (count >= check.rule.limit) {
      return { allowed: false, count, retryAfterMs: check.rule.windowMs };
    }
    counters.set(check.key, count + 1);
    return { allowed: true, count: count + 1, retryAfterMs: 0 };
  };
}

let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

/** The token at the end of an invite or reset link. */
const tokenOf = (link: string) => decodeURIComponent(link.split("/invite/")[1] ?? "");

async function invite(email: string, extra: Record<string, unknown> = {}) {
  const res = await apiFetch("/api/team", {
    as: OWNER,
    method: "POST",
    json: { email, ...extra },
  });
  expect(res.status).toBe(201);
  return (await res.json()) as MemberLink;
}

function accept(token: string, body: Record<string, unknown> = {}, ip = nextIp()) {
  return apiFetch("/api/invites/accept", {
    method: "POST",
    json: { token, name: "Riley Member", password: PASSWORD, ...body },
    headers: { "cf-connecting-ip": ip },
  });
}

function lookup(token: string) {
  return apiFetch("/api/invites/lookup", {
    method: "POST",
    json: { token },
    headers: { "cf-connecting-ip": nextIp() },
  });
}

function signIn(email: string, password: string) {
  return apiFetch("/api/auth/sign-in/email", {
    method: "POST",
    json: { email, password },
    headers: { "cf-connecting-ip": nextIp() },
  });
}

async function members(): Promise<TeamMember[]> {
  const res = await apiFetch("/api/team", { as: OWNER });
  return ((await res.json()) as { items: TeamMember[] }).items;
}

const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

beforeEach(async () => {
  setRateBackendForTesting(memoryBackend());
  await clearUsers();
  await resetEmailState();
  await seedUser(OWNER, "owner");
});

afterEach(() => {
  setRateBackendForTesting(null);
  restoreEmail();
});

describe("adding a member", () => {
  it("returns a link and sends no email when no provider is saved (AE3)", async () => {
    const added = await invite("New@Team.test");
    expect(added.emailSent).toBe(false);
    expect(added.kind).toBe("invite");
    expect(added.link).toMatch(/^https:\/\/invoices\.example\.com\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(added.member).toMatchObject({
      email: "new@team.test",
      name: "new",
      role: "member",
      state: "invited",
    });
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(added.expiresAt).toBeGreaterThan(Date.now() + sevenDays - 60_000);
    expect(added.member.linkExpiresAt).toBe(added.expiresAt);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM email_log").first("n")).toBe(0);

    const raw = await env.DB.prepare(
      "SELECT status, email_verified, name FROM users WHERE email = 'new@team.test'",
    ).first();
    expect(raw).toMatchObject({ status: "invited", email_verified: 1, name: "new" });
    // Only the hash is stored.
    const stored = await env.DB.prepare("SELECT token_hash FROM invites").first<{
      token_hash: string;
    }>();
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.token_hash).not.toBe(tokenOf(added.link));
  });

  it("emails the link when email is configured", async () => {
    const fake = await useFakeEmail();
    const added = await invite("emailed@team.test", { name: "Emi", role: "owner" });
    expect(added.emailSent).toBe(true);
    const [message] = fake.messages();
    expect(message?.to).toEqual(["emailed@team.test"]);
    expect(message?.text).toContain(added.link);
    expect(added.member).toMatchObject({ name: "Emi", role: "owner" });
  });

  it("refuses an email that is already on the team", async () => {
    await invite("dup@team.test");
    const again = await apiFetch("/api/team", {
      as: OWNER,
      method: "POST",
      json: { email: "dup@team.test" },
    });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "member_exists" });
  });

  it("gives an invited user's session 403", async () => {
    await invite("waiting@team.test");
    const res = await apiFetch("/api/me", { as: "waiting@team.test" });
    expect(res.status).toBe(403);
  });
});

describe("accepting an invite", () => {
  it("sets the password, activates the user, and signs them in", async () => {
    const added = await invite("joiner@team.test");
    const info = await lookup(tokenOf(added.link));
    expect(info.status).toBe(200);
    expect(await info.json()).toMatchObject({ kind: "invite", email: "joiner@team.test" });

    const res = await accept(tokenOf(added.link));
    expect(res.status).toBe(200);
    const me = await apiFetch("/api/me", { headers: { cookie: cookieOf(res) } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      user: { email: "joiner@team.test", name: "Riley Member", role: "member" },
    });
    expect((await signIn("joiner@team.test", PASSWORD)).status).toBe(200);
    expect((await members()).find((m) => m.email === "joiner@team.test")).toMatchObject({
      state: "active",
      linkExpiresAt: null,
    });
  });

  it("refuses a used link", async () => {
    const added = await invite("once@team.test");
    expect((await accept(tokenOf(added.link))).status).toBe(200);
    const again = await accept(tokenOf(added.link), { password: NEW_PASSWORD });
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ code: "link_invalid" });
    expect((await lookup(tokenOf(added.link))).status).toBe(410);
    expect((await signIn("once@team.test", NEW_PASSWORD)).status).toBe(401);
  });

  it("refuses an expired link", async () => {
    const added = await invite("late@team.test");
    await env.DB.prepare("UPDATE invites SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();
    expect((await accept(tokenOf(added.link))).status).toBe(410);
    expect((await members()).find((m) => m.email === "late@team.test")?.state).toBe("expired");
  });

  it("refuses a short password", async () => {
    const added = await invite("short@team.test");
    expect((await accept(tokenOf(added.link), { password: "short" })).status).toBe(400);
  });

  it("gives 429 on the sixth wrong-token attempt from one IP", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < 5; i++) {
      expect((await accept(`wrong-token-${i}`, {}, ip)).status).toBe(410);
    }
    const res = await accept("wrong-token-6", {}, ip);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("resending an invite", () => {
  it("gives an expired invite a working new link and stops the old one", async () => {
    const added = await invite("again@team.test");
    await env.DB.prepare("UPDATE invites SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();

    const res = await apiFetch(`/api/team/${added.member.id}/invite`, {
      as: OWNER,
      method: "POST",
    });
    expect(res.status).toBe(200);
    const resent = (await res.json()) as MemberLink;
    expect(resent.link).not.toBe(added.link);
    expect(resent.member.state).toBe("invited");
    expect(resent.expiresAt).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);

    expect((await accept(tokenOf(added.link))).status).toBe(410);
    expect((await accept(tokenOf(resent.link))).status).toBe(200);
  });

  it("refuses a member who already joined", async () => {
    const member = await seedUser("active@team.test");
    const res = await apiFetch(`/api/team/${member.id}/invite`, { as: OWNER, method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "member_active" });
  });
});

describe("resetting a sign-in", () => {
  it("ends sessions, removes the password, and the reset link sets a new one", async () => {
    const added = await invite("reset@team.test");
    expect((await accept(tokenOf(added.link))).status).toBe(200);
    const cookie = await signInAs("reset@team.test");
    expect((await apiFetch("/api/me", { headers: { cookie } })).status).toBe(200);

    const res = await apiFetch(`/api/team/${added.member.id}/reset`, {
      as: OWNER,
      method: "POST",
    });
    expect(res.status).toBe(200);
    const reset = (await res.json()) as MemberLink;
    expect(reset).toMatchObject({ kind: "reset", emailSent: false });
    expect(reset.member.state).toBe("reset_pending");
    expect(reset.expiresAt).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);

    expect((await apiFetch("/api/me", { headers: { cookie } })).status).toBe(401);
    expect((await signIn("reset@team.test", PASSWORD)).status).toBe(401);

    const info = await lookup(tokenOf(reset.link));
    expect(await info.json()).toMatchObject({ kind: "reset", email: "reset@team.test" });
    const used = await accept(tokenOf(reset.link), { password: NEW_PASSWORD, name: "Ignored" });
    expect(used.status).toBe(200);
    expect((await signIn("reset@team.test", NEW_PASSWORD)).status).toBe(200);
    const after = (await members()).find((m) => m.email === "reset@team.test");
    expect(after).toMatchObject({ state: "active", name: "Riley Member" });
  });

  it("refuses to reset the Owner's own sign-in", async () => {
    const owner = (await members()).find((m) => m.email === OWNER);
    const res = await apiFetch(`/api/team/${owner?.id}/reset`, { as: OWNER, method: "POST" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "cannot_reset_self" });
  });
});

describe("removing a member", () => {
  it("removes an invite, and the link stops working", async () => {
    const added = await invite("gone@team.test");
    const res = await apiFetch(`/api/team/${added.member.id}`, { as: OWNER, method: "DELETE" });
    expect(res.status).toBe(204);
    expect((await accept(tokenOf(added.link))).status).toBe(410);
    expect((await members()).map((m) => m.email)).toEqual([OWNER]);
  });

  it("refuses to remove the last Owner with 409 last_owner", async () => {
    // An invited Owner cannot sign in, so it does not count as another Owner.
    await invite("pending@team.test", { role: "owner" });
    const owner = (await members()).find((m) => m.email === OWNER);
    await expect(removeUser(createDb(env.DB), owner?.id ?? "")).rejects.toMatchObject({
      status: 409,
      code: "last_owner",
    });
    // A second active Owner can remove the first one.
    await seedUser("second@team.test", "owner");
    const cookie = await signInAs("second@team.test");
    const res = await apiFetch(`/api/team/${owner?.id}`, { method: "DELETE", headers: { cookie } });
    expect(res.status).toBe(204);
  });
});
