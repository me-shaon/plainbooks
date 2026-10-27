import { eq } from "drizzle-orm";
import { type CredentialError, type ProviderMeta, parseCredentials } from "mailswitch";
import { createKeyRing, decrypt, encrypt, type KeyRing } from "mailswitch/crypto";
import { EMAIL_PROVIDER_ROLES, type EmailProviderRole } from "../../shared/domain";
import { type Db, isRequestScoped, schema } from "../db/client";
import type { EmailProviderRow } from "../db/schema";
import { AppError } from "../errors";
import { defaultDailyCap, type EmailProviderId, emailProviderMeta } from "./catalog";

const { emailProviders } = schema;

/** The encrypted columns. Each one is part of the encryption scope. */
type SecretColumn = "credentials" | "webhookSecret";

/**
 * The encryption scope of one column. It names the role, the provider, and the column,
 * so a ciphertext copied to another column, role, or provider does not decrypt.
 */
export function secretScope(
  role: EmailProviderRole,
  providerId: string,
  column: SecretColumn,
): string[] {
  return ["plainbooks", "email", role, providerId, column];
}

/** One ring per key value, so the derived AES key is cached between calls. */
let cachedRing: { secret: string; ring: KeyRing } | undefined;

/**
 * The key ring from `ENCRYPTION_KEY`, or null when the secret is missing or is not at
 * least 32 bytes of base64.
 */
export function loadKeyRing(secret: string | undefined): KeyRing | null {
  if (!secret) return null;
  if (cachedRing?.secret === secret) return cachedRing.ring;
  try {
    const ring = createKeyRing({ keys: [{ version: 1, secret }], current: 1 });
    cachedRing = { secret, ring };
    return ring;
  } catch {
    return null;
  }
}

