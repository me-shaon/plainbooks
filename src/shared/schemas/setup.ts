// First run and Owner recovery validation, shared by the API and the setup screens.
import { z } from "zod";

/** A `SETUP_TOKEN` shorter than this turns setup and recovery off. */
export const SETUP_TOKEN_MIN_LENGTH = 32;

/** Password length on setup, recovery, invite accept, and reset. The maximum bounds hash CPU. */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use ${PASSWORD_MAX_LENGTH} characters or fewer`);

const setupToken = z
  .string()
  .trim()
  .min(1, "Enter the setup token")
  .max(512, "This token is too long");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254, "This email is too long"));

/** POST /api/setup/owner */
export const setupOwnerInput = z.object({
  token: setupToken,
  name: z.string().trim().min(1, "Enter your name").max(120, "Use 120 characters or fewer"),
  email,
  password: newPassword,
});
export type SetupOwnerInput = z.input<typeof setupOwnerInput>;

/** POST /api/setup/recover */
export const recoverOwnerInput = z.object({
  token: setupToken,
  email,
  password: newPassword,
});
export type RecoverOwnerInput = z.input<typeof recoverOwnerInput>;

/** GET /api/setup/status */
export interface SetupStatus {
  /** True until the first Owner exists. Every page shows the setup screen until then. */
  needsSetup: boolean;
  /** True when a `SETUP_TOKEN` of at least 32 characters is set. */
  setupEnabled: boolean;
  /** True when both Google secrets are set. */
  googleEnabled: boolean;
  /** True when a primary email provider is saved and usable. */
  emailConfigured: boolean;
}
