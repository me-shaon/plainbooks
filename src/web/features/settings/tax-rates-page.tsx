import { Ellipsis, Percent, Plus } from "lucide-react";
import { useState } from "react";
import { Form } from "react-aria-components";
import { type TaxRate, taxRateInput } from "../../../shared/schemas/tax-rate";
import { Button } from "../../components/ui/button";
import { Dialog, Modal } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { Menu, MenuItem, MenuTrigger } from "../../components/ui/menu";
import { Section } from "../../components/ui/section";
import { Skeleton } from "../../components/ui/skeleton";
import { StackedList, StackedRow } from "../../components/ui/stacked-list";
import { Switch } from "../../components/ui/switch";
import { Cell, Column, Row, Table, TableBody, TableHeader } from "../../components/ui/table";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useTaxRates } from "../../lib/reference-data";
import { useMe } from "../../lib/session";
import { useArchiveTaxRate, useSaveTaxRate } from "./queries";

export function TaxRatesPage() {
  const { isOwner } = useMe();
  const [showArchived, setShowArchived] = useState(false);
  const rates = useTaxRates({ includeArchived: showArchived });
  const [editing, setEditing] = useState<TaxRate | "new" | null>(null);
  const archive = useArchiveTaxRate();
  const items = rates.data ?? [];

  const actions = (rate: TaxRate) =>
    isOwner ? (
      <MenuTrigger>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${rate.name}`}>
          <Ellipsis className="size-4" aria-hidden="true" />
        </Button>
        <Menu>
          <MenuItem onAction={() => setEditing(rate)}>Edit</MenuItem>
          {rate.archivedAt === null ? (
            <MenuItem
              variant="danger"
              onAction={() =>
                archive.mutate(
                  { id: rate.id, archive: true },
                  { onSuccess: () => toast({ title: "Tax rate archived", tone: "success" }) },
                )
              }
            >
              Archive
            </MenuItem>
          ) : (
            <MenuItem onAction={() => archive.mutate({ id: rate.id, archive: false })}>
              Restore
            </MenuItem>
          )}
        </Menu>
      </MenuTrigger>
    ) : null;

  return (
    <Section
      title="Tax rates"
      description="Each line on a document can use one rate. Archived rates stay on old documents."
      flush
      actions={
        <>
          <Switch isSelected={showArchived} onChange={setShowArchived}>
            Show archived
          </Switch>
          {isOwner ? (
            <Button size="sm" onPress={() => setEditing("new")}>
              <Plus className="size-4" aria-hidden="true" />
              New tax rate
            </Button>
          ) : null}
        </>
      }
    >
      {rates.isPending ? (
        <div className="p-5">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Percent}
          className="rounded-none rounded-b-card"
          title="No tax rates yet"
          description='Add the rates you charge, for example "VAT 15%".'
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table aria-label="Tax rates" className="min-w-0">
              <TableHeader>
                <Column isRowHeader>Name</Column>
                <Column align="end">Rate</Column>
                <Column>Invoice note</Column>
                <Column width={64}>
                  <span className="sr-only">Actions</span>
                </Column>
              </TableHeader>
              <TableBody items={items}>
                {(rate) => (
                  <Row id={rate.id}>
                    <Cell>
                      <span className="font-medium">{rate.name}</span>
                      {rate.archivedAt ? (
                        <span className="ml-2 rounded-pill bg-segmented px-2 py-0.5 text-xs text-muted-foreground">
                          Archived
                        </span>
                      ) : null}
                    </Cell>
                    <Cell align="end">
                      <span className="figure">{rate.rate}%</span>
                    </Cell>
                    <Cell>
                      <span className="text-muted-foreground">{rate.note ?? ""}</span>
                    </Cell>
                    <Cell align="end">{actions(rate)}</Cell>
                  </Row>
                )}
              </TableBody>
            </Table>
          </div>
          <StackedList label="Tax rates" className="rounded-none border-0 md:hidden">
            {items.map((rate) => (
              <StackedRow
                key={rate.id}
                title={rate.archivedAt ? `${rate.name} (archived)` : rate.name}
                meta={rate.note ?? undefined}
                value={<span className="figure">{rate.rate}%</span>}
                actions={actions(rate)}
              />
            ))}
          </StackedList>
        </>
      )}

      <TaxRateDialog
        key={editing === null ? "closed" : editing === "new" ? "new" : editing.id}
        rate={editing === "new" ? undefined : (editing ?? undefined)}
        isOpen={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </Section>
  );
}

function TaxRateDialog({
  rate,
  isOpen,
  onOpenChange,
}: {
  rate?: TaxRate;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState({
    name: rate?.name ?? "",
    rate: rate?.rate ?? "",
    note: rate?.note ?? "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useSaveTaxRate();

  const submit = async (close: () => void) => {
    const result = validate(taxRateInput, values);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    try {
      await save.mutateAsync({ id: rate?.id, input: values });
      toast({ title: rate ? "Tax rate saved" : "Tax rate added", tone: "success" });
      close();
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not save the tax rate");
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <Dialog title={rate ? "Edit tax rate" : "New tax rate"}>
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
              label="Name"
              autoFocus
              isRequired
              placeholder="VAT"
              value={values.name}
              onChange={(name) => setValues({ ...values, name })}
              {...fieldError(errors, "name")}
            />
            <TextField
              label="Rate (%)"
              isRequired
              inputMode="decimal"
              placeholder="15"
              inputClassName="figure"
              value={values.rate}
              onChange={(text) => setValues({ ...values, rate: text })}
              {...fieldError(errors, "rate")}
            />
            <TextField
              label="Invoice note"
              placeholder="Reverse charge"
              description="Optional. Prints on documents that use this rate."
              value={values.note}
              onChange={(note) => setValues({ ...values, note })}
              {...fieldError(errors, "note")}
            />
            {rate ? (
              <p className="m-0 text-xs text-muted-foreground">
                Sent documents keep the rate they were sent with.
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
              <Button type="submit" isPending={save.isPending}>
                {rate ? "Save" : "Add tax rate"}
              </Button>
            </div>
          </Form>
        )}
      </Dialog>
    </Modal>
  );
}
