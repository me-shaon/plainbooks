import { parseDate } from "@internationalized/date";
import { Copy, Ellipsis, FileText, Plus, Send, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Key } from "react-aria-components";
import { KpiCard, KpiGrid } from "../components/kpi-card";
import { PageHeader } from "../components/page-header";
import { Button, type ButtonVariant } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { ComboBox } from "../components/ui/combo-box";
import { DatePicker } from "../components/ui/date-picker";
import { AlertDialog, Dialog, DialogTrigger, Modal } from "../components/ui/dialog";
import { EmptyState } from "../components/ui/empty-state";
import { ListBoxItem } from "../components/ui/list-box";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { NumberField } from "../components/ui/number-field";
import { Pill } from "../components/ui/pill";
import { Segment, SegmentedControl } from "../components/ui/segmented-control";
import { Select } from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { STATUSES, type Status } from "../components/ui/status";
import { Switch } from "../components/ui/switch";
import {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableContainer,
  TableHeader,
} from "../components/ui/table";
import { TextArea, TextField } from "../components/ui/text-field";
import { toast } from "../components/ui/toast";
import { Tooltip, TooltipTrigger } from "../components/ui/tooltip";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];

const clients = [
  { id: "northwind", name: "Northwind Studio" },
  { id: "halden", name: "Halden & Co" },
  { id: "brightline", name: "Brightline Labs" },
  { id: "moss", name: "Moss Coffee" },
];

interface SampleRow {
  id: string;
  client: string;
  note: string;
  status: Status;
  label?: string;
  due: string;
  currency: string;
  amount: string;
}

const rows: SampleRow[] = [
  {
    id: "INV-0042",
    client: "Northwind Studio",
    note: "Website redesign, phase 2",
    status: "sent",
    due: "30 Oct 2026",
    currency: "USD",
    amount: "4,800.00",
  },
  {
    id: "INV-0041",
    client: "Halden & Co",
    note: "Brand identity",
    status: "overdue",
    label: "Overdue 11 days",
    due: "12 Oct 2026",
    currency: "EUR",
    amount: "2,150.00",
  },
  {
    id: "INV-0040",
    client: "Brightline Labs",
    note: "Product sprint",
    status: "paid",
    due: "08 Oct 2026",
    currency: "USD",
    amount: "7,200.00",
  },
  {
    id: "INV-0039",
    client: "Moss Coffee",
    note: "Menu and packaging",
    status: "draft",
    due: "None",
    currency: "GBP",
    amount: "980.00",
  },
  {
    id: "INV-0038",
    client: "Northwind Studio",
    note: "Monthly retainer, recurring",
    status: "paid",
    due: "01 Oct 2026",
    currency: "USD",
    amount: "3,000.00",
  },
];

