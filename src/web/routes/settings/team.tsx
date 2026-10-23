import { createFileRoute } from "@tanstack/react-router";
import { TeamPage } from "../../features/settings/team-page";

export const Route = createFileRoute("/settings/team")({
  component: TeamPage,
});
