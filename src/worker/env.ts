import type { UserRole } from "../shared/domain";
import type { Db } from "./db/client";

/**
 * Worker bindings. `Env` comes from `pnpm cf-typegen`. Values that only exist in
 * `.dev.vars` (local development) are added here as optional.
 */
export type Bindings = Env & {
  /** Secret. The public origin of the app: "https://invoices.example.com". */
  APP_URL?: string;
  /**
   * Secret. At least 32 random bytes as base64 text. It encrypts the email provider keys
   * in D1. A new value means the Owner must enter the provider keys again.
   */
  ENCRYPTION_KEY?: string;
  /**
   * Secret. At least 32 random characters. better-auth signs session cookies and tokens
   * with it. A new value signs everyone out.
   */
  AUTH_SECRET?: string;
  /**
   * Secret. At least 32 random characters. It claims a fresh deploy on /setup and
   * recovers a locked-out Owner on /recover. Each value works once. A shorter or missing
   * value turns both routes off.
   */
  SETUP_TOKEN?: string;
  /** Secret. The Google OAuth client ID. Google sign-in shows only when both are set. */
  GOOGLE_CLIENT_ID?: string;
  /** Secret. The Google OAuth client secret. */
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * PBKDF2 iterations for new password hashes. The default is 100000, the Workers maximum.
   * A sign-in rehashes a password that uses another count.
   */
  PBKDF2_ITERATIONS?: string;
  /** Local development only. "1" swaps Resend, Frankfurter, and Browser Run for fakes. */
  FAKE_EXTERNALS?: string;
};

/** The signed-in team member, set by the auth middleware. */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

export interface AppVariables {
  user: AuthUser;
  db: Db;
}

/** Hono environment for every app, sub-app, route, and middleware. */
export type AppEnv = { Bindings: Bindings; Variables: AppVariables };
