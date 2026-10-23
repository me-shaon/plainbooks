import { ArrowDown, ArrowUp, Copy, Ellipsis, GripVertical, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { DocumentTotals } from "../../../shared/money";
import { type TaxRate, taxRateLabel } from "../../../shared/schemas/tax-rate";
import { Button } from "../../components/ui/button";
import { ListBoxItem } from "../../components/ui/list-box";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "../../components/ui/menu";
import { MoneyField } from "../../components/ui/money-field";
import { Select } from "../../components/ui/select";
import { TextField } from "../../components/ui/text-field";
import { cn } from "../../components/ui/utils";
import { formatMoney } from "../../lib/format";
import { type LineDraft, moveItem, newLine } from "./editor-state";

const NO_TAX = "__none";

/** Desktop column widths. Below 768 px each line is a card. */
const GRID =
  "md:grid md:grid-cols-[20px_minmax(0,1fr)_64px_112px_136px_104px_36px] md:items-start md:gap-2";

export interface LineItemsProps {
  lines: LineDraft[];
  currency: string;
  taxRates: TaxRate[];
  /** The tax rate for new lines (client default, then workspace default). */
  defaultTaxRateId: string | null;
  totals: DocumentTotals;
  onChange: (lines: LineDraft[]) => void;
  errors?: Record<string, string>;
  isDisabled?: boolean;
}

/** A label that shows on phone cards and is read by screen readers on wide screens. */
function FieldLabel({ children, n }: { children: string; n: number }) {
  return (
    <span className="md:sr-only">
      {children}
      <span className="sr-only">, line {n}</span>
    </span>
  );
}

/**
 * The line items table. Tab moves through the fields in order. Reorder with the drag handle,
 * or with Move up and Move down in the row menu.
 */
export function LineItems({
  lines,
  currency,
  taxRates,
  defaultTaxRateId,
  totals,
  onChange,
  errors = {},
  isDisabled,
}: LineItemsProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const update = (index: number, patch: Partial<LineDraft>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const remove = (index: number) => {
    const next = lines.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : [newLine(defaultTaxRateId)]);
  };
  const duplicate = (index: number) => {
    const source = lines[index];
    if (!source) return;
    const copy = { ...newLine(), ...source, key: newLine().key };
    onChange([...lines.slice(0, index + 1), copy, ...lines.slice(index + 1)]);
  };

  const usedRates = new Set(lines.map((l) => l.taxRateId));
  const rateOptions = taxRates.filter((r) => r.archivedAt === null || usedRates.has(r.id));

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-hidden="true"
        className={cn(
          "hidden border-b border-border px-1 pb-2 text-xs font-medium text-muted-foreground",
          GRID,
        )}
      >
        <span />
        <span>Description</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Unit price</span>
        <span>Tax</span>
        <span className="text-right">Amount</span>
        <span />
      </div>

      <ol aria-label="Line items" className="m-0 flex list-none flex-col gap-3 p-0 md:gap-1">
        {lines.map((line, index) => {
          const n = index + 1;
          const amount = totals.lines[index]?.amount ?? 0;
          return (
            <li
              key={line.key}
              aria-label={`Line ${n}`}
              onDragOver={(event) => {
                if (dragIndex === null) return;
                event.preventDefault();
                setOverIndex(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) onChange(moveItem(lines, dragIndex, index));
                setDragIndex(null);
                setOverIndex(null);
              }}
              className={cn(
                "flex flex-col gap-3 rounded-card border border-border bg-background p-4",
                "md:rounded-none md:border-0 md:border-b md:border-row-border md:bg-transparent md:px-1 md:py-2",
                GRID,
                dragIndex === index && "opacity-50",
                overIndex === index &&
                  dragIndex !== index &&
                  "md:shadow-[inset_0_2px_0_var(--accent)]",
              )}
            >
              <div className="flex items-center justify-between md:contents">
                {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only drag handle; keyboard users reorder with Move up and Move down in the row menu */}
                <span
                  draggable={!isDisabled}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(index));
                    setDragIndex(index);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  title="Drag to reorder"
                  className="flex h-10 cursor-grab items-center text-muted-foreground active:cursor-grabbing"
                >
                  <GripVertical className="size-4" aria-hidden="true" />
                  <span className="ml-1 text-[13px] font-medium text-ink md:hidden">Line {n}</span>
                </span>
                <span className="md:hidden">
                  <RowMenu
                    n={n}
                    count={lines.length}
                    isDisabled={isDisabled}
                    onMove={(to) => onChange(moveItem(lines, index, to))}
                    index={index}
                    onDuplicate={() => duplicate(index)}
                    onRemove={() => remove(index)}
                  />
                </span>
              </div>

              <TextField
                label={<FieldLabel n={n}>Description</FieldLabel>}
                placeholder="What you did"
                isDisabled={isDisabled}
                value={line.description}
                onChange={(description) => update(index, { description })}
                isInvalid={Boolean(errors[`lines.${index}.description`])}
                errorMessage={errors[`lines.${index}.description`]}
              />
              <div className="grid grid-cols-2 gap-3 md:contents">
                <TextField
                  label={<FieldLabel n={n}>Quantity</FieldLabel>}
                  inputMode="decimal"
                  isDisabled={isDisabled}
                  value={line.quantity}
                  onChange={(quantity) => {
                    if (/^\d*(\.\d{0,3})?$/.test(quantity.trim())) {
                      update(index, { quantity: quantity.trim() });
                    }
                  }}
                  inputClassName="figure text-right"
                  isInvalid={Boolean(errors[`lines.${index}.quantity`])}
                  errorMessage={errors[`lines.${index}.quantity`]}
                />
                <MoneyField
                  label={<FieldLabel n={n}>{`Unit price (${currency})`}</FieldLabel>}
                  placeholder={currency}
                  currency={currency}
                  isDisabled={isDisabled}
                  value={line.unitPrice}
                  onChange={(unitPrice) => update(index, { unitPrice })}
                  isInvalid={Boolean(errors[`lines.${index}.unitPrice`])}
                  errorMessage={errors[`lines.${index}.unitPrice`]}
                />
              </div>
              <Select
                label={<FieldLabel n={n}>Tax</FieldLabel>}
                isDisabled={isDisabled}
                value={line.taxRateId ?? NO_TAX}
                onChange={(key) =>
                  update(index, { taxRateId: key === NO_TAX || key === null ? null : String(key) })
                }
              >
                <ListBoxItem id={NO_TAX}>No tax</ListBoxItem>
                {rateOptions.map((rate) => (
                  <ListBoxItem key={rate.id} id={rate.id}>
                    {taxRateLabel(rate)}
                  </ListBoxItem>
                ))}
              </Select>
              <div className="flex items-baseline justify-between md:block md:pt-2.5 md:text-right">
                <span className="text-[13px] text-muted-foreground md:sr-only">Amount</span>
                <span className="figure text-sm" data-testid={`line-amount-${n}`}>
                  {formatMoney(amount, currency)}
                </span>
              </div>
              <span className="hidden md:block md:pt-1">
                <RowMenu
                  n={n}
                  count={lines.length}
                  isDisabled={isDisabled}
                  onMove={(to) => onChange(moveItem(lines, index, to))}
                  index={index}
                  onDuplicate={() => duplicate(index)}
                  onRemove={() => remove(index)}
                />
              </span>
            </li>
          );
        })}
      </ol>

      <div>
        <Button
          variant="secondary"
          size="sm"
          isDisabled={isDisabled}
          onPress={() => onChange([...lines, newLine(defaultTaxRateId)])}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add line
        </Button>
      </div>
    </div>
  );
}

