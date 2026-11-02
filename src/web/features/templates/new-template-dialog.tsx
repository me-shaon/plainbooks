import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { Form, Radio, RadioGroup } from "react-aria-components";
import {
  TEMPLATE_PRESETS,
  type TemplatePreset,
  templateCreateInput,
} from "../../../shared/schemas/template";
import { Button } from "../../components/ui/button";
import { Dialog, Modal } from "../../components/ui/dialog";
import { Skeleton } from "../../components/ui/skeleton";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { cn } from "../../components/ui/utils";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { queryKeys } from "../../lib/query-keys";
import { fetchPreview, useCreateTemplate } from "./queries";

/** The document page is 842 px wide. The card shows it at this scale. */
const THUMB_SCALE = 0.28;
const PAGE_WIDTH = 842;
const THUMB_WIDTH = Math.round(PAGE_WIDTH * THUMB_SCALE);
const THUMB_HEIGHT = 300;

/** A scaled sample invoice in a ready-made template, with the workspace brand kit. */
function PresetThumbnail({ preset }: { preset: TemplatePreset }) {
  const preview = useQuery({
    queryKey: [...queryKeys.templates.all, "preset-preview", preset.id],
    queryFn: ({ signal }) => fetchPreview({ config: preset.config }, signal),
    staleTime: 5 * 60 * 1000,
  });
  return (
    <div
      className="relative overflow-hidden rounded-small border border-border bg-[#f1f0ec]"
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
    >
      {preview.data ? (
        <iframe
          title={`${preset.name} preview`}
          aria-hidden="true"
          tabIndex={-1}
          sandbox=""
          srcDoc={preview.data}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{
            width: PAGE_WIDTH,
            height: THUMB_HEIGHT / THUMB_SCALE,
            transform: `scale(${THUMB_SCALE})`,
          }}
        />
      ) : preview.isError ? (
        <p className="m-0 p-3 text-xs text-muted-foreground">The preview did not load.</p>
      ) : (
        <Skeleton className="h-full w-full rounded-none" />
      )}
    </div>
  );
}

/**
 * The New template dialog: a gallery of ready-made templates with live previews. Creating
 * one makes the Owner's own copy and opens it in the editor.
 */
export function NewTemplateDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [presetId, setPresetId] = useState<string>(TEMPLATE_PRESETS[0]?.id ?? "classic");
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const create = useCreateTemplate();
  const navigate = useNavigate();
  const preset = TEMPLATE_PRESETS.find((p) => p.id === presetId) ?? TEMPLATE_PRESETS[0];

  const submit = async (close: () => void) => {
    if (!preset) return;
    const values = {
      name: name.trim() || preset.name,
      layout: preset.config.layout,
      config: preset.config,
    };
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
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} className="max-w-5xl">
      <Dialog
        title="New template"
        description="Pick a starting design. The previews use your brand kit. You can change everything in the editor."
      >
        {(close) => (
          <Form
            validationBehavior="aria"
            className="flex flex-col gap-5 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(close);
            }}
          >
            <RadioGroup
              value={presetId}
              onChange={setPresetId}
              className="flex flex-col gap-2"
              aria-label="Starting design"
            >
              <div
                className="grid justify-center gap-4"
                style={{ gridTemplateColumns: `repeat(auto-fill, ${THUMB_WIDTH + 18}px)` }}
              >
                {TEMPLATE_PRESETS.map((item) => (
                  <Radio
                    key={item.id}
                    value={item.id}
                    className={({ isSelected, isFocusVisible }) =>
                      cn(
                        "flex cursor-pointer flex-col gap-2 rounded-card border p-2 outline-none transition-colors",
                        isSelected
                          ? "border-accent bg-accent/5 shadow-[0_0_0_1px_var(--accent)]"
                          : "border-border hover:border-[#c9c6bd]",
                        isFocusVisible && "outline-2 outline-offset-2 outline-ring",
                      )
                    }
                  >
                    {({ isSelected }) => (
                      <>
                        <PresetThumbnail preset={item} />
                        <span className="flex items-start justify-between gap-2 px-1">
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="text-sm font-medium text-ink">{item.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          </span>
                          {isSelected ? (
                            <Check
                              className="mt-0.5 size-4 shrink-0 text-accent"
                              aria-hidden="true"
                            />
                          ) : null}
                        </span>
                      </>
                    )}
                  </Radio>
                ))}
              </div>
            </RadioGroup>
            <div className="flex flex-col gap-3 border-t border-row-border pt-4 sm:flex-row sm:items-end">
              <TextField
                label="Name"
                className="sm:flex-1"
                placeholder={preset?.name ?? "Agency standard"}
                description="Leave it empty to use the design's name."
                value={name}
                onChange={setName}
                {...fieldError(errors, "name")}
              />
              <div className="flex flex-col-reverse gap-2 sm:mb-6 sm:flex-row">
                <Button variant="secondary" onPress={close}>
                  Cancel
                </Button>
                <Button type="submit" isPending={create.isPending}>
                  Create template
                </Button>
              </div>
            </div>
          </Form>
        )}
      </Dialog>
    </Modal>
  );
}
