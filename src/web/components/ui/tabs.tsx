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

/**
 * The strip under a row of tabs. The bottom rule is an inset shadow, so the tab underline
 * sits on it without overflowing. Narrow screens scroll the strip sideways with no bar.
 */
export const tabStrip =
  "flex max-w-full gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** One tab. Also used by the Settings sub navigation, which uses links. */
export function tabStyles(isSelected: boolean) {
  return cn(
    "inline-flex min-h-11 shrink-0 cursor-default items-center border-b-2 px-3 text-sm whitespace-nowrap outline-none md:min-h-10",
    "transition-[color,border-color] duration-(--duration-press)",
    isSelected
      ? "border-accent font-medium text-ink"
      : "border-transparent text-muted-foreground hover:text-ink",
  );
}

export function TabList<T extends object>({ className, ...props }: TabListProps<T>) {
  return <RACTabList {...props} className={composeTailwind(className, tabStrip)} />;
}

export function Tab({ className, ...props }: TabProps) {
  return (
    <RACTab
      {...props}
      className={composeTailwind(className, (rp) =>
        cn(
          tabStyles(rp.isSelected),
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
