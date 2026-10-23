import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceSettingsPage } from "../../features/settings/workspace-settings";

export const Route = createFileRoute("/settings/")({
  component: WorkspaceSettingsPage,
});
