import { createFileRoute } from "@tanstack/react-router";
import { ReminderSettingsPage } from "../../features/settings/reminder-settings";

export const Route = createFileRoute("/settings/reminders")({
  component: ReminderSettingsPage,
});
