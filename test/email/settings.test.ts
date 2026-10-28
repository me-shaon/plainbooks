import { env } from "cloudflare:workers";
import { createSendContext, parseCredentials } from "mailswitch";
import { catalog, getProviderMeta } from "mailswitch/catalog";
import { CredentialDecryptError, decrypt, encrypt } from "mailswitch/crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, createRequestDb, schema } from "../../src/worker/db/client";
import {
  ADAPTER_FACTORIES,
  createAdapter,
  DEFAULT_EMAIL_PROVIDER_ID,
  defaultDailyCap,
  EMAIL_PROVIDER_IDS,
  emailProviderCatalog,
} from "../../src/worker/email/catalog";
import {
  deleteEmailProvider,
  getEmailSettingsView,
  loadEmailProviders,
  loadKeyRing,
  saveEmailProvider,
  secretScope,
  usableEmailProviders,
} from "../../src/worker/email/settings";
import { AppError } from "../../src/worker/errors";
import { countingEnv } from "../helpers/d1";

const db = createDb(env.DB);
const KEY = env.ENCRYPTION_KEY;
const OTHER_KEY = btoa("another-encryption-key-abcdefghi");
const API_KEY = "tsend_live_abc123";
const WEBHOOK_SECRET = "tosend-webhook-secret-value";

async function expectAppError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  expect(error).toMatchObject({ status, code });
  return error as AppError;
}

function saveToSend(key = KEY) {
  return saveEmailProvider(db, key, "primary", {
    providerId: "tosend",
    credentials: { apiKey: API_KEY },
    webhookSecret: WEBHOOK_SECRET,
  });
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM email_providers").run();
});

describe("email catalog", () => {
  it("lists every installed catalog provider except cloudflare-binding, mailchannels, and http", () => {
    const unoffered = ["cloudflare-binding", "mailchannels", "http"];
    const installed = catalog.map((meta) => meta.id).filter((id) => !unoffered.includes(id));
    expect([...EMAIL_PROVIDER_IDS]).toEqual(installed);
    expect(Object.keys(ADAPTER_FACTORIES).sort()).toEqual([...installed].sort());
    expect(emailProviderCatalog().map((meta) => meta.id)).toEqual(installed);
    expect(DEFAULT_EMAIL_PROVIDER_ID).toBe("tosend");
  });

  it("builds an adapter for every provider, with meta that matches its ID", () => {
    for (const id of EMAIL_PROVIDER_IDS) {
      expect(createAdapter(id).meta.id, id).toBe(id);
    }
  });

  it("reuses one SES adapter per isolate", () => {
    expect(createAdapter("ses")).toBe(createAdapter("ses"));
  });

  it("passes the injected connect to SMTP", async () => {
    const targets: unknown[] = [];
    const adapter = createAdapter("smtp", {
      connect: (target) => {
        targets.push(target);
        throw new Error("no network in tests");
      },
    });
    const meta = getProviderMeta("smtp");
    if (!meta) throw new Error("smtp meta missing");
    const parsed = parseCredentials(meta, {
      host: "smtp.example.com",
      username: "u",
      password: "p",
    });
    if (!parsed.ok) throw new Error("smtp credentials did not parse");
    await adapter.verify(createSendContext({ credentials: parsed.values }));
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ hostname: "smtp.example.com" });
  });

  it("uses the preset cap first, then the provider table", () => {
    expect(defaultDailyCap("resend")).toBe(100);
    expect(defaultDailyCap("tosend")).toBeNull();
    expect(defaultDailyCap("smtp", "gmail")).toBe(500);
    expect(defaultDailyCap("smtp", "custom")).toBeNull();
    expect(defaultDailyCap("cloudflare-binding")).toBeNull();
  });
});

