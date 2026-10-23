import { createFileRoute } from "@tanstack/react-router";
import { SchedulePage } from "../../features/recurring/schedule-page";

export const Route = createFileRoute("/recurring/$scheduleId")({
  component: function ScheduleRoute() {
    const { scheduleId } = Route.useParams();
    return <SchedulePage key={scheduleId} scheduleId={scheduleId} />;
  },
});
