import { env, exports } from "cloudflare:workers";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import type { UserRole } from "../../src/shared/domain";
import {
  ACCESS_JWT_HEADER,
  normalizeTeamDomain,
  setJwksFetchForTesting,
} from "../../src/worker/auth/access";
import { createDb, schema } from "../../src/worker/db/client";

// One RSA key pair per test file. The Worker fetches the JWKS through the stub below,
// so tokens signed here verify exactly as real Access tokens do.
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };

export const TEST_ISSUER = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
export const TEST_CERTS_URL = `${TEST_ISSUER}/cdn-cgi/access/certs`;

/** Number of JWKS fetches since the last `installAccessKeys()`. */
export let jwksFetchCount = 0;

/** Serves the test key set to the Access verifier. Call in `beforeAll` or `beforeEach`. */
export function installAccessKeys(): void {
  jwksFetchCount = 0;
  setJwksFetchForTesting(async (url) => {
    jwksFetchCount += 1;
    if (url !== TEST_CERTS_URL) return new Response("not found", { status: 404 });
    return Response.json({ keys: [publicJwk] });
  });
}

export interface TokenOptions {
  audience?: string;
  issuer?: string;
  /** Seconds since the epoch, or a jose time span such as "1h" or "-1m". */
  expiresAt?: number | string;
  claims?: JWTPayload;
  key?: CryptoKey;
}

/** Signs an Access-style JWT for `email` with the test key. */
export async function accessToken(email: string, options: TokenOptions = {}): Promise<string> {
  return new SignJWT({ email, ...options.claims })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(options.issuer ?? TEST_ISSUER)
    .setAudience(options.audience ?? env.ACCESS_AUD)
    .setSubject(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? "1h")
    .sign(options.key ?? privateKey);
}

export interface AuthedInit extends RequestInit {
  /** Signs the request as this email. Omit for an unauthenticated request. */
  as?: string;
  token?: TokenOptions;
  /** Sends a JSON body with the right content type. */
  json?: unknown;
}

/** Builds a Request for the Worker, with an Access JWT when `as` is set. */
export async function buildRequest(path: string, init: AuthedInit = {}): Promise<Request> {
  const { as, token, json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (as) headers.set(ACCESS_JWT_HEADER, await accessToken(as, token));
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

/** Inserts a team member. Emails are stored lowercase. */
export async function seedUser(email: string, role: UserRole = "member") {
  const db = createDb(env.DB);
  const [user] = await db
    .insert(schema.users)
    .values({ email: email.toLowerCase(), role })
    .returning();
  if (!user) throw new Error("user insert failed");
  return user;
}

/** Deletes every team member. */
export async function clearUsers(): Promise<void> {
  await env.DB.prepare("DELETE FROM users").run();
}