function requireKeyRing(secret: string | undefined): KeyRing {
  const ring = loadKeyRing(secret);
  if (!ring) {
    throw new AppError(
      500,
      "encryption_key_missing",
      "Set the ENCRYPTION_KEY secret to at least 32 random bytes as base64",
    );
  }
  return ring;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** The settings of one role that the stored keys do not need. */
interface ProviderBase {
  role: EmailProviderRole;
  providerId: EmailProviderId;
  presetId: string | null;
  /** The cap the Owner set. Null means `defaultDailyCap`. */
  dailyCap: number | null;
  /** The cap of the provider or preset, or null for no cap. */
  defaultDailyCap: number | null;
  updatedAt: number;
}

/** A provider with its keys decrypted. Only the send and webhook paths use it. */
export interface ReadyEmailProvider extends ProviderBase {
  status: "ready";
  credentials: Readonly<Record<string, string>>;
  webhookSecret: string | null;
}

/**
 * A provider whose keys do not decrypt: `ENCRYPTION_KEY` changed or is missing, or a
 * value was moved between columns. The Owner must enter the keys again.
 */
export interface NeedsReentryEmailProvider extends ProviderBase {
  status: "needs_reentry";
}

export type StoredEmailProvider = ReadyEmailProvider | NeedsReentryEmailProvider;

export type StoredEmailProviders = Partial<Record<EmailProviderRole, StoredEmailProvider>>;

/** Row reads per request-scoped handle, like `loadWorkspace`. */
const rowReads = new WeakMap<Db, Promise<EmailProviderRow[]>>();

function forgetEmailProviders(db: Db): void {
  rowReads.delete(db);
}

/** One query. A Drizzle builder runs again on each `then`, so the cache keeps a Promise. */
async function selectRows(db: Db): Promise<EmailProviderRow[]> {
  return db.select().from(emailProviders);
}

async function readRows(db: Db): Promise<EmailProviderRow[]> {
  if (!isRequestScoped(db)) return selectRows(db);
  let read = rowReads.get(db);
  if (!read) {
    read = selectRows(db);
    rowReads.set(db, read);
    read.catch(() => rowReads.delete(db));
  }
  return structuredClone(await read);
}

/** Decrypts one row. Any failure gives `needs_reentry`. It never throws for bad data. */
async function decryptRow(
  row: EmailProviderRow,
  ring: KeyRing | null,
): Promise<StoredEmailProvider> {
  const meta = emailProviderMeta(row.providerId);
  const base: ProviderBase = {
    role: row.role,
    providerId: row.providerId as EmailProviderId,
    presetId: row.presetId,
    dailyCap: row.dailyCap,
    defaultDailyCap: defaultDailyCap(row.providerId, row.presetId),
    updatedAt: row.updatedAt,
  };
  if (!meta || !ring) return { ...base, status: "needs_reentry" };
  try {
    const json = await decrypt(
      ring,
      row.credentials,
      secretScope(row.role, row.providerId, "credentials"),
    );
    const credentials = JSON.parse(json) as unknown;
    if (!isStringRecord(credentials)) return { ...base, status: "needs_reentry" };
    // Keys that no longer pass the field rules would make `createMailer` throw at send
    // time. Settings asks for them again instead.
    if (!parseCredentials(meta, credentials, row.presetId ?? undefined).ok) {
      return { ...base, status: "needs_reentry" };
    }
    const webhookSecret = row.webhookSecret
      ? await decrypt(
          ring,
          row.webhookSecret,
          secretScope(row.role, row.providerId, "webhookSecret"),
        )
      : null;
    return { ...base, status: "ready", credentials, webhookSecret };
  } catch {
    // A CredentialDecryptError or bad JSON. The error text holds no secret, but the
    // Owner only needs to know that the keys must be entered again.
    return { ...base, status: "needs_reentry" };
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  );
}

/** The stored primary and fallback, decrypted. A missing role has no entry. */
export async function loadEmailProviders(
  db: Db,
  encryptionKey: string | undefined,
): Promise<StoredEmailProviders> {
  const rows = await readRows(db);
  const ring = loadKeyRing(encryptionKey);
  const result: StoredEmailProviders = {};
  for (const row of rows) result[row.role] = await decryptRow(row, ring);
  return result;
}

/**
 * The stored provider of one role, decrypted, or undefined when the role has none. It
 * decrypts only that role, so the webhook path does no work for the other role.
 */
export async function loadEmailProvider(
  db: Db,
  encryptionKey: string | undefined,
  role: EmailProviderRole,
): Promise<StoredEmailProvider | undefined> {
  const row = (await readRows(db)).find((r) => r.role === role);
  return row ? decryptRow(row, loadKeyRing(encryptionKey)) : undefined;
}

/**
 * The providers a send can use, primary first. A fallback that needs re-entry is left
 * out. Throws 422 `email_not_configured` when no primary is saved or its keys do not
 * decrypt, so nothing is sent.
 */
export async function usableEmailProviders(
  db: Db,
  encryptionKey: string | undefined,
): Promise<ReadyEmailProvider[]> {
  const { primary, fallback } = await loadEmailProviders(db, encryptionKey);
  if (primary?.status !== "ready") {
    throw new AppError(
      422,
      "email_not_configured",
      primary
        ? "Enter the email provider keys again in Settings"
        : "Set up an email provider in Settings",
    );
  }
  return fallback?.status === "ready" ? [primary, fallback] : [primary];
}

// ---------------------------------------------------------------------------
// Masked view
// ---------------------------------------------------------------------------

/** What Settings shows for one role. It never holds a secret or a ciphertext. */
export interface EmailProviderView extends ProviderBase {
  configured: true;
  /** True when the stored keys do not decrypt. The form then asks for every key. */
  needsReentry: boolean;
  /** The values of the fields that are not secret, by field name. */
  values: Record<string, string>;
  /** For each secret field, true when a value is saved. */
  secrets: Record<string, boolean>;
  webhookSecretConfigured: boolean;
}

export type EmailSettingsView = Record<EmailProviderRole, EmailProviderView | null>;

function maskProvider(stored: StoredEmailProvider): EmailProviderView {
  const { status, ...base } = stored;
  const meta = emailProviderMeta(stored.providerId);
  const values: Record<string, string> = {};
  const secrets: Record<string, boolean> = {};
  const ready = status === "ready";
  for (const field of meta?.credentialFields ?? []) {
    const value = ready ? stored.credentials[field.name] : undefined;
    if (field.secret) secrets[field.name] = Boolean(value);
    else if (value !== undefined) values[field.name] = value;
  }
  return {
    role: base.role,
    providerId: base.providerId,
    presetId: base.presetId,
    dailyCap: base.dailyCap,
    defaultDailyCap: base.defaultDailyCap,
    updatedAt: base.updatedAt,
    configured: true,
    needsReentry: !ready,
    values,
    secrets,
    webhookSecretConfigured: ready && Boolean(stored.webhookSecret),
  };
}

/** The masked settings of both roles, for GET responses. */
export async function getEmailSettingsView(
  db: Db,
  encryptionKey: string | undefined,
): Promise<EmailSettingsView> {
  const stored = await loadEmailProviders(db, encryptionKey);
  const view = {} as EmailSettingsView;
  for (const role of EMAIL_PROVIDER_ROLES) {
    const entry = stored[role];
    view[role] = entry ? maskProvider(entry) : null;
  }
  return view;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface EmailProviderInput {
  providerId: string;
  presetId?: string | null;
  /**
   * The form values by field name. An empty secret field keeps the saved value when the
   * role already has the same provider, because the form never prefills secrets.
   */
  credentials: Readonly<Record<string, unknown>>;
  /** Undefined keeps the saved secret (same provider only). Null or "" removes it. */
  webhookSecret?: string | null;
  /** Null or undefined means the default cap. */
  dailyCap?: number | null;
}

function credentialIssues(errors: readonly CredentialError[]) {
  return errors.map((error) => ({ path: `credentials.${error.field}`, message: error.code }));
}

/** Fills empty secret fields from the saved keys, for a save that keeps the provider. */
function keepSavedSecrets(
  meta: ProviderMeta,
  input: Readonly<Record<string, unknown>>,
  saved: StoredEmailProvider | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...input };
  if (saved?.status !== "ready" || saved.providerId !== meta.id) return merged;
  for (const field of meta.credentialFields) {
    const value = merged[field.name];
    const empty = value === undefined || value === null || value === "";
    if (field.secret && empty && saved.credentials[field.name] !== undefined) {
      merged[field.name] = saved.credentials[field.name];
    }
  }
  return merged;
}

/** Input that passed `parseCredentials`, before it is encrypted and saved. */
export interface CheckedEmailProvider {
  role: EmailProviderRole;
  providerId: EmailProviderId;
  presetId: string | null;
  /** The parsed keys, with preset values and field defaults applied. */
  credentials: Readonly<Record<string, string>>;
  dailyCap: number | null;
}

export interface SaveEmailProviderOptions {
  /**
   * Runs after `parseCredentials` and before the keys are encrypted, for example a live
   * `verify()`. Throw an AppError to stop the save. `stored` holds both saved roles.
   */
  check?: (candidate: CheckedEmailProvider, stored: StoredEmailProviders) => Promise<void>;
}

/**
 * Checks the input with `parseCredentials`, encrypts the keys, and saves the role. It
 * replaces any provider the role had. Pass `options.check` for a live check before the
 * save. Returns the masked view.
 */
export async function saveEmailProvider(
  db: Db,
  encryptionKey: string | undefined,
  role: EmailProviderRole,
  input: EmailProviderInput,
  options: SaveEmailProviderOptions = {},
): Promise<EmailProviderView> {
  const ring = requireKeyRing(encryptionKey);
  const meta = emailProviderMeta(input.providerId);
  if (!meta) {
    throw new AppError(400, "unknown_email_provider", "This email provider is not available");
  }
  const presetId = input.presetId || null;
  if (presetId && !meta.presets?.some((preset) => preset.id === presetId)) {
    throw new AppError(400, "unknown_email_preset", "This preset is not available");
  }
  const dailyCap = input.dailyCap ?? null;
  if (dailyCap !== null && !(Number.isSafeInteger(dailyCap) && dailyCap > 0)) {
    throw new AppError(400, "invalid_daily_cap", "The daily cap must be a whole number above 0");
  }

  const stored = await loadEmailProviders(db, encryptionKey);
  const saved = stored[role];
  const parsed = parseCredentials(
    meta,
    keepSavedSecrets(meta, input.credentials, saved),
    presetId ?? undefined,
  );
  if (!parsed.ok) {
    const fields = parsed.errors.map((error) => error.field).join(", ");
    throw new AppError(
      400,
      "invalid_credentials",
      `Check these fields: ${fields}`,
      credentialIssues(parsed.errors),
    );
  }

  await options.check?.(
    {
      role,
      providerId: meta.id as EmailProviderId,
      presetId,
      credentials: parsed.values,
      dailyCap,
    },
    stored,
  );

  let webhookSecretText = input.webhookSecret?.trim() || null;
  if (input.webhookSecret === undefined) {
    const keep = saved?.status === "ready" && saved.providerId === meta.id;
    webhookSecretText = keep ? saved.webhookSecret : null;
  }

  const credentials = await encrypt(
    ring,
    JSON.stringify(parsed.values),
    secretScope(role, meta.id, "credentials"),
  );
  const webhookSecret = webhookSecretText
    ? await encrypt(ring, webhookSecretText, secretScope(role, meta.id, "webhookSecret"))
    : null;

  const values = { providerId: meta.id, presetId, credentials, webhookSecret, dailyCap };
  const [row] = await db
    .insert(emailProviders)
    .values({ role, ...values })
    .onConflictDoUpdate({
      target: emailProviders.role,
      set: { ...values, updatedAt: Date.now() },
    })
    .returning();
  forgetEmailProviders(db);
  if (!row)
    throw new AppError(500, "email_settings_not_saved", "The email settings were not saved");
  return maskProvider(await decryptRow(row, ring));
}

/** Removes the provider of a role. Returns false when the role had none. */
export async function deleteEmailProvider(db: Db, role: EmailProviderRole): Promise<boolean> {
  const rows = await db
    .delete(emailProviders)
    .where(eq(emailProviders.role, role))
    .returning({ role: emailProviders.role });
  forgetEmailProviders(db);
  return rows.length > 0;
}
