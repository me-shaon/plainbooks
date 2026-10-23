import { Plus, Trash2 } from "lucide-react";
import { MAX_CONTACTS } from "../../../shared/schemas/client";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { TextField } from "../../components/ui/text-field";

export interface ContactDraft {
  /** Stable React key. Not sent to the API. */
  key: string;
  name: string;
  email: string;
  isPrimary: boolean;
  isBilling: boolean;
}

export function newContact(isPrimary = false): ContactDraft {
  return { key: crypto.randomUUID(), name: "", email: "", isPrimary, isBilling: isPrimary };
}

export interface ContactsEditorProps {
  contacts: ContactDraft[];
  onChange: (contacts: ContactDraft[]) => void;
  /** Field errors keyed like "contacts.0.email", plus "contacts" for list errors. */
  errors: Record<string, string>;
}

/**
 * Edits a client's contacts. One contact can be primary. Billing contacts get documents
 * and reminders together with the primary contact.
 */
export function ContactsEditor({ contacts, onChange, errors }: ContactsEditorProps) {
  const update = (index: number, patch: Partial<ContactDraft>) => {
    onChange(
      contacts.map((contact, i) => {
        if (i === index) return { ...contact, ...patch };
        // Primary is exclusive: choosing one clears the others.
        if (patch.isPrimary) return { ...contact, isPrimary: false };
        return contact;
      }),
    );
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 p-0 text-[13px] font-medium text-ink">Contacts</legend>
      {contacts.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">
          Add at least one contact to email documents to this client.
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {contacts.map((contact, index) => (
          <li
            key={contact.key}
            className="flex flex-col gap-3 rounded-button border border-border p-3 sm:p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Name"
                value={contact.name}
                onChange={(name) => update(index, { name })}
                autoComplete="off"
              />
              <TextField
                label="Email"
                type="email"
                isRequired
                value={contact.email}
                onChange={(email) => update(index, { email })}
                isInvalid={Boolean(errors[`contacts.${index}.email`])}
                errorMessage={errors[`contacts.${index}.email`]}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <Checkbox
                isSelected={contact.isPrimary}
                onChange={(isPrimary) => update(index, { isPrimary })}
              >
                Primary contact
              </Checkbox>
              <Checkbox
                isSelected={contact.isBilling}
                onChange={(isBilling) => update(index, { isBilling })}
              >
                Gets invoices
              </Checkbox>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
                onPress={() => onChange(contacts.filter((_, i) => i !== index))}
                aria-label={`Remove contact ${contact.email || index + 1}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {errors.contacts ? (
        <p role="alert" className="m-0 text-xs font-medium text-danger">
          {errors.contacts}
        </p>
      ) : null}
      {contacts.length < MAX_CONTACTS ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onPress={() => onChange([...contacts, newContact(contacts.length === 0)])}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add contact
        </Button>
      ) : null}
    </fieldset>
  );
}