function RowMenu({
  n,
  index,
  count,
  isDisabled,
  onMove,
  onDuplicate,
  onRemove,
}: {
  n: number;
  index: number;
  count: number;
  isDisabled?: boolean;
  onMove: (to: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const disabledKeys = [...(index === 0 ? ["up"] : []), ...(index === count - 1 ? ["down"] : [])];
  return (
    <MenuTrigger>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Actions for line ${n}`}
        isDisabled={isDisabled}
      >
        <Ellipsis className="size-4" aria-hidden="true" />
      </Button>
      <Menu disabledKeys={disabledKeys}>
        <MenuItem id="up" textValue="Move up" onAction={() => onMove(index - 1)}>
          <ArrowUp aria-hidden="true" />
          Move up
        </MenuItem>
        <MenuItem id="down" textValue="Move down" onAction={() => onMove(index + 1)}>
          <ArrowDown aria-hidden="true" />
          Move down
        </MenuItem>
        <MenuItem id="duplicate" textValue="Duplicate" onAction={onDuplicate}>
          <Copy aria-hidden="true" />
          Duplicate
        </MenuItem>
        <MenuSeparator />
        <MenuItem id="remove" textValue="Remove line" variant="danger" onAction={onRemove}>
          <Trash2 aria-hidden="true" />
          Remove line
        </MenuItem>
      </Menu>
    </MenuTrigger>
  );
}
