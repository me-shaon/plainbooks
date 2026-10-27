import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "../features/auth/sign-in-form";

interface SignInSearch {
  /** The page to open after sign-in. The page accepts only a same-origin relative path. */
  next?: string;
  /** The error code of a refused Google sign-in. */
  error?: string;
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    next: typeof search.next === "string" && search.next ? search.next : undefined,
    error: typeof search.error === "string" && search.error ? search.error : undefined,
  }),
  component: function SignInRoute() {
    const { next, error } = Route.useSearch();
    return <SignInPage next={next} error={error} />;
  },
});
