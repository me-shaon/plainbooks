import type { UserRole } from "../shared/domain";
import type { Db } from "./db/client";

/**
 * Worker bindings. `Env` comes from `pnpm cf-typegen`. Values that only exist in
 * `.dev.vars` (local development) are added here as optional.
 */
export type Bindings = Env & {
  /** Local development only. Used by the auth dev bypass. */
  DEV_USER_EMAIL?: string;
  /** Secret. The Resend API key ("re_..."). */
  RESEND_API_KEY?: string;
  /** Secret. The Resend webhook signing secret ("whsec_..."). */
  RESEND_WEBHOOK_SECRET?: string;
  /** Secret. The Zero Trust team domain: "team.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** Secret. The Application Audience (AUD) tag of the Access application. */
  ACCESS_AUD?: string;
  /** Secret. The email of the first Owner. */
  OWNER_EMAIL?: string;
  /** Secret. The public origin of the app: "https://invoices.example.com". */
  APP_URL?: string;
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
