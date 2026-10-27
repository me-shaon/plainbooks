import { env } from "cloudflare:workers";
import type { OutgoingMessage, ProviderAdapter, SendContext, VerifyResult } from "mailswitch";
import { type FakeProvider, fakeProvider } from "mailswitch/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  EmailProviderView,
  EmailSettings,
  TestEmailResult,
} from "../../src/shared/schemas/email-settings";
import { createDb } from "../../src/worker/db/client";
import {
  createAppMailer,
  dailyCapOf,
  mailProviders,
  setMailerEntriesForTesting,
} from "../../src/worker/email/mailer";
import { AppError } from "../../src/worker/errors";
import { VERIFY_TIMEOUT_MS } from "../../src/worker/routes/email-settings";
import { apiFetch, clearUsers, installAccessKeys, seedUser } from "../helpers/auth";
import { fillDailyCap, resetEmailState } from "../helpers/email";

const db = createDb(env.DB);
const OWNER = "owner@email-settings.test";
const MEMBER = "member@email-settings.test";
const TOSEND_KEY = "tsend_live_primary123";
const OTHER_TOSEND_KEY = "tsend_live_other456";
const RESEND_KEY = "re_live_fallback789";
const WEBHOOK_SECRET = "tosend-webhook-signing-secret";

/** What the next `verify()` returns, and the contexts it got. */
let verifyResult: VerifyResult | (() => Promise<VerifyResult>) = { ok: true };
let verifyCalls: SendContext[] = [];
/** The fake that records test sends. */
let sender: FakeProvider;

function verifyAdapter(providerId: string): ProviderAdapter {
  sender = fakeProvider({ id: providerId });
  return {
    meta: sender.meta,
    send: (message: OutgoingMessage, ctx: SendContext) => sender.send(message, ctx),
    verify: async (ctx: SendContext) => {
      verifyCalls.push(ctx);
      return typeof verifyResult === "function" ? verifyResult() : verifyResult;
    },
  };
}

function put(role: string, json: unknown, as = OWNER) {
  return apiFetch(`/api/settings/email/${role}`, { as, method: "PUT", json });
}

function saveToSend(apiKey = TOSEND_KEY, extra: Record<string, unknown> = {}) {
  return put("primary", { providerId: "tosend", credentials: { apiKey }, ...extra });
}

async function getSettings(): Promise<EmailSettings> {
  const res = await apiFetch("/api/settings/email", { as: OWNER });
  expect(res.status).toBe(200);
  return (await res.json()) as EmailSettings;
}

beforeAll(installAccessKeys);

beforeEach(async () => {
  await resetEmailState();
  await clearUsers();
  await seedUser(OWNER, "owner");
  await seedUser(MEMBER, "member");
  verifyResult = { ok: true };
  verifyCalls = [];
  // The stored keys reach the adapter, so a test can check what verify() got.
  setMailerEntriesForTesting((provider) => ({
    adapter: verifyAdapter(provider.providerId),
    credentials: provider.credentials,
  }));
});

afterEach(() => setMailerEntriesForTesting(null));

describe("access", () => {
  it("gives a Member 403 on every route", async () => {
    const calls: [string, string, unknown?][] = [
      ["GET", "/api/settings/email"],
      ["PUT", "/api/settings/email/primary", { providerId: "tosend", credentials: {} }],
      ["PUT", "/api/settings/email/fallback", { providerId: "tosend", credentials: {} }],
      ["DELETE", "/api/settings/email/fallback"],
      ["POST", "/api/settings/email/test", {}],
    ];
    for (const [method, path, json] of calls) {
      const res = await apiFetch(path, { as: MEMBER, method, json });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await res.json()).toMatchObject({ code: "owner_required" });
    }
    expect(verifyCalls).toHaveLength(0);
  });
});

describe("GET /api/settings/email", () => {
  it("shows a fresh install with toSend preselected and no saved provider", async () => {
    const body = await getSettings();
    expect(body.defaultProviderId).toBe("tosend");
    expect(body.settings).toEqual({ primary: null, fallback: null });
    const ids = body.providers.map((p) => p.id);
    expect(ids).toContain("tosend");
    expect(ids).toContain("smtp");
    expect(ids).not.toContain("cloudflare-binding");
    expect(body.webhookUrls).toEqual({
      primary: "https://invoices.example.com/api/webhooks/email/primary",
      fallback: "https://invoices.example.com/api/webhooks/email/fallback",
    });
  });

  it("describes credential fields, presets, webhook secrets, and default caps", async () => {
    const { providers } = await getSettings();
    const byId = new Map(providers.map((p) => [p.id, p]));
    expect(byId.get("tosend")?.credentialFields).toEqual([
      expect.objectContaining({ name: "apiKey", secret: true, required: true }),
    ]);
    expect(byId.get("tosend")?.webhookSecret?.label).toBe("Webhook signing secret");
    expect(byId.get("ses")?.webhookSecret?.label).toBe("SNS topic ARNs");
    expect(byId.get("smtp")?.webhookSecret).toBeNull();
    expect(byId.get("resend")?.defaultDailyCap).toBe(100);
    expect(byId.get("tosend")?.defaultDailyCap).toBeNull();
    const gmail = byId.get("smtp")?.presets.find((p) => p.id === "gmail");
    expect(gmail).toMatchObject({
      fixed: { host: "smtp.gmail.com", port: "587" },
      defaultDailyCap: 500,
    });
  });
});

