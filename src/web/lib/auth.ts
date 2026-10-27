import type { AnyRouter } from "@tanstack/react-router";
import { ApiError } from "./api";

export const SIGN_IN_PATH = "/sign-in";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
/** The page that the reset email links to. The Worker builds the link with the same path. */
export const RESET_PASSWORD_PATH = "/reset-password";

/** The sign-in and password pages. They need no session. */
export const AUTH_PATHS: readonly string[] = [
  SIGN_IN_PATH,
  FORGOT_PASSWORD_PATH,
  RESET_PASSWORD_PATH,
];

// A base that no real page uses. A path that resolves to another origin is not same-origin.
const PATH_BASE = "https://plainbooks.invalid";

/**
 * The page to open after sign-in. Only a same-origin relative path is accepted, so a link
 * cannot send the user to another site. Anything else, and the auth pages, give "/".
 *
 * ```ts
 * safeNext("/invoices?status=overdue"); // "/invoices?status=overdue"
 * safeNext("https://evil.example"); // "/"
 * safeNext("//evil.example"); // "/"
 * ```
 */
export function safeNext(next: unknown): string {
  if (typeof next !== "string" || !next.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(next, PATH_BASE);
  } catch {
    return "/";
  }
  // The URL parser reads "//host", "/\host", and paths with tabs as another origin.
  if (url.origin !== PATH_BASE) return "/";
  if (AUTH_PATHS.includes(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * True when the path is one of the public paths. An entry that ends with "/" matches
 * every path under it, for example "/invite/" matches "/invite/<token>".
 */
export function isPublicPath(pathname: string, publicPaths: readonly string[]): boolean {
  return publicPaths.some((path) =>
    path.endsWith("/") ? pathname.startsWith(path) : pathname === path,
  );
}

/**
 * Sends the user to sign-in and keeps the current page in `next`. main.tsx calls it when an
 * API call gets the session 401. It does nothing on a page that needs no session.
 */
export function redirectToSignIn(router: AnyRouter, publicPaths: readonly string[]): void {
  const { pathname, href } = router.state.location;
  if (isPublicPath(pathname, publicPaths)) return;
  void router.navigate({ to: SIGN_IN_PATH, search: { next: safeNext(href) }, replace: true });
}

/** "45 seconds" or "12 minutes". */
export function formatRetry(seconds: number): string {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** The message for a failed rate-limited auth call (429), with the retry time when known. */
export function tooManyAttempts(err: ApiError): string {
  return err.retryAfter
    ? `Too many attempts. Try again in ${formatRetry(err.retryAfter)}.`
    : "Too many attempts. Try again later.";
}

export const WRONG_CREDENTIALS = "The email or password is not right.";
const CONNECTION = "The server could not be reached. Check your connection.";
const UNKNOWN = "Something went wrong. Try again.";

/**
 * The form message for a failed email and password sign-in. Every refusal gives the same
 * message, so the page does not tell which emails are members.
 */
export function signInErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return UNKNOWN;
  if (err.status === 429) return tooManyAttempts(err);
  if (err.status === 0) return CONNECTION;
  if (err.status >= 400 && err.status < 500) return WRONG_CREDENTIALS;
  return UNKNOWN;
}

/** The form message for a failed reset request or reset. */
export function passwordErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return UNKNOWN;
  if (err.status === 429) return tooManyAttempts(err);
  if (err.status === 0) return CONNECTION;
  return UNKNOWN;
}

/**
 * Messages for the `error` code that a refused Google sign-in brings back to the sign-in
 * page. better-auth sends `signup_disabled` for a Google email with no user and no invite.
 */
export const GOOGLE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  signup_disabled: "This Google account has no invite. Ask your Owner.",
  invite_expired: "Your invite was used or has expired. Ask your Owner for a new link.",
  email_not_verified: "Google has not verified this email address. Use another Google account.",
  account_not_linked:
    "This Google account is not linked to your sign-in yet. Sign in with your password.",
  access_denied: "Google sign-in was cancelled.",
};

/** The message for a Google error code. An unknown code gets a general message. */
export function googleErrorMessage(code: string): string {
  return GOOGLE_ERROR_MESSAGES[code] ?? "Google sign-in did not work. Try again.";
}
