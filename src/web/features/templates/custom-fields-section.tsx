import { Ellipsis, ListPlus, Plus } from "lucide-react";
import { useState } from "react";
import { Form } from "react-aria-components";
import {
  CUSTOM_FIELD_SCOPES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldScope,
  type CustomFieldType,
  TEMPLATE_SECTIONS,
  type TemplateSection,
} from "../../../shared/domain";
import {
  CUSTOM_FIELD_SCOPE_LABELS,
  CUSTOM_FIELD_TYPE_LABELS,
  type CustomFieldDef,
  customFieldCreateInput,
  TEMPLATE_SECTION_LABELS,
} from "../../../shared/schemas/template";
import { Button } from "../../components/ui/button";
import { Dialog, Modal } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { ListBoxItem } from "../../components/ui/list-box";
import { Menu, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { StackedList, StackedRow } from "../../components/ui/stacked-list";
import { Switch } from "../../components/ui/switch";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "../../components/ui/table";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useMe } from "../../lib/session";
import {
  useArchiveCustomField,
  useCustomFields,
  useCustomFieldValues,
  useSaveCustomField,
  useSaveCustomFieldValues,
} from "./queries";

function fieldMeta(field: CustomFieldDef): string {
  return `${CUSTOM_FIELD_TYPE_LABELS[field.type]} · ${CUSTOM_FIELD_SCOPE_LABELS[field.scope]} · ${TEMPLATE_SECTION_LABELS[field.section]}`;
}