describe("PUT /api/settings/email/primary", () => {
  it("verifies valid toSend keys, stores them encrypted, and never returns them", async () => {
    const res = await saveToSend(TOSEND_KEY, { webhookSecret: WEBHOOK_SECRET });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(TOSEND_KEY);
    expect(text).not.toContain(WEBHOOK_SECRET);
    const view = JSON.parse(text) as EmailProviderView;
    expect(view).toMatchObject({
      providerId: "tosend",
      configured: true,
      needsReentry: false,
      secrets: { apiKey: true },
      webhookSecretConfigured: true,
    });

    expect(verifyCalls).toHaveLength(1);
    expect(verifyCalls[0]?.credentials).toEqual({ apiKey: TOSEND_KEY });
    expect(verifyCalls[0]?.timeoutMs).toBe(VERIFY_TIMEOUT_MS);

    const row = await env.DB.prepare(
      "SELECT credentials, webhook_secret FROM email_providers WHERE role = 'primary'",
    ).first<{ credentials: string; webhook_secret: string }>();
    expect(row?.credentials).not.toContain(TOSEND_KEY);
    expect(row?.webhook_secret).not.toContain(WEBHOOK_SECRET);

    const getRes = await apiFetch("/api/settings/email", { as: OWNER });
    const getText = await getRes.text();
    expect(getText).not.toContain(TOSEND_KEY);
    expect(getText).not.toContain(WEBHOOK_SECRET);
    const body = JSON.parse(getText) as EmailSettings;
    expect(body.settings.primary).toMatchObject({ configured: true, providerId: "tosend" });
  });

  it("rejects the save with a clear message when verify() returns auth", async () => {
    verifyResult = { ok: false, status: "not_sent", reason: "auth", message: "401" };
    const res = await saveToSend();
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; error: string; issues: unknown[] };
    expect(body.code).toBe("email_verify_failed");
    expect(body.error).toBe("The provider refused the keys. Check them and try again.");
    expect(body.issues).toEqual([{ path: "verify", message: "auth" }]);
    expect((await getSettings()).settings.primary).toBeNull();
  });

  it("reports a provider check that throws as a failed check, and saves nothing", async () => {
    verifyResult = () => Promise.reject(new Error("boom"));
    const res = await saveToSend();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "email_verify_failed" });
    expect((await getSettings()).settings.primary).toBeNull();
  });

  it("returns parseCredentials field errors and calls no provider", async () => {
    const res = await saveToSend("not-a-tosend-key");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: "invalid_credentials",
      issues: [{ path: "credentials.apiKey", message: "pattern" }],
    });
    expect(verifyCalls).toHaveLength(0);
  });

  it("refuses an unknown provider and cloudflare-binding", async () => {
    for (const providerId of ["nope", "cloudflare-binding"]) {
      const res = await put("primary", { providerId, credentials: { bindingName: "EMAIL" } });
      expect(res.status, providerId).toBe(400);
      expect(await res.json()).toMatchObject({ code: "unknown_email_provider" });
    }
  });

  it("refuses a daily cap that is not a whole number above 0", async () => {
    for (const dailyCap of [0, -5, 2.5]) {
      const res = await saveToSend(TOSEND_KEY, { dailyCap });
      expect(res.status, String(dailyCap)).toBe(400);
      expect(await res.json()).toMatchObject({ issues: [{ path: "dailyCap" }] });
    }
  });

  it("keeps the saved key when the form leaves the secret field empty", async () => {
    await saveToSend(TOSEND_KEY, { webhookSecret: WEBHOOK_SECRET });
    verifyCalls = [];
    const res = await saveToSend("", { dailyCap: 25 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dailyCap: 25, webhookSecretConfigured: true });
    expect(verifyCalls[0]?.credentials).toEqual({ apiKey: TOSEND_KEY });
  });

  it("replaces the saved keys when the provider changes", async () => {
    await saveToSend(TOSEND_KEY, { webhookSecret: WEBHOOK_SECRET });
    const res = await put("primary", { providerId: "resend", credentials: { apiKey: RESEND_KEY } });
    expect(res.status).toBe(200);
    const view = (await res.json()) as EmailProviderView;
    expect(view).toMatchObject({ providerId: "resend", webhookSecretConfigured: false });
    expect(view.defaultDailyCap).toBe(100);
  });

  it("fixes the host and port of the SMTP gmail preset and applies its 500 cap", async () => {
    const res = await put("primary", {
      providerId: "smtp",
      presetId: "gmail",
      credentials: {
        host: "mail.attacker.example",
        port: "25",
        username: "studio@gmail.com",
        password: "abcd efgh ijkl mnop",
      },
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as EmailProviderView;
    expect(view.presetId).toBe("gmail");
    expect(view.values).toMatchObject({ host: "smtp.gmail.com", port: "587", preset: "gmail" });
    expect(view.secrets).toEqual({ password: true });
    expect(view.dailyCap).toBeNull();
    expect(view.defaultDailyCap).toBe(500);
    expect(verifyCalls[0]?.credentials).toMatchObject({ host: "smtp.gmail.com", port: "587" });

    const [primary] = await mailProviders(env, db);
    expect(primary && dailyCapOf(primary)).toBe(500);
  });

  it("makes the 51st toSend send that day return not_sent/daily_cap with a cap of 50", async () => {
    expect((await saveToSend(TOSEND_KEY, { dailyCap: 50 })).status).toBe(200);
    const now = Date.now();
    const providers = await mailProviders(env, db);
    expect(providers[0] && dailyCapOf(providers[0])).toBe(50);
    await fillDailyCap({ providerId: "tosend", role: "primary" }, 49, now);

    // The fake adapter takes its own keys. The stored cap still applies.
    setMailerEntriesForTesting((provider) => ({
      adapter: fakeProvider({ id: provider.providerId }),
      credentials: { apiKey: "fk_test" },
    }));
    const mailer = createAppMailer(env, db, providers, now);
    const message = {
      from: "billing@studio.test",
      to: ["client@example.com"],
      subject: "Invoice",
      text: "Hello",
    };
    expect((await mailer.send({ ...message, idempotencyKey: "cap-test-50" })).status).toBe("sent");
    expect(await mailer.send({ ...message, idempotencyKey: "cap-test-51" })).toMatchObject({
      status: "not_sent",
      reason: "daily_cap",
    });
  });
});

