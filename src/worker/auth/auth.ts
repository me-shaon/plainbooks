import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { RESET_PASSWORD_PATH } from "../../shared/domain";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/schemas/setup";
import { createDb, schema } from "../db/client";
import { passwordResetEmail } from "../email/templates";
import type { Bindings } from "../env";
import { appOrigin, deliverEmail } from "../services/email";
import { activateInvitedUser, hasOpenInvite, userStatus } from "../services/invites";
import { loadWorkspace } from "../services/settings";
import { allowedOrigins } from "./middleware";
import { createPasswordHasher, needsRehash, resolveIterations } from "./pbkdf2";
import {
  clientIp,
  consumeRateLimits,
  RATE_RULES,
  type RateCheck,
  rateKeys,
  retryAfterSeconds,
} from "./rate-limit";

// better-auth. The Worker builds one instance per request, because the instance holds the
// request's D1 binding and the origins that the request may use.

export const AUTH_BASE_PATH = "/api/auth";
export const AUTH_COOKIE_PREFIX = "plainbooks";
/** Password length on setup, recovery, invite accept, and reset (from the shared schema). */
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };
export const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
export const RESET_TOKEN_EXPIRES_IN_SECONDS = 60 * 60;

/**
 * The reset link in the email. It opens the web page directly, so the token reaches the
 * page in the query string and only the page's POST uses it.
 */
export function resetPasswordUrl(origin: string, token: string): string {
  return `${origin}${RESET_PASSWORD_PATH}?token=${encodeURIComponent(token)}`;
}

/** True when both Google secrets are set. Google sign-in is off otherwise. */
export function googleEnabled(env: Bindings): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

/** The request body fields that the rate-limit hook reads. */
interface CredentialsBody {
  email?: unknown;
  password?: unknown;
}

/** The counters for one better-auth endpoint. Other endpoints have none. */
async function rateChecksFor(
  path: string,
  request: Request,
  body: CredentialsBody | undefined,
): Promise<RateCheck[]> {
  const ip = clientIp(request);
  const email = typeof body?.email === "string" ? body.email : null;
  switch (path) {
    case "/sign-in/email":
      return [
        { key: rateKeys.ip("sign-in", ip), rule: RATE_RULES.signInIp },
        ...(email
          ? [{ key: await rateKeys.email("sign-in", email), rule: RATE_RULES.signInEmail }]
          : []),
      ];
    case "/request-password-reset":
      return [
        { key: rateKeys.ip("password-reset", ip), rule: RATE_RULES.passwordResetIp },
        ...(email
          ? [
              {
                key: await rateKeys.email("password-reset", email),
                rule: RATE_RULES.passwordResetEmail,
              },
            ]
          : []),
      ];
    case "/reset-password":
      return [{ key: rateKeys.ip("password-reset", ip), rule: RATE_RULES.passwordResetIp }];
    default:
      return [];
  }
}

/**
 * Sends the self-service reset link through the mailer. Errors are logged, not thrown, so
 * the response is the same whether or not the email exists or email is configured.
 */
async function sendResetPassword(env: Bindings, to: string, url: string): Promise<void> {
  try {
    const db = createDb(env.DB);
    const ws = await loadWorkspace(db);
    const content = passwordResetEmail({
      workspace: ws.businessName || ws.name,
      accent: ws.accentColor,
      url,
      expiresInMinutes: RESET_TOKEN_EXPIRES_IN_SECONDS / 60,
    });
    await deliverEmail(
      env,
      db,
      {
        to: [to],
        subject: content.subject,
        html: content.html,
        text: content.text,
        kind: "notification",
      },
      { now: Date.now(), workspace: ws },
    );
  } catch (err) {
    console.error("password reset email failed", err instanceof Error ? err.message : err);
  }
}

/** Error codes that a refused Google sign-in brings back to the sign-in page. */
export const GOOGLE_REFUSAL = {
  /** The Google account says that its email address is not verified. */
  emailNotVerified: "email_not_verified",
  /** The user is invited, but the invite was used, removed, or has expired. */
  inviteExpired: "invite_expired",
} as const;

/** The claims of a JWT, without a signature check. Returns null for a malformed token. */
function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Refuses a Google account whose ID token does not say `email_verified: true`. better-auth
 * trusts Google for account linking, so this check stops a login with an unverified
 * address from linking to the member with that address. The ID token comes from Google's
 * token endpoint over TLS, which is why the claims are read without a signature check.
 */
function assertGoogleEmailVerified(account: { providerId?: unknown; idToken?: unknown }): void {
  if (account.providerId !== "google" || typeof account.idToken !== "string") return;
  const verified = jwtClaims(account.idToken)?.email_verified;
  if (verified === true || verified === "true") return;
  throw new APIError("FORBIDDEN", {
    code: GOOGLE_REFUSAL.emailNotVerified,
    message: "Google has not verified this email address.",
  });
}

