import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/clients/")({
  component: () => (
    <PlaceholderPage title="Clients" subtitle="The people and companies you bill." icon={Users} />
  ),
});
