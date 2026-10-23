import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, GripVertical } from "lucide-react";
import { useEffect, useState } from "react";
import {
  GridList,
  GridListItem,
  type Key,
  Button as RACButton,
  useDragAndDrop,
} from "react-aria-components";
import { TEMPLATE_LAYOUTS, type TemplateConfig, type TemplateLayout } from "../../../shared/domain";
import {
  type CustomFieldDef,
  TEMPLATE_LAYOUT_DESCRIPTIONS,
  TEMPLATE_LAYOUT_LABELS,
  TEMPLATE_SECTION_LABELS,
  type TemplateDetail,
} from "../../../shared/schemas/template";
import { OwnerOnlyNote } from "../../components/owner-note";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { AlertDialog } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { ListBoxItem } from "../../components/ui/list-box";
import { Section } from "../../components/ui/section";
import { Segment, SegmentedControl } from "../../components/ui/segmented-control";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { cn } from "../../components/ui/utils";
import { useMe } from "../../lib/session";
import {
  fetchPreview,
  useCustomFields,
  useDeleteTemplate,
  useSetDefaultTemplate,
  useTemplate,
  useUpdateTemplate,
} from "./queries";

type Sections = TemplateConfig["sections"];

/** Moves the dragged sections before or after the drop target. */
export function moveSections(
  sections: Sections,
  keys: Set<Key>,
  target: Key,
  position: "before" | "after" | "on",
): Sections {
  const moving = sections.filter((s) => keys.has(s.id));
  const rest = sections.filter((s) => !keys.has(s.id));
  const index = rest.findIndex((s) => s.id === target);
  if (index === -1) return sections;
  const at = position === "before" ? index : index + 1;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/** Fetches the preview HTML 300 ms after the last config change. */
function usePreview(config: TemplateConfig) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(config);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchPreview({ config: JSON.parse(key) as TemplateConfig }, controller.signal)
        .then((text) => {
          setHtml(text);
          setError(null);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : "The preview failed");
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);
  return { html, error };
}

export function TemplateEditorPage({ templateId }: { templateId: string }) {
  const query = useTemplate(templateId);
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        title="This template could not be loaded"
        description={query.error.message}
        action={
          <Link to="/templates" className="text-sm text-ink underline">
            Back to templates
          </Link>
        }
      />
    );
  }
  return <TemplateEditor key={query.data.id} template={query.data} />;
}

