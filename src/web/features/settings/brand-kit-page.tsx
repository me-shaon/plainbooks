import { ImageUp, Trash2 } from "lucide-react";
import { useState } from "react";
import { FileTrigger, Form } from "react-aria-components";
import {
  type BrandKit,
  brandKitInput,
  FONT_CHOICES,
  HEX_COLOR,
  LOGO_TYPES,
  MAX_LOGO_BYTES,
} from "../../../shared/schemas/settings";
import { OwnerOnlyNote } from "../../components/owner-note";
import { PageHeader } from "../../components/page-header";
import { Button } from "../../components/ui/button";
import { ListBoxItem } from "../../components/ui/list-box";
import { Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { TextArea, TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useMe } from "../../lib/session";
import { useBrandKit, useRemoveLogo, useUpdateBrandKit, useUploadLogo } from "./queries";
import { SaveBar } from "./settings-layout";

export function BrandKitPage() {
  const kit = useBrandKit();
  const { isOwner, isPending } = useMe();
  return (
    <>
      <PageHeader
        title="Brand kit"
        subtitle="Your logo, colors, and business details. New drafts use them. Sent documents keep the version they were sent with."
      />
      {!isPending && !isOwner ? <OwnerOnlyNote /> : null}
      {kit.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : kit.isError ? null : (
        <BrandKitForm
          // A new logo keeps unsaved edits. Other saved changes reset the form.
          key={JSON.stringify({ ...kit.data, logoKey: null, logoUrl: null })}
          kit={kit.data}
          readOnly={!isOwner}
        />
      )}
    </>
  );
}

type Values = Omit<BrandKit, "logoKey" | "logoUrl">;

/** Checks the file in the browser first. The Worker checks it again. */
export function logoFileError(file: File): string | null {
  if (!(file.type in LOGO_TYPES)) return "Choose a PNG, JPG, or SVG image.";
  if (file.size > MAX_LOGO_BYTES) return "The logo must be 1 MB or smaller.";
  return null;
}

export function BrandKitForm({ kit, readOnly }: { kit: BrandKit; readOnly: boolean }) {
  const [values, setValues] = useState<Values>({
    businessName: kit.businessName,
    accentColor: kit.accentColor,
    font: kit.font,
    address: kit.address,
    taxId: kit.taxId,
    bankDetails: kit.bankDetails,
    footerText: kit.footerText,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateBrandKit();
  const upload = useUploadLogo();
  const removeLogo = useRemoveLogo();
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    const result = validate(brandKitInput, values);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    try {
      await update.mutateAsync(result.data);
      toast({ title: "Brand kit saved", tone: "success" });
    } catch (err) {
      const fieldErrors = issuesByPath(err);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      else toastError(err, "Could not save the brand kit");
    }
  };

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const problem = logoFileError(file);
    if (problem) {
      toast({ title: "Could not use this file", description: problem, tone: "danger" });
      return;
    }
    upload.mutate(file, {
      onSuccess: () => toast({ title: "Logo uploaded", tone: "success" }),
    });
  };

  const validAccent = HEX_COLOR.test(values.accentColor);
  const font = FONT_CHOICES.find((f) => f.id === values.font) ?? FONT_CHOICES[0];

  return (
    <Form
      validationBehavior="aria"
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Logo" description="PNG, JPG, or SVG, up to 1 MB.">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-button border border-border bg-sidebar">
                {kit.logoUrl ? (
                  <img src={kit.logoUrl} alt="Current logo" className="max-h-full max-w-full" />
                ) : (
                  <ImageUp className="size-6 text-muted-foreground" aria-hidden="true" />
                )}
              </div>
              {readOnly ? null : (
                <div className="flex flex-wrap gap-2">
                  <FileTrigger acceptedFileTypes={Object.keys(LOGO_TYPES)} onSelect={onFiles}>
                    <Button variant="secondary" isPending={upload.isPending}>
                      <ImageUp className="size-4" aria-hidden="true" />
                      {kit.logoUrl ? "Replace logo" : "Upload logo"}
                    </Button>
                  </FileTrigger>
                  {kit.logoUrl ? (
                    <Button
                      variant="ghost"
                      isPending={removeLogo.isPending}
                      onPress={() => removeLogo.mutate()}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Remove
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </Section>

          <Section title="Look">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-end gap-3">
                <TextField
                  label="Accent color"
                  className="flex-1"
                  isDisabled={readOnly}
                  inputClassName="figure"
                  value={values.accentColor}
                  onChange={(text) => set("accentColor", text)}
                  description="A hex color, for example #2f7f6f."
                  {...fieldError(errors, "accentColor")}
                />
                <span
                  aria-hidden="true"
                  className="mb-6 size-10 shrink-0 rounded-button border border-border"
                  style={{ backgroundColor: validAccent ? values.accentColor : "transparent" }}
                />
              </div>
              <Select
                label="Font"
                isDisabled={readOnly}
                value={values.font}
                onChange={(key) => key && set("font", String(key))}
                {...fieldError(errors, "font")}
              >
                {FONT_CHOICES.map((choice) => (
                  <ListBoxItem key={choice.id} id={choice.id}>
                    {choice.label}
                  </ListBoxItem>
                ))}
              </Select>
            </div>
          </Section>

          <Section title="Business details" description="These print on every document.">
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Business name"
                className="sm:col-span-2"
                isDisabled={readOnly}
                value={values.businessName ?? ""}
                onChange={(text) => set("businessName", text)}
                {...fieldError(errors, "businessName")}
              />
              <TextArea
                label="Address"
                rows={3}
                isDisabled={readOnly}
                value={values.address ?? ""}
                onChange={(text) => set("address", text)}
                {...fieldError(errors, "address")}
              />
              <TextField
                label="Tax ID"
                isDisabled={readOnly}
                value={values.taxId ?? ""}
                onChange={(text) => set("taxId", text)}
                {...fieldError(errors, "taxId")}
              />
              <TextArea
                label="Bank details"
                className="sm:col-span-2"
                rows={4}
                isDisabled={readOnly}
                value={values.bankDetails ?? ""}
                onChange={(text) => set("bankDetails", text)}
                description="Shown in the payment details section of invoices."
                {...fieldError(errors, "bankDetails")}
              />
              <TextArea
                label="Default footer"
                className="sm:col-span-2"
                rows={2}
                isDisabled={readOnly}
                value={values.footerText ?? ""}
                onChange={(text) => set("footerText", text)}
                {...fieldError(errors, "footerText")}
              />
            </div>
          </Section>
        </div>

        <Section title="Preview" className="self-start">
          <div
            className="flex flex-col gap-4 rounded-button border border-border p-4"
            style={{ fontFamily: font.stack }}
          >
            <div className="flex items-start justify-between gap-3">
              {kit.logoUrl ? (
                <img src={kit.logoUrl} alt="" className="h-8 max-w-28 object-contain" />
              ) : (
                <span className="text-sm font-semibold">
                  {values.businessName || "Your agency"}
                </span>
              )}
              <span
                className="text-lg font-semibold"
                style={{ color: validAccent ? values.accentColor : undefined }}
              >
                Invoice
              </span>
            </div>
            <div
              className="h-1 rounded-pill"
              style={{ backgroundColor: validAccent ? values.accentColor : undefined }}
            />
            <p className="m-0 text-xs whitespace-pre-line text-muted-foreground">
              {values.address || "Business address"}
            </p>
            {values.bankDetails ? (
              <p className="m-0 border-t border-row-border pt-3 text-xs whitespace-pre-line">
                {values.bankDetails}
              </p>
            ) : null}
          </div>
        </Section>
      </div>

      {readOnly ? null : (
        <SaveBar>
          <Button type="submit" isPending={update.isPending}>
            Save brand kit
          </Button>
        </SaveBar>
      )}
    </Form>
  );
}
