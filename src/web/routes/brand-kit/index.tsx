import { createFileRoute } from "@tanstack/react-router";
import { Palette } from "lucide-react";
import { PlaceholderPage } from "../../components/placeholder-page";

export const Route = createFileRoute("/brand-kit/")({
  component: () => (
    <PlaceholderPage title="Brand kit" subtitle="Your logo, colors, and fonts." icon={Palette} />
  ),
});
