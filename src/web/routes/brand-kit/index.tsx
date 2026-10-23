import { createFileRoute } from "@tanstack/react-router";
import { BrandKitPage } from "../../features/settings/brand-kit-page";

export const Route = createFileRoute("/brand-kit/")({
  component: BrandKitPage,
});