function TemplateEditor({ template }: { template: TemplateDetail }) {
  const { isOwner } = useMe();
  const readOnly = !isOwner;
  const [name, setName] = useState(template.name);
  const [config, setConfig] = useState<TemplateConfig>(template.config);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fields = useCustomFields();
  const update = useUpdateTemplate(template.id);
  const setDefault = useSetDefaultTemplate();
  const remove = useDeleteTemplate();
  const navigate = useNavigate();
  const preview = usePreview(config);

  const dirty =
    name.trim() !== template.name || JSON.stringify(config) !== JSON.stringify(template.config);

  const save = () =>
    update.mutate(
      { name: name.trim(), config },
      { onSuccess: () => toast({ title: "Template saved", tone: "success" }) },
    );

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) => [...keys].map((key) => ({ "text/plain": String(key) })),
    onReorder: (event) =>
      setConfig((current) => ({
        ...current,
        sections: moveSections(
          current.sections,
          event.keys,
          event.target.key,
          event.target.dropPosition,
        ),
      })),
    isDisabled: readOnly,
  });

  const setVisible = (id: string, visible: boolean) =>
    setConfig((current) => ({
      ...current,
      sections: current.sections.map((s) => (s.id === id ? { ...s, visible } : s)),
    }));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            to="/templates"
            className="inline-flex items-center gap-1 text-muted-foreground no-underline hover:text-ink"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Templates
          </Link>
        }
        title={template.name}
        subtitle={
          template.isDefault
            ? "The workspace default template."
            : `${TEMPLATE_LAYOUT_LABELS[template.layout]} layout`
        }
        actions={
          isOwner ? (
            <>
              {!template.isDefault ? (
                <Button
                  variant="secondary"
                  isPending={setDefault.isPending}
                  onPress={() =>
                    setDefault.mutate(template.id, {
                      onSuccess: () => toast({ title: "Default template set", tone: "success" }),
                    })
                  }
                >
                  Set as default
                </Button>
              ) : null}
              <Button
                variant="ghost"
                isDisabled={template.inUse}
                onPress={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
              <Button isDisabled={!dirty} isPending={update.isPending} onPress={save}>
                Save
              </Button>
            </>
          ) : null
        }
      />
      {readOnly ? (
        <OwnerOnlyNote>Only an Owner can change templates. You can view this one.</OwnerOnlyNote>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
        <div className="flex flex-col gap-5">
          <Section title="Layout">
            <div className="flex flex-col gap-4">
              <TextField
                label="Name"
                isDisabled={readOnly}
                value={name}
                onChange={setName}
                isRequired
              />
              <div className="flex flex-col gap-2">
                <span id="editor-layout" className="text-sm font-medium text-ink">
                  Layout
                </span>
                <SegmentedControl
                  aria-labelledby="editor-layout"
                  isDisabled={readOnly}
                  selectedKey={config.layout}
                  onSelectionChange={(key) =>
                    setConfig((c) => ({ ...c, layout: key as TemplateLayout }))
                  }
                >
                  {TEMPLATE_LAYOUTS.map((id) => (
                    <Segment key={id} id={id}>
                      {TEMPLATE_LAYOUT_LABELS[id]}
                    </Segment>
                  ))}
                </SegmentedControl>
                <p className="m-0 text-xs text-muted-foreground">
                  {TEMPLATE_LAYOUT_DESCRIPTIONS[config.layout]}
                </p>
              </div>
            </div>
          </Section>

          <Section
            title="Sections"
            description={
              readOnly
                ? "The order and visibility of each section."
                : "Drag a section to reorder it. With a keyboard, focus the handle and press Enter."
            }
            flush
          >
            <GridList
              aria-label="Sections"
              items={config.sections}
              dragAndDropHooks={readOnly ? undefined : dragAndDropHooks}
              className="flex flex-col divide-y divide-row-border outline-none"
            >
              {(section) => (
                <GridListItem
                  id={section.id}
                  textValue={TEMPLATE_SECTION_LABELS[section.id]}
                  className={({ isDragging, isDropTarget, isFocusVisible }) =>
                    cn(
                      "flex min-h-12 items-center gap-2 bg-background px-3 outline-none",
                      isDragging && "opacity-50",
                      isDropTarget && "bg-sidebar",
                      isFocusVisible && "outline-2 -outline-offset-2 outline-ring",
                    )
                  }
                >
                  {!readOnly ? (
                    <RACButton
                      slot="drag"
                      aria-label={`Move ${TEMPLATE_SECTION_LABELS[section.id]}`}
                      className="flex size-11 cursor-grab items-center justify-center rounded-button text-muted-foreground outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ring md:size-8"
                    >
                      <GripVertical className="size-4" aria-hidden="true" />
                    </RACButton>
                  ) : null}
                  <span
                    className={cn(
                      "flex-1 text-sm",
                      section.visible ? "text-ink" : "text-muted-foreground line-through",
                    )}
                  >
                    {TEMPLATE_SECTION_LABELS[section.id]}
                  </span>
                  <Switch
                    aria-label={`Show ${TEMPLATE_SECTION_LABELS[section.id]}`}
                    isDisabled={readOnly}
                    isSelected={section.visible}
                    onChange={(visible) => setVisible(section.id, visible)}
                  />
                </GridListItem>
              )}
            </GridList>
          </Section>

          <FieldPlacement
            fields={fields.data ?? []}
            config={config}
            readOnly={readOnly}
            onChange={(customFields) => setConfig((c) => ({ ...c, customFields }))}
          />
        </div>

        <Section
          title="Preview"
          description="A sample invoice with your brand kit. The preview updates as you edit."
          flush
          className="lg:sticky lg:top-4 lg:self-start"
        >
          {preview.error ? (
            <p className="m-0 px-5 py-4 text-sm text-danger">{preview.error}</p>
          ) : null}
          {preview.html === null ? (
            <div className="p-5">
              <Skeleton className="h-[70vh] w-full" />
            </div>
          ) : (
            <iframe
              title="Template preview"
              sandbox=""
              srcDoc={preview.html}
              className="block h-[75vh] w-full rounded-b-card border-0 bg-[#f1f0ec]"
            />
          )}
        </Section>
      </div>

      <AlertDialog
        isOpen={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this template?"
        actionLabel="Delete template"
        variant="danger"
        onAction={() =>
          remove.mutate(template.id, {
            onSuccess: () => {
              toast({ title: "Template deleted", tone: "success" });
              void navigate({ to: "/templates" });
            },
          })
        }
      >
        Nothing uses this template. Sent documents keep their own copy.
      </AlertDialog>
    </>
  );
}

function FieldPlacement({
  fields,
  config,
  readOnly,
  onChange,
}: {
  fields: CustomFieldDef[];
  config: TemplateConfig;
  readOnly: boolean;
  onChange: (customFields: TemplateConfig["customFields"]) => void;
}) {
  if (fields.length === 0) return null;
  const placementOf = (field: CustomFieldDef) =>
    config.customFields.find((f) => f.fieldId === field.id)?.section ?? field.section;
  return (
    <Section title="Custom fields" description="Choose the section where each field prints.">
      <div className="flex flex-col gap-4">
        {fields.map((field) => (
          <Select
            key={field.id}
            label={field.label}
            isDisabled={readOnly}
            value={placementOf(field)}
            onChange={(key) => {
              if (!key) return;
              const rest = config.customFields.filter((f) => f.fieldId !== field.id);
              onChange(
                key === field.section
                  ? rest
                  : [...rest, { fieldId: field.id, section: key as typeof field.section }],
              );
            }}
          >
            {config.sections.map((section) => (
              <ListBoxItem key={section.id} id={section.id}>
                {TEMPLATE_SECTION_LABELS[section.id]}
                {section.visible ? "" : " (hidden)"}
              </ListBoxItem>
            ))}
          </Select>
        ))}
      </div>
    </Section>
  );
}
