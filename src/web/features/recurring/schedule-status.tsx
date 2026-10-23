import type { RecurringStatus } from "../../../shared/domain";
import { RECURRING_STATUS_LABELS } from "../../../shared/schemas/recurring";
import { Pill } from "../../components/ui/pill";
import type { Status } from "../../components/ui/status";

// Schedule statuses reuse the document pill colors.
const PILL: Record<RecurringStatus, Status> = { active: "sent", paused: "draft", ended: "void" };

export function ScheduleStatusPill({ status }: { status: RecurringStatus }) {
  return <Pill status={PILL[status]}>{RECURRING_STATUS_LABELS[status]}</Pill>;
}
