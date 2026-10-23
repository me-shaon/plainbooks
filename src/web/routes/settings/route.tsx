import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SettingsLayout } from "../../features/settings/settings-layout";

export const Route = createFileRoute("/settings")({
  component: () => (
    <SettingsLayout>
      <Outlet />
    </SettingsLayout>
  ),
});
