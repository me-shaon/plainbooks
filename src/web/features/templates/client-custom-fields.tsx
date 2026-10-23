import { useState } from "react";
import { Form } from "react-aria-components";
import { Button } from "../../components/ui/button";
import { Section } from "../../components/ui/section";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { useCustomFields, useCustomFieldValues, useSaveCustomFieldValues } from "./queries";

/** Values of client-level custom fields. Hidden when there are no client fields. */
export function ClientCustomFields({ clientId }: { clientId: string }) {
  const fields = useCustomFields();
  const values = useCustomFieldValues("client", clientId);
  const clientFields = (fields.data ?? []).filter((f) => f.scope === "client");
  if (clientFields.length === 0 || !values.data) return null;
  return (
    <ClientCustomFieldsForm
      key={JSON.stringify(values.data)}
      clientId={clientId}
      fields={clientFields}
      initial={values.data}
    />
  );
}

function ClientCustomFieldsForm({
  clientId,
  fields,
  initial,
}: {
  clientId: string;
  fields: { id: string; label: string; type: string }[];
  initial: { fieldId: string; value: string }[];
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.map((v) => [v.fieldId, v.value])),
  );
  const save = useSaveCustomFieldValues("client", clientId);
  const dirty = fields.some(
    (f) => (draft[f.id] ?? "") !== (initial.find((v) => v.fieldId === f.id)?.value ?? ""),
  );
  return (
    <Section title="Custom fields" description="Prints on new documents for this client.">
      <Form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            fields.map((f) => ({ fieldId: f.id, value: (draft[f.id] ?? "").trim() })),
            { onSuccess: () => toast({ title: "Custom fields saved", tone: "success" }) },
          );
        }}
      >
        {fields.map((field) => (
          <TextField
            key={field.id}
            label={field.label}
            type={field.type === "date" ? "date" : "text"}
            inputMode={field.type === "number" ? "decimal" : undefined}
            value={draft[field.id] ?? ""}
            onChange={(value) => setDraft({ ...draft, [field.id]: value })}
          />
        ))}
        <div className="flex justify-end">
          <Button type="submit" size="sm" isDisabled={!dirty} isPending={save.isPending}>
            Save
          </Button>
        </div>
      </Form>
    </Section>
  );
}