describe("PUT /api/settings/email/fallback", () => {
  it("needs a saved primary first", async () => {
    const res = await put("fallback", {
      providerId: "resend",
      credentials: { apiKey: RESEND_KEY },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "primary_required" });
  });

  it("rejects the same provider and the same keys as the primary", async () => {
    await saveToSend();
    const res = await put("fallback", {
      providerId: "tosend",
      credentials: { apiKey: TOSEND_KEY },
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "same_email_account" });
    expect((await getSettings()).settings.fallback).toBeNull();
  });

  it("accepts a second account of the same provider", async () => {
    await saveToSend();
    const res = await put("fallback", {
      providerId: "tosend",
      credentials: { apiKey: OTHER_TOSEND_KEY },
    });
    expect(res.status).toBe(200);
  });

  it("rejects a primary change that would copy the fallback account", async () => {
    await saveToSend();
    await put("fallback", { providerId: "resend", credentials: { apiKey: RESEND_KEY } });
    const res = await put("primary", { providerId: "resend", credentials: { apiKey: RESEND_KEY } });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "same_email_account" });
  });

  it("saves a fallback with its own webhook secret, and DELETE removes it", async () => {
    await saveToSend();
    const res = await put("fallback", {
      providerId: "resend",
      credentials: { apiKey: RESEND_KEY },
      webhookSecret: `whsec_${btoa("fallback-secret-0123456789")}`,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: "fallback", webhookSecretConfigured: true });

    const del = await apiFetch("/api/settings/email/fallback", { as: OWNER, method: "DELETE" });
    expect(del.status).toBe(204);
    const { settings } = await getSettings();
    expect(settings.fallback).toBeNull();
    expect(settings.primary).not.toBeNull();
  });
});

describe("POST /api/settings/email/test", () => {
  it("sends one test email from the sender address to the Owner", async () => {
    await saveToSend();
    const res = await apiFetch("/api/settings/email/test", { as: OWNER, method: "POST", json: {} });
    expect(res.status).toBe(200);
    expect((await res.json()) as TestEmailResult).toEqual({ status: "sent", to: OWNER });
    expect(sender.sends).toHaveLength(1);
    const message = sender.sends[0]?.message;
    expect(message?.to).toEqual([OWNER]);
    expect(message?.from).toMatchObject({ email: "billing@studio.test" });
    expect(message?.subject).toBe("PlainBooks test email");
  });

  it("returns the failure reason when the provider does not send", async () => {
    await saveToSend();
    setMailerEntriesForTesting((provider) => ({
      adapter: fakeProvider({
        id: provider.providerId,
        outcomes: [{ status: "not_sent", reason: "auth", message: "Unauthorized" }],
      }),
      credentials: provider.credentials,
    }));
    const res = await apiFetch("/api/settings/email/test", { as: OWNER, method: "POST", json: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "not_sent", reason: "auth" });
  });

  it("covers AE3: with no primary saved, email is not configured and nothing is sent", async () => {
    const res = await apiFetch("/api/settings/email/test", { as: OWNER, method: "POST", json: {} });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "email_not_configured" });
    // Invites and resets use the same check, then fall back to a link to copy.
    const error = await mailProviders(env, db).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ status: 422, code: "email_not_configured" });
  });

  it("needs a saved fallback to test the fallback", async () => {
    await saveToSend();
    const res = await apiFetch("/api/settings/email/test", {
      as: OWNER,
      method: "POST",
      json: { role: "fallback" },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "email_not_configured" });
  });
});
