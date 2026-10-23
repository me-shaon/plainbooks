import type { LucideIcon } from "lucide-react";
import { PageHeader } from "./page-header";
import { EmptyState } from "./ui/empty-state";

/** A page that later units replace. It shows the page title and an empty state. */
export function PlaceholderPage({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState
        icon={icon}
        title={`${title} is not built yet`}
        description="This page comes in a later release."
      />
    </>
  );
}
