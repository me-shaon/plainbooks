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
import { DOCUMENT_FONT_FACES } from "../../lib/document-fonts";
import { type FieldErrors, fieldError, validate } from "../../lib/form";
import { useMe } from "../../lib/session";
import { AccentColorField } from "./accent-color-field";
import { FooterField } from "./footer-field";
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
              <AccentColorField
                value={values.accentColor}
                onChange={(hex) => set("accentColor", hex)}
                isDisabled={readOnly}
                errorProps={fieldError(errors, "accentColor")}
              />
              <Select
                label="Font"
                isDisabled={readOnly}
                value={values.font}
                onChange={(key) => key && set("font", String(key))}
                {...fieldError(errors, "font")}
              >
                {FONT_CHOICES.map((choice) => (
                  <ListBoxItem
                    key={choice.id}
                    id={choice.id}
                    textValue={choice.label}
                    style={{ fontFamily: choice.stack }}
                  >
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
              <FooterField
                value={values.footerText ?? ""}
                onChange={(text) => set("footerText", text)}
                isDisabled={readOnly}
                errorProps={fieldError(errors, "footerText")}
              />
            </div>
          </Section>
        </div>

        <Section title="Preview" className="self-start">
          <style>{DOCUMENT_FONT_FACES}</style>
          <div
            className="flex flex-col gap-4 rounded-button border border-border p-4"
            style={{ fontFamily: font.stack }}
          >
            {/* The same order as the document header: logo, name, address, tax ID. */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                {kit.logoUrl ? (
                  <img
                    src={kit.logoUrl}
                    alt=""
                    className="mb-1 max-h-12 max-w-32 self-start object-contain object-left"
                  />
                ) : null}
                <span className="text-sm font-semibold break-words">
                  {values.businessName || "Your agency"}
                </span>
                <span className="text-xs whitespace-pre-line text-muted-foreground">
                  {values.address || "Business address"}
                </span>
                {values.taxId ? (
                  <span className="text-xs text-muted-foreground">Tax ID {values.taxId}</span>
                ) : null}
              </div>
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
            {values.bankDetails ? (
              <p className="m-0 border-t border-row-border pt-3 text-xs whitespace-pre-line">
                {values.bankDetails}
              </p>
            ) : null}
            {values.footerText ? (
              <p className="m-0 border-t border-row-border pt-3 text-[11px] break-words whitespace-pre-line text-muted-foreground">
                {values.footerText}
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
