import { Link } from "@tanstack/react-router";
import { LayoutDashboard, Plus } from "lucide-react";
import { useState } from "react";
import { TEMPLATE_LAYOUT_LABELS } from "../../../shared/schemas/template";
import { OwnerOnlyNote } from "../../components/owner-note";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { Section } from "../../components/ui/section";
import { Skeleton } from "../../components/ui/skeleton";
import { cn } from "../../components/ui/utils";
import { useTemplates } from "../../lib/reference-data";
import { useMe } from "../../lib/session";
import { CustomFieldsSection } from "./custom-fields-section";
import { NewTemplateDialog } from "./new-template-dialog";

export function TemplatesPage() {
  const { isOwner, isPending } = useMe();
  const templates = useTemplates();
  const [creating, setCreating] = useState(false);
  const items = templates.data ?? [];

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Layouts for invoices and quotes. Sent documents keep the template they were sent with."
        actions={
          isOwner ? (
            <Button onPress={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New template
            </Button>
          ) : null
        }
      />
      {!isPending && !isOwner ? (
        <OwnerOnlyNote>Only an Owner can change templates. You can view them.</OwnerOnlyNote>
      ) : null}

      <Section
        title="Templates"
        description="Without a template, documents use the classic layout with every section."
        flush
      >
        {templates.isPending ? (
          <div className="p-5">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={LayoutDashboard}
            className="rounded-none rounded-b-card"
            title="No templates yet"
            description="Start from a ready-made design, then change the layout, colors, font, and sections."
            action={
              isOwner ? (
                <Button size="sm" onPress={() => setCreating(true)}>
                  New template
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="m-0 grid list-none gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((template) => (
              <li key={template.id}>
                <Link
                  to="/templates/$templateId"
                  params={{ templateId: template.id }}
                  className={cn(
                    "flex min-h-24 flex-col gap-1 rounded-card border border-border bg-background p-4 text-ink no-underline outline-none",
                    "hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{template.name}</span>
                    {template.isDefault ? (
                      <span className="rounded-pill bg-segmented px-2 py-0.5 text-xs text-muted-foreground">
                        Default
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    {TEMPLATE_LAYOUT_LABELS[template.layout]} layout
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <CustomFieldsSection />

      <NewTemplateDialog
        key={creating ? "open" : "closed"}
        isOpen={creating}
        onOpenChange={setCreating}
      />
    </>
  );
}
