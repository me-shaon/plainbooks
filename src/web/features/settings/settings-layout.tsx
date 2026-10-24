import { Link, type LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { OwnerOnlyNote } from "../../components/owner-note";
import { PageHeader } from "../../components/page-header";
import { tabStrip, tabStyles } from "../../components/ui/tabs";
import { cn } from "../../components/ui/utils";
import { useMe } from "../../lib/session";

interface Tab {
  to: LinkProps["to"];
  label: string;
  ownerOnly?: boolean;
}

const tabs: Tab[] = [
  { to: "/settings", label: "General" },
  { to: "/settings/reminders", label: "Reminders" },
  { to: "/settings/tax-rates", label: "Tax rates" },
  { to: "/settings/team", label: "Team", ownerOnly: true },
];

/** The Settings page frame: title, sub navigation, and the Member note. */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const { isOwner, isPending } = useMe();
  return (
    <>
      <PageHeader title="Settings" subtitle="Workspace defaults, numbering, tax rates, and team." />
      <nav aria-label="Settings" className={cn("-mt-2", tabStrip)}>
        {tabs
          .filter((tab) => !tab.ownerOnly || isOwner)
          .map((tab) => (
            <Link
              key={tab.label}
              to={tab.to}
              activeOptions={{ exact: true }}
              className={cn(
                tabStyles(false),
                "cursor-pointer focus-visible:rounded-small focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                "aria-[current=page]:border-accent aria-[current=page]:font-medium aria-[current=page]:text-ink",
              )}
            >
              {tab.label}
            </Link>
          ))}
      </nav>
      {!isPending && !isOwner ? <OwnerOnlyNote /> : null}
      {children}
    </>
  );
}

/** The sticky save row at the end of a settings form. Hidden for Members. */
export function SaveBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>;
}
