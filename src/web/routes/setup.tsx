import { createFileRoute } from "@tanstack/react-router";
import { SetupPage } from "../features/auth/setup-form";

// The root route sends every page here while no Owner exists, and sends this page to the
// app after setup.
export const Route = createFileRoute("/setup")({
  component: SetupPage,
});