const inviteExpired = () =>
  new APIError("FORBIDDEN", {
    code: GOOGLE_REFUSAL.inviteExpired,
    message: "The invite was used or has expired. Ask your Owner for a new link.",
  });

/** Builds the better-auth instance for one request. */
export function createAuth(env: Bindings, request: Request) {
  const iterations = resolveIterations(env.PBKDF2_ITERATIONS);
  const hasher = createPasswordHasher(iterations);
  const secret = env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  const db = createDb(env.DB);
  const origin = appOrigin(env) || new URL(request.url).origin;
  const google =
    googleEnabled(env) && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID.trim(),
            clientSecret: env.GOOGLE_CLIENT_SECRET.trim(),
            // Only members and invited people sign in. The session hook checks the invite.
            disableSignUp: true,
          },
        }
      : {};

  return betterAuth({
    appName: "PlainBooks",
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    secret,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        users: schema.users,
        sessions: schema.sessions,
        accounts: schema.accounts,
        verifications: schema.verifications,
      },
    }),
    // The app's `users` table is the better-auth user model. `role` and `status` are app
    // columns. Members cannot set them through better-auth endpoints.
    user: {
      modelName: "users",
      additionalFields: {
        role: { type: "string", required: false, input: false },
        status: { type: "string", required: false, input: false },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: SESSION_EXPIRES_IN_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // Off, so a revoked session stops working on the next request.
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "accounts",
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    verification: { modelName: "verifications" },
    // The same origins as the cross-site write guard.
    trustedOrigins: [...allowedOrigins(env, request.url)],
    emailAndPassword: {
      enabled: true,
      // Setup creates the first Owner and invites add members. Nobody signs up.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      password: hasher,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: RESET_TOKEN_EXPIRES_IN_SECONDS,
      // better-auth's own link goes to its GET endpoint, which redirects to a page. The app
      // links to the page directly.
      sendResetPassword: ({ user, token }) =>
        sendResetPassword(env, user.email, resetPasswordUrl(origin, token)),
    },
    socialProviders: google,
    // The AuthRateLimiter Durable Object limits attempts (hooks.before). The built-in
    // limiter keeps its counts in isolate memory, so it is off.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: {
        // The app uses UUID text IDs for every table.
        generateId: "uuid",
        // The committed migration defines the schema. Skip the check on every request.
        validateSchema: false,
      },
    },
    databaseHooks: {
      session: {
        create: {
          // An `invited` user signs in only with an unused, unexpired invite, which this
          // step uses up while it marks the user active. Active users pass with no check.
          // Invite accept and setup mark the user active before they create the session.
          before: async (session) => {
            const status = await userStatus(env.DB, session.userId);
            if (status !== "invited") return;
            if (!(await activateInvitedUser(env.DB, session.userId, Date.now()))) {
              throw inviteExpired();
            }
          },
        },
      },
      account: {
        create: {
          before: async (account) => {
            assertGoogleEmailVerified(account);
            // Do not link a Google account to an invited user whose invite is closed.
            if (account.providerId !== "google") return;
            const status = await userStatus(env.DB, account.userId);
            if (
              status === "invited" &&
              !(await hasOpenInvite(env.DB, account.userId, Date.now()))
            ) {
              throw inviteExpired();
            }
          },
        },
        update: {
          // A sign-in with a linked Google account updates its tokens here.
          before: async (account) => {
            assertGoogleEmailVerified(account);
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.request) return;
        const checks = await rateChecksFor(ctx.path, ctx.request, ctx.body as CredentialsBody);
        if (checks.length === 0) return;
        // A failed counter call allows the attempt and logs an error, so a Durable Object
        // outage does not lock everyone out.
        const result = await consumeRateLimits(env, checks, { onError: "open" });
        if (!result.allowed) {
          const seconds = retryAfterSeconds(result);
          throw new APIError(
            "TOO_MANY_REQUESTS",
            {
              message: "Too many attempts. Try again later.",
              code: "RATE_LIMITED",
              retryAfter: seconds,
            },
            { "Retry-After": String(seconds) },
          );
        }
      }),
      // Rehash a password that uses another iteration count, at the sign-in that proves it.
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const userId = ctx.context.newSession?.user.id;
        const password = (ctx.body as CredentialsBody | undefined)?.password;
        if (!userId || typeof password !== "string") return;
        const account = await ctx.context.internalAdapter.findCredentialAccount(userId);
        if (account?.password && needsRehash(account.password, iterations)) {
          await ctx.context.internalAdapter.updatePassword(userId, await hasher.hash(password));
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
