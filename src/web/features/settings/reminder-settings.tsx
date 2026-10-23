import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form } from "react-aria-components";
import type { ReminderMode, SendMode } from "../../../shared/domain";
import { REMINDER_MODES, SEND_MODES } from "../../../shared/domain";
import { REMINDER_MODE_LABELS, SEND_MODE_LABELS } from "../../../shared/schemas/client";
import {
  MAX_REMINDER_STEPS,
  reminderStepLabel,
  type WorkspaceSettings,
  workspaceSettingsInput,
} from "../../../shared/schemas/settings";
import { Button } from "../../components/ui/button";
import { ListBoxItem } from "../../components/ui/list-box";
import { NumberField } from "../../components/ui/number-field";
import { Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useMe } from "../../lib/session";
import { useUpdateWorkspace, useWorkspaceSettings } from "./queries";
import { SaveBar } from "./settings-layout";

export function ReminderSettingsPage() {
  const settings = useWorkspaceSettings();
  const { isOwner } = useMe();
  if (settings.isPending) return <Skeleton className="h-96 w-full" />;
  if (settings.isError) return null;
  return (
    <ReminderSettingsForm
      key={JSON.stringify(settings.data)}
      settings={settings.data}
      readOnly={!isOwner}
    />
  );
}

interface StepDraft {
  key: string;
  offsetDays: number;
}

function ReminderSettingsForm({
  settings,
  readOnly,
}: {
  settings: WorkspaceSettings;
  readOnly: boolean;
}) {
  const [reminderMode, setReminderMode] = useState<ReminderMode>(settings.reminderMode);
  const [sendMode, setSendMode] = useState<SendMode>(settings.recurringSendMode);
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    settings.reminderSchedule.map((step) => ({ key: crypto.randomUUID(), ...step })),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateWorkspace();

  const save = async () => {
    const input = {
      reminderMode,
      recurringSendMode: sendMode,
      reminderSchedule: steps.map(({ offsetDays }) => ({ offsetDays })),
    };
    const result = validate(workspaceSettingsInput, input);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(input);
      toast({ title: "Reminder settings saved", tone: "success" });
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not save the settings");
    }
  };

  const addStep = () => {
    const last = steps.at(-1)?.offsetDays ?? 0;
    setSteps([...steps, { key: crypto.randomUUID(), offsetDays: last + 7 }]);
  };

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Section
        title="Automation"
        description="The workspace default. Clients and invoices can override it."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Reminders"
            isDisabled={readOnly}
            value={reminderMode}
            onChange={(key) => key && setReminderMode(key as ReminderMode)}
            description="Suggest lists due reminders on the dashboard. Auto-send emails them."
          >
            {REMINDER_MODES.map((mode) => (
              <ListBoxItem key={mode} id={mode}>
                {REMINDER_MODE_LABELS[mode]}
              </ListBoxItem>
            ))}
          </Select>
          <Select
            label="Recurring invoices"
            isDisabled={readOnly}
            value={sendMode}
            onChange={(key) => key && setSendMode(key as SendMode)}
            description="Create a draft to review, or send each invoice when it is due."
          >
            {SEND_MODES.map((mode) => (
              <ListBoxItem key={mode} id={mode}>
                {SEND_MODE_LABELS[mode]}
              </ListBoxItem>
            ))}
          </Select>
        </div>
      </Section>

      <Section
        title="Reminder schedule"
        description={`Days from the due date. Use a negative number for days before. At most ${settings.overdueReminderCap} overdue reminders go to each invoice.`}
      >
        <div className="flex flex-col gap-3">
          {steps.length === 0 ? (
            <p className="m-0 text-[13px] text-muted-foreground">No reminder steps.</p>
          ) : null}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {steps.map((step, index) => (
              <li key={step.key} className="flex items-end gap-3">
                <NumberField
                  label={`Step ${index + 1}`}
                  className="w-32"
                  isDisabled={readOnly}
                  step={1}
                  minValue={-60}
                  maxValue={365}
                  value={step.offsetDays}
                  onChange={(offsetDays) =>
                    setSteps(steps.map((s) => (s.key === step.key ? { ...s, offsetDays } : s)))
                  }
                  {...fieldError(errors, `reminderSchedule.${index}.offsetDays`)}
                />
                <span className="min-h-11 flex-1 content-center text-sm text-muted-foreground md:min-h-10">
                  {Number.isFinite(step.offsetDays) ? reminderStepLabel(step.offsetDays) : ""}
                </span>
                {readOnly ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove step ${index + 1}`}
                    onPress={() => setSteps(steps.filter((s) => s.key !== step.key))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {errors.reminderSchedule ? (
            <p role="alert" className="m-0 text-xs font-medium text-danger">
              {errors.reminderSchedule}
            </p>
          ) : null}
          {readOnly || steps.length >= MAX_REMINDER_STEPS ? null : (
            <Button variant="secondary" size="sm" className="self-start" onPress={addStep}>
              <Plus className="size-4" aria-hidden="true" />
              Add step
            </Button>
          )}
        </div>
      </Section>

      {readOnly ? null : (
        <SaveBar>
          <Button type="submit" isPending={update.isPending}>
            Save reminder settings
          </Button>
        </SaveBar>
      )}
    </Form>
  );
}