describe("email provider settings", () => {
  it("saves toSend credentials encrypted and reads back the same values", async () => {
    await saveToSend();

    const [row] = await db.select().from(schema.emailProviders);
    expect(row).toMatchObject({ role: "primary", providerId: "tosend", presetId: null });
    expect(row?.credentials).not.toContain(API_KEY);
    expect(row?.webhookSecret).not.toContain(WEBHOOK_SECRET);

    const { primary, fallback } = await loadEmailProviders(db, KEY);
    expect(fallback).toBeUndefined();
    expect(primary).toMatchObject({
      status: "ready",
      providerId: "tosend",
      credentials: { apiKey: API_KEY },
      webhookSecret: WEBHOOK_SECRET,
    });
  });

  it("returns a masked view with configured flags and no secret", async () => {
    const saved = await saveToSend();
    const view = await getEmailSettingsView(db, KEY);

    expect(view.fallback).toBeNull();
    expect(view.primary).toEqual(saved);
    expect(view.primary).toMatchObject({
      configured: true,
      needsReentry: false,
      values: {},
      secrets: { apiKey: true },
      webhookSecretConfigured: true,
    });
    const [row] = await db.select().from(schema.emailProviders);
    const json = JSON.stringify(view);
    expect(json).not.toContain(API_KEY);
    expect(json).not.toContain(WEBHOOK_SECRET);
    expect(json).not.toContain(row?.credentials ?? "missing");
  });

  it("shows the values of fields that are not secret, and applies preset values", async () => {
    const view = await saveEmailProvider(db, KEY, "fallback", {
      providerId: "smtp",
      presetId: "gmail",
      credentials: { username: "owner@gmail.example", password: "app-password", host: "evil" },
    });
    expect(view.values).toMatchObject({
      preset: "gmail",
      host: "smtp.gmail.com",
      port: "587",
      username: "owner@gmail.example",
    });
    expect(view.secrets).toEqual({ password: true });
    expect(view.defaultDailyCap).toBe(500);
    expect(JSON.stringify(view)).not.toContain("app-password");
  });

  it("binds each ciphertext to its column: an apiKey envelope in webhook_secret fails", async () => {
    await saveToSend();
    const [row] = await db.select().from(schema.emailProviders);
    if (!row) throw new Error("row missing");
    const ring = loadKeyRing(KEY);
    if (!ring) throw new Error("ring missing");

    await expect(
      decrypt(ring, row.credentials, secretScope("primary", "tosend", "webhookSecret")),
    ).rejects.toBeInstanceOf(CredentialDecryptError);

    await env.DB.prepare("UPDATE email_providers SET webhook_secret = credentials").run();
    const { primary } = await loadEmailProviders(db, KEY);
    expect(primary?.status).toBe("needs_reentry");
    expect(primary).not.toHaveProperty("credentials");
  });

  it("binds each ciphertext to its role", async () => {
    await saveToSend();
    await env.DB.prepare(
      "INSERT INTO email_providers (role, provider_id, credentials) SELECT 'fallback', provider_id, credentials FROM email_providers WHERE role = 'primary'",
    ).run();
    const { primary, fallback } = await loadEmailProviders(db, KEY);
    expect(primary?.status).toBe("ready");
    expect(fallback?.status).toBe("needs_reentry");
  });

  it("rejects credentials that fail parseCredentials, with the field names", async () => {
    const error = await expectAppError(
      saveEmailProvider(db, KEY, "primary", {
        providerId: "tosend",
        credentials: { apiKey: "not-a-tosend-key" },
      }),
      400,
      "invalid_credentials",
    );
    expect(error.message).toContain("apiKey");
    expect(error.message).not.toContain("not-a-tosend-key");
    expect(error.issues).toEqual([{ path: "credentials.apiKey", message: "pattern" }]);

    const missing = await expectAppError(
      saveEmailProvider(db, KEY, "primary", { providerId: "postmark", credentials: {} }),
      400,
      "invalid_credentials",
    );
    expect(missing.issues?.map((issue) => issue.message)).toContain("required");
    expect(await db.select().from(schema.emailProviders)).toHaveLength(0);
  });

  it("rejects an unknown provider, cloudflare-binding, an unknown preset, and a bad cap", async () => {
    const input = { credentials: { apiKey: API_KEY } };
    await expectAppError(
      saveEmailProvider(db, KEY, "primary", { ...input, providerId: "nope" }),
      400,
      "unknown_email_provider",
    );
    await expectAppError(
      saveEmailProvider(db, KEY, "primary", { ...input, providerId: "cloudflare-binding" }),
      400,
      "unknown_email_provider",
    );
    await expectAppError(
      saveEmailProvider(db, KEY, "primary", { ...input, providerId: "smtp", presetId: "nope" }),
      400,
      "unknown_email_preset",
    );
    for (const dailyCap of [0, -5, 1.5]) {
      await expectAppError(
        saveEmailProvider(db, KEY, "primary", { ...input, providerId: "tosend", dailyCap }),
        400,
        "invalid_daily_cap",
      );
    }
  });

  it("refuses to save without a usable ENCRYPTION_KEY", async () => {
    await expectAppError(saveToSend(""), 500, "encryption_key_missing");
    await expectAppError(saveToSend(btoa("too short")), 500, "encryption_key_missing");
  });

  it("allows only one row per role", async () => {
    await saveToSend();
    const ring = loadKeyRing(KEY);
    if (!ring) throw new Error("ring missing");
    const envelope = await encrypt(ring, "{}", secretScope("primary", "resend", "credentials"));
    await expect(
      env.DB.prepare(
        "INSERT INTO email_providers (role, provider_id, credentials) VALUES ('primary', 'resend', ?)",
      )
        .bind(envelope)
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await expect(
      env.DB.prepare(
        "INSERT INTO email_providers (role, provider_id, credentials) VALUES ('backup', 'resend', ?)",
      )
        .bind(envelope)
        .run(),
    ).rejects.toThrow(/CHECK/);

    // A second save replaces the primary in place.
    await saveEmailProvider(db, KEY, "primary", {
      providerId: "resend",
      credentials: { apiKey: "re_new_key_123" },
      dailyCap: 50,
    });
    const rows = await db.select().from(schema.emailProviders);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "primary", providerId: "resend", dailyCap: 50 });
    expect(rows[0]?.webhookSecret).toBeNull();
  });

  it("keeps saved secrets when the form leaves them empty for the same provider", async () => {
    await saveToSend();
    await saveEmailProvider(db, KEY, "primary", {
      providerId: "tosend",
      credentials: { apiKey: "" },
      dailyCap: 25,
    });
    const { primary } = await loadEmailProviders(db, KEY);
    expect(primary).toMatchObject({
      status: "ready",
      credentials: { apiKey: API_KEY },
      webhookSecret: WEBHOOK_SECRET,
      dailyCap: 25,
    });

    // Null removes the webhook secret.
    await saveEmailProvider(db, KEY, "primary", {
      providerId: "tosend",
      credentials: {},
      webhookSecret: null,
    });
    expect((await getEmailSettingsView(db, KEY)).primary?.webhookSecretConfigured).toBe(false);
  });

  it("does not carry secrets over to a different provider", async () => {
    await saveToSend();
    await expectAppError(
      saveEmailProvider(db, KEY, "primary", { providerId: "resend", credentials: {} }),
      400,
      "invalid_credentials",
    );
  });

  it("marks the provider for re-entry after ENCRYPTION_KEY changes, and sends nothing", async () => {
    await saveToSend();

    const view = await getEmailSettingsView(db, OTHER_KEY);
    expect(view.primary).toMatchObject({
      configured: true,
      needsReentry: true,
      providerId: "tosend",
      values: {},
      secrets: { apiKey: false },
      webhookSecretConfigured: false,
    });
    await expectAppError(usableEmailProviders(db, OTHER_KEY), 422, "email_not_configured");
    await expectAppError(usableEmailProviders(db, undefined), 422, "email_not_configured");

    // Saving with an empty key field cannot reuse keys that do not decrypt.
    await expectAppError(
      saveEmailProvider(db, OTHER_KEY, "primary", { providerId: "tosend", credentials: {} }),
      400,
      "invalid_credentials",
    );
    // Entering the key again fixes it.
    await saveEmailProvider(db, OTHER_KEY, "primary", {
      providerId: "tosend",
      credentials: { apiKey: API_KEY },
    });
    expect((await usableEmailProviders(db, OTHER_KEY)).map((p) => p.role)).toEqual(["primary"]);
  });

  it("gives 422 with no primary, and skips a fallback that needs re-entry", async () => {
    await expectAppError(usableEmailProviders(db, KEY), 422, "email_not_configured");

    await saveToSend();
    await saveEmailProvider(db, KEY, "fallback", {
      providerId: "resend",
      credentials: { apiKey: "re_fallback_123" },
    });
    expect((await usableEmailProviders(db, KEY)).map((p) => p.providerId)).toEqual([
      "tosend",
      "resend",
    ]);
    await env.DB.prepare(
      "UPDATE email_providers SET credentials = 'ms1.bad' WHERE role = 'fallback'",
    ).run();
    expect((await usableEmailProviders(db, KEY)).map((p) => p.providerId)).toEqual(["tosend"]);
  });

  it("deletes a role", async () => {
    await saveToSend();
    expect(await deleteEmailProvider(db, "fallback")).toBe(false);
    expect(await deleteEmailProvider(db, "primary")).toBe(true);
    expect(await getEmailSettingsView(db, KEY)).toEqual({ primary: null, fallback: null });
  });

  it("reads the rows once per request handle, and a save clears that read", async () => {
    const requestDb = createRequestDb(env.DB);
    expect((await loadEmailProviders(requestDb, KEY)).primary).toBeUndefined();
    await saveEmailProvider(requestDb, KEY, "primary", {
      providerId: "tosend",
      credentials: { apiKey: API_KEY },
    });
    expect((await loadEmailProviders(requestDb, KEY)).primary?.status).toBe("ready");
    await deleteEmailProvider(requestDb, "primary");
    expect((await loadEmailProviders(requestDb, KEY)).primary).toBeUndefined();
  });

  it("runs one query for every read on a request handle", async () => {
    await saveToSend();
    const { env: counted, counter } = countingEnv();
    const requestDb = createRequestDb(counted.DB);
    await loadEmailProviders(requestDb, KEY);
    await usableEmailProviders(requestDb, KEY);
    await getEmailSettingsView(requestDb, KEY);
    expect(counter.statements).toBe(1);
  });

  it("marks stored keys that fail the field rules for re-entry", async () => {
    const ring = loadKeyRing(KEY);
    if (!ring) throw new Error("no key ring");
    const envelope = await encrypt(
      ring,
      JSON.stringify({ apiKey: "not-a-tosend-key" }),
      secretScope("primary", "tosend", "credentials"),
    );
    await env.DB.prepare(
      "INSERT INTO email_providers (role, provider_id, credentials) VALUES ('primary', 'tosend', ?)",
    )
      .bind(envelope)
      .run();
    expect((await loadEmailProviders(db, KEY)).primary?.status).toBe("needs_reentry");
    await expectAppError(usableEmailProviders(db, KEY), 422, "email_not_configured");
  });
});
