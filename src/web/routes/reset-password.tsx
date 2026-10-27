import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "../features/auth/password-reset-forms";

interface ResetPasswordSearch {
  /** The token from the reset email. */
  token?: string;
  /** Set when a reset link redirect reports a bad token. */
  error?: string;
}

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): ResetPasswordSearch => ({
    // The default search parser reads an all-digit value as a number.
    token:
      (typeof search.token === "string" && search.token) || typeof search.token === "number"
        ? String(search.token)
        : undefined,
    error: typeof search.error === "string" && search.error ? search.error : undefined,
  }),
  component: function ResetPasswordRoute() {
    const { token, error } = Route.useSearch();
    return <ResetPasswordPage token={token} error={error} />;
  },
});