/** Custom field definitions. Owners add and edit them. Members can view them. */
export function CustomFieldsSection() {
  const { isOwner } = useMe();
  const [showArchived, setShowArchived] = useState(false);
  const fields = useCustomFields({ includeArchived: showArchived });
  const workspaceValues = useCustomFieldValues("workspace", "workspace");
  const [editing, setEditing] = useState<CustomFieldDef | "new" | null>(null);
  const archive = useArchiveCustomField();
  const items = fields.data ?? [];
  const workspaceValueOf = (id: string) =>
    workspaceValues.data?.find((v) => v.fieldId === id)?.value;

  const actions = (field: CustomFieldDef) =>
    isOwner ? (
      <MenuTrigger>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${field.label}`}>
          <Ellipsis className="size-4" aria-hidden="true" />
        </Button>
        <Menu>
          <MenuItem onAction={() => setEditing(field)}>Edit</MenuItem>
          {field.archivedAt === null ? (
            <MenuItem
              variant="danger"
              onAction={() =>
                archive.mutate(
                  { id: field.id, archive: true },
                  { onSuccess: () => toast({ title: "Custom field archived", tone: "success" }) },
                )
              }
            >
              Archive
            </MenuItem>
          ) : (
            <MenuItem onAction={() => archive.mutate({ id: field.id, archive: false })}>
              Restore
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
    ) : null;

  return (
    <Section
      title="Custom fields"
      description="Extra details such as a PO number. Each field prints in the section you choose. Sent documents keep their values."
      flush
      actions={
        <>
          <Switch isSelected={showArchived} onChange={setShowArchived}>
            Show archived
          </Switch>
          {isOwner ? (
            <Button size="sm" onPress={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden="true" />
              New field
            </Button>
          ) : null}
        </>
      }
    >
      {fields.isPending ? (
        <div className="p-5">
          <Skeleton className="h-20 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ListPlus}
          className="rounded-none rounded-b-card"
          title="No custom fields yet"
          description="Add a field at workspace, client, or invoice level."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table aria-label="Custom fields" className="min-w-0">
              <TableHeader>
                <Column isRowHeader>Label</Column>
                <Column>Type</Column>
                <Column>Level</Column>
                <Column>Prints in</Column>
                <Column>Workspace value</Column>
                <Column width={64}>
                  <span className="sr-only">Actions</span>
                </Column>
              </TableHeader>
              <TableBody items={items}>
                {(field) => (
                  <Row id={field.id}>
                    <Cell>
                      <span className="font-medium">{field.label}</span>
                      {field.archivedAt ? (
                        <span className="ml-2 rounded-pill bg-segmented px-2 py-0.5 text-xs text-muted-foreground">
                          Archived
                        </span>
                      ) : null}
                    </Cell>
                    <Cell>{CUSTOM_FIELD_TYPE_LABELS[field.type]}</Cell>
                    <Cell>{CUSTOM_FIELD_SCOPE_LABELS[field.scope]}</Cell>
                    <Cell>{TEMPLATE_SECTION_LABELS[field.section]}</Cell>
                    <Cell>
                      <span className="text-muted-foreground">
                        {field.scope === "workspace"
                          ? (workspaceValueOf(field.id) ?? "Not set")
                          : ""}
                      </span>
                    </Cell>
                    <Cell align="end">{actions(field)}</Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </div>
          <StackedList label="Custom fields" className="rounded-none border-0 md:hidden">
            {items.map((field) => (
              <StackedRow
                key={field.id}
                title={field.archivedAt ? `${field.label} (archived)` : field.label}
                meta={fieldMeta(field)}
                actions={actions(field)}
              />
            ))}
          </StackedList>
        </>
      )}

      <CustomFieldDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        field={editing === "new" ? undefined : (editing ?? undefined)}
        workspaceValue={editing && editing !== "new" ? (workspaceValueOf(editing.id) ?? "") : ""}
        allWorkspaceValues={workspaceValues.data ?? []}
        isOpen={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </Section>
  );
}

function CustomFieldDialog({
  field,
  workspaceValue,
  allWorkspaceValues,
  isOpen,
  onOpenChange,
}: {
  field?: CustomFieldDef;
  workspaceValue: string;
  allWorkspaceValues: { fieldId: string; value: string }[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState({
    label: field?.label ?? "",
    type: (field?.type ?? "text") as CustomFieldType,
    scope: (field?.scope ?? "document") as CustomFieldScope,
    section: (field?.section ?? "bill_to") as TemplateSection,
    value: workspaceValue,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useSaveCustomField();
  const saveValues = useSaveCustomFieldValues("workspace", "workspace");

  const submit = async (close: () => void) => {
    const input = {
      label: values.label,
      type: values.type,
      scope: values.scope,
      section: values.section,
    };
    const result = validate(customFieldCreateInput, input);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    try {
      const saved = await save.mutateAsync(
        field ? { id: field.id, input: { label: input.label, section: input.section } } : { input },
      );
      if (values.scope === "workspace" && values.value.trim() !== workspaceValue) {
        await saveValues.mutateAsync([
          ...allWorkspaceValues.filter((v) => v.fieldId !== saved.id),
          { fieldId: saved.id, value: values.value.trim() },
        ]);
      }
      toast({ title: field ? "Custom field saved" : "Custom field added", tone: "success" });
      close();
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not save the custom field");
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <Dialog title={field ? "Edit custom field" : "New custom field"}>
        {(close) => (
          <Form
            validationBehavior="aria"
            className="flex flex-col gap-4 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(close);
            }}
          >
            <TextField
              label="Label"
              autoFocus
              isRequired
              placeholder="PO number"
              value={values.label}
              onChange={(label) => setValues({ ...values, label })}
              {...fieldError(errors, "label")}
            />
            <Select
              label="Type"
              isDisabled={Boolean(field)}
              value={values.type}
              onChange={(key) => key && setValues({ ...values, type: key as CustomFieldType })}
            >
              {CUSTOM_FIELD_TYPES.map((id) => (
                <ListBoxItem key={id} id={id}>
                  {CUSTOM_FIELD_TYPE_LABELS[id]}
                </ListBoxItem>
              ))}
            </Select>
            <Select
              label="Level"
              description={
                field
                  ? "The level cannot change after the field is created."
                  : "Where people enter the value."
              }
              isDisabled={Boolean(field)}
              value={values.scope}
              onChange={(key) => key && setValues({ ...values, scope: key as CustomFieldScope })}
            >
              {CUSTOM_FIELD_SCOPES.map((id) => (
                <ListBoxItem key={id} id={id}>
                  {CUSTOM_FIELD_SCOPE_LABELS[id]}
                </ListBoxItem>
              ))}
            </Select>
            <Select
              label="Prints in"
              description="Templates can move the field to another section."
              value={values.section}
              onChange={(key) => key && setValues({ ...values, section: key as TemplateSection })}
            >
              {TEMPLATE_SECTIONS.map((id) => (
                <ListBoxItem key={id} id={id}>
                  {TEMPLATE_SECTION_LABELS[id]}
                </ListBoxItem>
              ))}
            </Select>
            {values.scope === "workspace" ? (
              <TextField
                label="Value"
                description="Prints on every document. Leave it empty to print nothing."
                value={values.value}
                onChange={(value) => setValues({ ...values, value })}
              />
            ) : null}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
              <Button type="submit" isPending={save.isPending || saveValues.isPending}>
                {field ? "Save" : "Add field"}
              </Button>
            </div>
          </Form>
        )}
      </Dialog>
    </Modal>
  );
}
