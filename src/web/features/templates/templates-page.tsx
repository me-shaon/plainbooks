import { Link, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, Plus } from "lucide-react";
import { useState } from "react";
import { Form } from "react-aria-components";
import { TEMPLATE_LAYOUTS, type TemplateLayout } from "../../../shared/domain";
import {
  TEMPLATE_LAYOUT_DESCRIPTIONS,
  TEMPLATE_LAYOUT_LABELS,
  templateCreateInput,
} from "../../../shared/schemas/template";
import { OwnerOnlyNote } from "../../components/owner-note";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { Dialog, Modal } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { Section } from "../../components/ui/section";
import { Segment, SegmentedControl } from "../../components/ui/segmented-control";
import { Skeleton } from "../../components/ui/skeleton";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { cn } from "../../components/ui/utils";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useTemplates } from "../../lib/reference-data";
import { useMe } from "../../lib/session";
import { CustomFieldsSection } from "./custom-fields-section";
import { useCreateTemplate } from "./queries";

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
            description="Create a template from one of the three layouts, then reorder and hide sections."
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

function NewTemplateDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<TemplateLayout>("classic");
  const [errors, setErrors] = useState<FieldErrors>({});
  const create = useCreateTemplate();
  const navigate = useNavigate();

  const submit = async (close: () => void) => {
    const values = { name, layout };
    const result = validate(templateCreateInput, values);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    try {
      const template = await create.mutateAsync(values);
      toast({ title: "Template created", tone: "success" });
      close();
      void navigate({ to: "/templates/$templateId", params: { templateId: template.id } });
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not create the template");
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="sm">
      <Dialog title="New template">
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
              placeholder="Agency standard"
              value={name}
              onChange={setName}
              {...fieldError(errors, "name")}
            />
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-ink" id="layout-label">
                Layout
              </span>
              <SegmentedControl
                aria-labelledby="layout-label"
                selectedKey={layout}
                onSelectionChange={(key) => setLayout(key as TemplateLayout)}
              >
                {TEMPLATE_LAYOUTS.map((id) => (
                  <Segment key={id} id={id}>
                    {TEMPLATE_LAYOUT_LABELS[id]}
                  </Segment>
                ))}
              </SegmentedControl>
              <p className="m-0 text-xs text-muted-foreground">
                {TEMPLATE_LAYOUT_DESCRIPTIONS[layout]}
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button variant="secondary" onPress={close}>
                Cancel
              </Button>
              <Button type="submit" isPending={create.isPending}>
                Create template
              </Button>
            </div>
          </Form>
        )}
      </Dialog>
    </Modal>
  );
}
