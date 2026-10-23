import {
  RECURRING_FREQUENCIES,
  type RecurringFrequency,
  SEND_MODE_SETTINGS,
  type SendModeSetting,
} from "../../../shared/domain";
import { OWNER_ONLY_MESSAGE, SEND_MODE_LABELS } from "../../../shared/schemas/client";
import { FREQUENCY_LABELS } from "../../../shared/schemas/recurring";
import { IsoDatePicker } from "../../components/ui/date-picker";
import { ListBoxItem } from "../../components/ui/list-box";
import { Select } from "../../components/ui/select";
import { type FieldErrors, fieldError } from "../../lib/form";

export interface TimingValues {
  frequency: RecurringFrequency;
  startDate: string | null;
  endDate: string | null;
  sendMode: SendModeSetting;
}

/**
 * Frequency, start date, end date, and send mode. A Member cannot choose auto-send, and
 * cannot change a schedule that is already on auto-send (R55).
 */
export function TimingFields({
  values,
  onChange,
  isOwner,
  initialSendMode,
  errors,
}: {
  values: TimingValues;
  onChange: (values: TimingValues) => void;
  isOwner: boolean;
  initialSendMode: SendModeSetting;
  errors: FieldErrors;
}) {
  const set = <K extends keyof TimingValues>(key: K, value: TimingValues[K]) =>
    onChange({ ...values, [key]: value });
  const locked = !isOwner && initialSendMode === "auto_send";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select
        label="Frequency"
        value={values.frequency}
        onChange={(key) => key && set("frequency", key as RecurringFrequency)}
        {...fieldError(errors, "frequency")}
      >
        {RECURRING_FREQUENCIES.map((f) => (
          <ListBoxItem key={f} id={f}>
            {FREQUENCY_LABELS[f]}
          </ListBoxItem>
        ))}
      </Select>
      <Select
        label="Send mode"
        value={values.sendMode}
        isDisabled={locked}
        disabledKeys={isOwner ? undefined : ["auto_send"]}
        onChange={(key) => key && set("sendMode", key as SendModeSetting)}
        description={
          isOwner ? undefined : locked ? OWNER_ONLY_MESSAGE : "Only an Owner can turn on auto-send"
        }
        {...fieldError(errors, "sendMode")}
      >
        {SEND_MODE_SETTINGS.map((mode) => (
          <ListBoxItem key={mode} id={mode}>
            {SEND_MODE_LABELS[mode]}
          </ListBoxItem>
        ))}
      </Select>
      <IsoDatePicker
        label="First issue date"
        value={values.startDate}
        onChange={(v) => set("startDate", v)}
        description="Days 29 to 31 fall back to the last day of shorter months."
        {...fieldError(errors, "startDate")}
      />
      <IsoDatePicker
        label="End date (optional)"
        value={values.endDate}
        onChange={(v) => set("endDate", v)}
        description="No invoices are created after this date."
        {...fieldError(errors, "endDate")}
      />
    </div>
  );
}
