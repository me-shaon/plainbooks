import { queryOptions } from "@tanstack/react-query";
import { INVITE_PAGE_PATH } from "../../shared/domain";
import type { SetupStatus } from "../../shared/schemas/setup";
import { ApiError, api } from "./api";
import { AUTH_PATHS, tooManyAttempts } from "./auth";
import { queryKeys } from "./query-keys";

/** The Owner recovery page. The sign-in page links to it as "Locked out?". */
export const RECOVER_PATH = "/recover";

/** The invite and reset link page. The token follows in the path. */
export const INVITE_PATH_PREFIX = `${INVITE_PAGE_PATH}/`;

/**
 * Pages that render without the app shell and need no session. An entry that ends with
 * "/" covers every page under it (see `isPublicPath`).
 */
export const PUBLIC_PATHS: readonly string[] = [
  "/setup",
  RECOVER_PATH,
  INVITE_PATH_PREFIX,
  ...AUTH_PATHS,
];

/** GET /api/setup/status. The root route reads it before every page. */
export const setupStatusQuery = queryOptions({
  queryKey: queryKeys.setupStatus,
  queryFn: () => api<SetupStatus>("/setup/status"),
  staleTime: 60 * 1000,
});

/**
 * The form message for a failed setup or recovery call. Field problems (400) return null,
 * because the form shows them next to each field.
 */
export function setupErrorMessage(err: unknown): string | null {
  if (!(err instanceof ApiError)) return "Something went wrong. Try again.";
  switch (err.code) {
    case "invalid_setup_token":
      return "The setup token is not right. Copy the SETUP_TOKEN secret again.";
    case "recovery_refused":
      return "The setup token or the Owner email is not right. A token that was used once does not work again.";
    case "rate_limited":
      return tooManyAttempts(err);
    case "setup_closed":
      return "Setup is closed. An Owner already exists.";
    case "setup_disabled":
      return "Setup is turned off. Set a SETUP_TOKEN secret of at least 32 characters, then reload this page.";
    case "invalid_request":
      return null;
    default:
      return err.message || "Something went wrong. Try again.";
  }
}
