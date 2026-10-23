import { ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import {
  composeRenderProps,
  Cell as RACCell,
  type CellProps as RACCellProps,
  Column as RACColumn,
  type ColumnProps as RACColumnProps,
  Row as RACRow,
  Table as RACTable,
  TableBody as RACTableBody,
  TableHeader as RACTableHeader,
  type RowProps,
  type TableBodyProps,
  type TableHeaderProps,
  type TableProps,
} from "react-aria-components";
import { cn, composeTailwind } from "./utils";

/**
 * The bordered, rounded box around a table. It scrolls sideways on narrow screens.
 *
 * ```tsx
 * <TableContainer>
 *   <Table aria-label="Invoices" onRowAction={...}>
 *     <TableHeader><Column isRowHeader>Number</Column><Column align="end">Amount</Column></TableHeader>
 *     <TableBody items={rows}>{(row) => <Row><Cell>...</Cell><Cell align="end">...</Cell></Row>}</TableBody>
 *   </Table>
 * </TableContainer>
 * ```
 */
export function TableContainer({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("overflow-x-auto rounded-card border border-border bg-background", className)}
    >
      {children}
    </div>
  );
}

export function Table({ className, ...props }: TableProps) {
  return (
    <RACTable
      {...props}
      className={composeTailwind(
        className,
        "w-full min-w-[720px] border-collapse text-[13.5px] outline-none",
      )}
    />
  );
}

export function TableHeader<T extends object>({ className, ...props }: TableHeaderProps<T>) {
  return (
    <RACTableHeader
      {...props}
      className={composeTailwind(className, "text-left text-xs text-muted-foreground")}
    />
  );
}

type Align = "start" | "end";

export interface ColumnProps extends RACColumnProps {
  align?: Align;
}

export function Column({ align = "start", className, ...props }: ColumnProps) {
  return (
    <RACColumn
      {...props}
      className={composeTailwind(className, (rp) =>
        cn(
          "border-b border-border px-[18px] py-[14px] font-medium outline-none whitespace-nowrap",
          align === "end" && "text-right",
          rp.allowsSorting && "cursor-pointer hover:text-ink",
          rp.isFocusVisible && "outline-2 -outline-offset-2 outline-ring",
        ),
      )}
    >
      {composeRenderProps(props.children, (children, { allowsSorting, sortDirection }) => (
        <span
          className={cn("inline-flex items-center gap-1", align === "end" && "flex-row-reverse")}
        >
          {children}
          {allowsSorting ? (
            <ArrowUp
              aria-hidden="true"
              className={cn(
                "size-3 transition-transform duration-(--duration-press)",
                sortDirection === "descending" && "rotate-180",
                !sortDirection && "opacity-0",
              )}
            />
          ) : null}
        </span>
      ))}
    </RACColumn>
  );
}

export function TableBody<T extends object>({ className, ...props }: TableBodyProps<T>) {
  return <RACTableBody {...props} className={composeTailwind(className, "")} />;
}

export function Row<T extends object>({ className, ...props }: RowProps<T>) {
  return (
    <RACRow
      {...props}
      className={composeTailwind(className, (rp) =>
        cn(
          "outline-none transition-colors duration-(--duration-press)",
          (rp.isHovered || rp.isFocused) && "bg-sidebar",
          rp.isSelected && "bg-tint",
          rp.isFocusVisible && "outline-2 -outline-offset-2 outline-ring",
          rp.isDisabled && "opacity-50",
        ),
      )}
    />
  );
}

export interface CellProps extends RACCellProps {
  align?: Align;
}

export function Cell({ align = "start", className, ...props }: CellProps) {
  return (
    <RACCell
      {...props}
      className={composeTailwind(className, (rp) =>
        cn(
          "border-b border-row-border px-[18px] py-[14px] align-middle outline-none",
          align === "end" && "text-right",
          rp.isFocusVisible && "outline-2 -outline-offset-2 outline-ring",
        ),
      )}
    />
  );
}
