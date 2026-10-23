import { createFileRoute } from "@tanstack/react-router";
import { ClientDetailPage } from "../../features/clients/client-detail-page";

export const Route = createFileRoute("/clients/$clientId")({
  component: function ClientRoute() {
    const { clientId } = Route.useParams();
    return <ClientDetailPage key={clientId} clientId={clientId} />;
  },
});
