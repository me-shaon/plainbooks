import { createFileRoute } from "@tanstack/react-router";
import { RecoverPage } from "../features/auth/recover-form";

export const Route = createFileRoute("/recover")({
  component: RecoverPage,
});
