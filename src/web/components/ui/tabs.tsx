import {
  Tab as RACTab,
  TabList as RACTabList,
  TabPanel as RACTabPanel,
  Tabs as RACTabs,
  type TabListProps,
  type TabPanelProps,
  type TabProps,
  type TabsProps,
} from "react-aria-components";
import { cn, composeTailwind } from "./utils";

/**
 * Tabs with an underline on the selected tab. Arrow keys move between tabs.
 *
 * ```tsx
 * <Tabs selectedKey={tab} onSelectionChange={setTab}>
 *   <TabList aria-label="Reports"><Tab id="tax">Tax summary</Tab></TabList>
 *   <TabPanel id="tax">...</TabPanel>
 * </Tabs>
 * ```
 */
export function Tabs({ className, ...props }: TabsProps) {
  return <RACTabs {...props} className={composeTailwind(className, "flex flex-col gap-5")} />;
}

export function TabList<T extends object>({ className, ...props }: TabListProps<T>) {
  return (
    <RACTabList
      {...props}
      className={composeTailwind(
        className,
        "flex max-w-full gap-1 overflow-x-auto border-b border-border",
      )}
    />
  );
}

export function Tab({ className, ...props }: TabProps) {
  return (
    <RACTab
      {...props}
      className={composeTailwind(className, (rp) =>
        cn(
          "-mb-px inline-flex min-h-11 shrink-0 cursor-default items-center border-b-2 px-3 text-sm whitespace-nowrap outline-none md:min-h-10",
          "transition-[color,border-color] duration-(--duration-press)",
          rp.isSelected
            ? "border-accent font-medium text-ink"
            : "border-transparent text-muted-foreground hover:text-ink",
          rp.isFocusVisible && "rounded-small outline-2 -outline-offset-2 outline-ring",
        ),
      )}
    />
  );
}

export function TabPanel({ className, ...props }: TabPanelProps) {
  return (
    <RACTabPanel
      {...props}
      className={composeTailwind(className, "flex flex-col gap-5 outline-none")}
    />
  );
}
