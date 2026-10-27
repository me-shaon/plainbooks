import { createFileRoute } from "@tanstack/react-router";
import { EmailSettingsPage } from "../../features/settings/email-page";

export const Route = createFileRoute("/settings/email")({
  component: EmailSettingsPage,
});
