import { createFileRoute, redirect } from "@tanstack/react-router";
import { ForgotPasswordPage } from "../features/auth/password-reset-forms";
import { setupStatusQuery } from "../lib/setup";

// Self-service reset needs a saved email provider. Without one, the page goes to sign-in.
export const Route = createFileRoute("/forgot-password")({
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.ensureQueryData(setupStatusQuery).catch(() => null);
    if (!status?.emailConfigured) throw redirect({ to: "/sign-in" });
  },
  component: ForgotPasswordPage,
});