export default function DesignGallery() {
  const [filter, setFilter] = useState<Key>("all");

  return (
    <>
      <PageHeader
        eyebrow="Development only"
        title="Design system"
        subtitle="Every primitive in its states. Hover, press, and tab through them to see the interactive states."
        actions={
          <>
            <Button variant="secondary">New quote</Button>
            <Button>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
              New invoice
            </Button>
          </>
        }
      />

      <KpiGrid>
        <KpiCard
          variant="hero"
          label="Outstanding"
          value="$18,330"
          note="3 currencies, 4 invoices"
        />
        <KpiCard label="Overdue" value="€2,150" note="1 invoice, Halden & Co" />
        <KpiCard label="Paid in October" value="$10,200" note="2 invoices" />
        <KpiCard label="Next recurring" value="1 Nov" note="Northwind retainer, $3,000" />
      </KpiGrid>

      <section
        aria-label="Cash by currency"
        className="flex flex-col gap-3.5 rounded-card bg-card px-[18px] py-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 text-[15px] font-semibold">Outstanding by currency</h2>
          <span className="text-xs text-muted-foreground">Each currency keeps its own total.</span>
        </div>
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-pill">
          <div className="flex-6 bg-accent" />
          <div className="flex-3 bg-accent-mid" />
          <div className="flex-1 bg-accent-light" />
        </div>
        <div className="flex flex-wrap gap-5 text-[13px]">
          {[
            ["USD", "12,000.00", "bg-accent"],
            ["EUR", "5,350.00", "bg-accent-mid"],
            ["GBP", "980.00", "bg-accent-light"],
          ].map(([currency, amount, color]) => (
            <span key={currency} className="flex items-center gap-1.5">
              <span className={`size-2 rounded-[2px] ${color}`} />
              {currency} <span className="figure">{amount}</span>
            </span>
          ))}
        </div>
      </section>

      <Section title="Recent invoices (Table + SegmentedControl + Pill)">
        <div className="-mt-1 flex justify-end">
          <SegmentedControl
            aria-label="Filter invoices"
            selectedKey={filter}
            onSelectionChange={setFilter}
          >
            <Segment id="all">All</Segment>
            <Segment id="unpaid">Unpaid</Segment>
            <Segment id="overdue">Overdue</Segment>
            <Segment id="drafts">Drafts</Segment>
          </SegmentedControl>
        </div>
        <TableContainer>
          <Table
            aria-label="Recent invoices"
            onRowAction={(key) => toast({ title: `Open ${key}` })}
          >
            <TableHeader>
              <Column isRowHeader>Number</Column>
              <Column>Client</Column>
              <Column>Status</Column>
              <Column>Due</Column>
              <Column align="end">Amount</Column>
            </TableHeader>
            <TableBody items={rows}>
              {(row) => (
                <Row id={row.id}>
                  <Cell className="figure text-[12.5px] text-muted-foreground">{row.id}</Cell>
                  <Cell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{row.client}</span>
                      <span className="text-xs text-muted-foreground">{row.note}</span>
                    </div>
                  </Cell>
                  <Cell>
                    <Pill status={row.status}>{row.label}</Pill>
                  </Cell>
                  <Cell className="text-muted-foreground">{row.due}</Cell>
                  <Cell align="end" className="figure font-medium whitespace-nowrap">
                    <span className="font-normal text-muted-foreground">{row.currency}</span>{" "}
                    {row.amount}
                  </Cell>
                </Row>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>

      <Section title="Status pills">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((status) => (
            <Pill key={status} status={status} />
          ))}
        </div>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-col gap-3">
          {variants.map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-xs text-muted-foreground">{variant}</span>
              <Button variant={variant} size="sm">
                Small
              </Button>
              <Button variant={variant}>Medium</Button>
              <Button variant={variant} size="lg">
                Large
              </Button>
              <Button variant={variant} isDisabled>
                Disabled
              </Button>
              <Button variant={variant} isPending>
                Pending
              </Button>
              <Button variant={variant} size="icon" aria-label="Send">
                <Send className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Text inputs">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Client name" placeholder="Northwind Studio" />
          <TextField
            label="Email"
            description="Invoices go to this address."
            defaultValue="ap@northwind.studio"
          />
          <TextField label="Tax ID" isInvalid errorMessage="Enter a tax ID." defaultValue="" />
          <TextField label="Invoice number" isDisabled defaultValue="INV-0043" />
          <NumberField
            label="Quantity"
            defaultValue={3}
            minValue={0}
            showStepper
            description="With the stepper buttons."
          />
          <NumberField
            label="Rate"
            defaultValue={1250}
            formatOptions={{ style: "currency", currency: "USD" }}
            inputClassName="text-right"
          />
          <TextArea
            label="Notes"
            placeholder="Thank you for your business."
            className="sm:col-span-2"
          />
        </div>
      </Section>

      <Section title="Pickers">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Currency" placeholder="Choose a currency" defaultValue="USD">
            <ListBoxItem id="USD">USD (US dollar)</ListBoxItem>
            <ListBoxItem id="EUR">EUR (Euro)</ListBoxItem>
            <ListBoxItem id="GBP">GBP (Pound sterling)</ListBoxItem>
            <ListBoxItem id="BDT">BDT (Bangladeshi taka)</ListBoxItem>
          </Select>
          <Select label="Template" isDisabled placeholder="Classic">
            <ListBoxItem id="classic">Classic</ListBoxItem>
          </Select>
          <ComboBox label="Client" placeholder="Search clients" defaultItems={clients}>
            {(client) => <ListBoxItem id={client.id}>{client.name}</ListBoxItem>}
          </ComboBox>
          <DatePicker label="Issue date" defaultValue={parseDate("2026-10-23")} />
          <DatePicker
            label="Due date"
            isInvalid
            errorMessage="The due date is before the issue date."
          />
        </div>
      </Section>

      <Section title="Checkbox and switch">
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <Checkbox>Unchecked</Checkbox>
          <Checkbox defaultSelected>Checked</Checkbox>
          <Checkbox isIndeterminate>Indeterminate</Checkbox>
          <Checkbox isDisabled>Disabled</Checkbox>
          <Switch>Auto-send reminders</Switch>
          <Switch defaultSelected>Attach PDF</Switch>
          <Switch isDisabled>Disabled</Switch>
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <DialogTrigger>
            <Button variant="secondary">Open dialog</Button>
            <Modal>
              <Dialog
                title="Edit client"
                description="Changes apply to new invoices only."
                footer={(close) => (
                  <>
                    <Button variant="secondary" onPress={close}>
                      Cancel
                    </Button>
                    <Button onPress={close}>Save</Button>
                  </>
                )}
              >
                <div className="flex flex-col gap-4">
                  <TextField label="Name" defaultValue="Northwind Studio" autoFocus />
                  <TextField label="Email" defaultValue="ap@northwind.studio" />
                </div>
              </Dialog>
            </Modal>
          </DialogTrigger>
          <DialogTrigger>
            <Button variant="danger">Void invoice</Button>
            <AlertDialog
              title="Void INV-0042?"
              actionLabel="Void invoice"
              variant="danger"
              onAction={() => toast({ title: "INV-0042 is void" })}
            >
              The client can no longer pay it. You cannot undo this.
            </AlertDialog>
          </DialogTrigger>
          <MenuTrigger>
            <Button variant="ghost" size="icon" aria-label="More actions">
              <Ellipsis className="size-4" aria-hidden="true" />
            </Button>
            <Menu>
              <MenuItem onAction={() => toast({ title: "Duplicated" })}>
                <Copy aria-hidden="true" />
                Duplicate
              </MenuItem>
              <MenuItem isDisabled>
                <FileText aria-hidden="true" />
                Download PDF
              </MenuItem>
              <MenuSeparator />
              <MenuItem variant="danger">
                <Trash2 aria-hidden="true" />
                Delete
              </MenuItem>
            </Menu>
          </MenuTrigger>
          <TooltipTrigger>
            <Button variant="secondary">Hover for tooltip</Button>
            <Tooltip>Copies the public link</Tooltip>
          </TooltipTrigger>
        </div>
      </Section>

      <Section title="Toasts">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onPress={() => toast({ title: "Saved" })}>
            Neutral
          </Button>
          <Button
            variant="secondary"
            onPress={() =>
              toast({
                title: "Invoice sent",
                description: "INV-0042 went to Northwind Studio.",
                tone: "success",
              })
            }
          >
            Success
          </Button>
          <Button
            variant="secondary"
            onPress={() =>
              toast({
                title: "The PDF failed",
                description: "Try again in a minute.",
                tone: "danger",
              })
            }
          >
            Danger
          </Button>
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
          <Skeleton className="h-4 w-64" />
        </div>
      </Section>

      <Section title="Empty state">
        <EmptyState
          icon={FileText}
          title="No invoices yet"
          description="Create your first invoice, or convert an accepted quote."
          action={
            <Button>
              <Plus className="size-3.5" strokeWidth={2} aria-hidden="true" />
              New invoice
            </Button>
          }
        />
      </Section>
    </>
  );
}
