import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "../../features/dashboard/notifications-page";

export const Route = createFileRoute("/notifications/")({
  component: NotificationsPage,
});
