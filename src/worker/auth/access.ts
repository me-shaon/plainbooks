import {
  createRemoteJWKSet,
  customFetch,
  type FetchImplementation,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";

/** The header that Cloudflare Access adds to every request it lets through. */
export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

export interface AccessConfig {
  /** Team domain, with or without the scheme: "team.cloudflareaccess.com". */
  teamDomain: string;
  /** The Application Audience (AUD) tag of the Access application. */
  audience: string;
}

export interface AccessIdentity {
  email: string;
  claims: JWTPayload;
}

/** Thrown when the token is missing, malformed, expired, or for the wrong app. */
export class AccessTokenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AccessTokenError";
  }
}

/** Returns "https://team.cloudflareaccess.com" with no trailing slash. */
export function normalizeTeamDomain(teamDomain: string): string {
  const trimmed = teamDomain.trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// The key set caches fetched keys, so it lives at module scope and is reused by
// every request in the isolate. One entry per team domain.
const keySets = new Map<string, JWTVerifyGetKey>();
let fetchOverride: FetchImplementation | undefined;

/**
 * Tests only: serve the JWKS from `fetchImpl` instead of the network. Clears the cached
 * key sets. Pass undefined to restore the default fetch.
 */
export function setJwksFetchForTesting(fetchImpl: FetchImplementation | undefined): void {
  fetchOverride = fetchImpl;
  keySets.clear();
}

function getKeySet(issuer: string): JWTVerifyGetKey {
  let keySet = keySets.get(issuer);
  if (!keySet) {
    const url = new URL(`${issuer}/cdn-cgi/access/certs`);
    keySet = createRemoteJWKSet(url, fetchOverride ? { [customFetch]: fetchOverride } : {});
    keySets.set(issuer, keySet);
  }
  return keySet;
}

/**
 * Verifies an Access JWT: signature against the team JWKS, issuer, audience, and expiry.
 * Returns the lowercased email claim.
 */
export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
): Promise<AccessIdentity> {
  const issuer = normalizeTeamDomain(config.teamDomain);
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getKeySet(issuer), {
      issuer,
      audience: config.audience,
      algorithms: ["RS256"],
    }));
  } catch (cause) {
    throw new AccessTokenError("The Access token is not valid", { cause });
  }
  const email = payload.email;
  if (typeof email !== "string" || !email.includes("@")) {
    throw new AccessTokenError("The Access token has no email claim");
  }
  return { email: email.trim().toLowerCase(), claims: payload };
}
