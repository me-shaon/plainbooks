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
import {
  type BrandImage,
  useBrandKit,
  useRemoveBrandImage,
  useUpdateBrandKit,
  useUploadBrandImage,
} from "./queries";
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
          // A new logo or signature keeps unsaved edits. Other saved changes reset the form.
          key={JSON.stringify({
            ...kit.data,
            logoKey: null,
            logoUrl: null,
            signatureKey: null,
            signatureUrl: null,
          })}
          kit={kit.data}
          readOnly={!isOwner}
        />
      )}
    </>
  );
}

type Values = Omit<BrandKit, "logoKey" | "logoUrl" | "signatureKey" | "signatureUrl">;

/** Checks the file in the browser first. The Worker checks it again. */
export function logoFileError(file: File, what = "logo"): string | null {
  if (!(file.type in LOGO_TYPES)) return "Choose a PNG, JPG, or SVG image.";
  if (file.size > MAX_LOGO_BYTES) return `The ${what} must be 1 MB or smaller.`;
  return null;
}

const IMAGE_COPY: Record<BrandImage, { name: string; title: string }> = {
  logo: { name: "logo", title: "Logo" },
  signature: { name: "signature", title: "Signature" },
};

/** The current image with Upload or Replace, and Remove. */
function BrandImageField({
  image,
  url,
  readOnly,
  boxClassName,
}: {
  image: BrandImage;
  url: string | null;
  readOnly: boolean;
  boxClassName: string;
}) {
  const upload = useUploadBrandImage(image);
  const remove = useRemoveBrandImage(image);
  const copy = IMAGE_COPY[image];
  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    const problem = logoFileError(file, copy.name);
    if (problem) {
      toast({ title: "Could not use this file", description: problem, tone: "danger" });
      return;
    }
    upload.mutate(file, {
      onSuccess: () => toast({ title: `${copy.title} uploaded`, tone: "success" }),
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden rounded-button border border-border bg-sidebar ${boxClassName}`}
      >
        {url ? (
          <img src={url} alt={`Current ${copy.name}`} className="max-h-full max-w-full" />
        ) : (
          <ImageUp className="size-6 text-muted-foreground" aria-hidden="true" />
        )}
      </div>
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <FileTrigger acceptedFileTypes={Object.keys(LOGO_TYPES)} onSelect={onFiles}>
            <Button variant="secondary" isPending={upload.isPending}>
              <ImageUp className="size-4" aria-hidden="true" />
              {url ? `Replace ${copy.name}` : `Upload ${copy.name}`}
            </Button>
          </FileTrigger>
          {url ? (
            <Button variant="ghost" isPending={remove.isPending} onPress={() => remove.mutate()}>
              <Trash2 className="size-4" aria-hidden="true" />
              Remove
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function BrandKitForm({ kit, readOnly }: { kit: BrandKit; readOnly: boolean }) {
  const [values, setValues] = useState<Values>({
    businessName: kit.businessName,
    accentColor: kit.accentColor,
    font: kit.font,
    address: kit.address,
    taxId: kit.taxId,
    contactEmail: kit.contactEmail,
    contactPhone: kit.contactPhone,
    website: kit.website,
    bankDetails: kit.bankDetails,
    footerText: kit.footerText,
    signatureName: kit.signatureName,
    signatureTitle: kit.signatureTitle,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const update = useUpdateBrandKit();
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
            <BrandImageField
              image="logo"
              url={kit.logoUrl}
              readOnly={readOnly}
              boxClassName="size-20"
            />
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
              <fieldset className="m-0 min-w-0 border-0 p-0 sm:col-span-2">
                <legend className="float-left w-full p-0 text-sm font-medium text-ink">
                  Contact
                </legend>
                <p className="clear-both m-0 pt-1 text-xs text-muted-foreground">
                  Prints in the document header, under the address. Leave a field empty to leave it
                  out.
                </p>
                <div className="mt-3 grid gap-4 sm:grid-cols-3">
                  <TextField
                    label="Email"
                    type="email"
                    isDisabled={readOnly}
                    placeholder="billing@studio.example"
                    value={values.contactEmail ?? ""}
                    onChange={(text) => set("contactEmail", text)}
                    {...fieldError(errors, "contactEmail")}
                  />
                  <TextField
                    label="Phone"
                    type="tel"
                    isDisabled={readOnly}
                    placeholder="+880 1700 000000"
                    value={values.contactPhone ?? ""}
                    onChange={(text) => set("contactPhone", text)}
                    {...fieldError(errors, "contactPhone")}
                  />
                  <TextField
                    label="Website"
                    isDisabled={readOnly}
                    placeholder="studio.example"
                    value={values.website ?? ""}
                    onChange={(text) => set("website", text)}
                    {...fieldError(errors, "website")}
                  />
                </div>
              </fieldset>
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

          <Section
            title="Signature"
            description="Prints in the Signature section, above the footer. Use a PNG with a transparent background, up to 1 MB. New templates show it. For a template made before this release, turn on the Signature section in the template editor."
          >
            <div className="flex flex-col gap-4">
              <BrandImageField
                image="signature"
                url={kit.signatureUrl}
                readOnly={readOnly}
                boxClassName="h-20 w-48"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Signer name"
                  isDisabled={readOnly}
                  value={values.signatureName ?? ""}
                  onChange={(text) => set("signatureName", text)}
                  description="Without a name, the line says Authorized signature."
                  {...fieldError(errors, "signatureName")}
                />
                <TextField
                  label="Signer title"
                  isDisabled={readOnly}
                  value={values.signatureTitle ?? ""}
                  onChange={(text) => set("signatureTitle", text)}
                  placeholder="Director"
                  {...fieldError(errors, "signatureTitle")}
                />
              </div>
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
                {values.contactEmail || values.contactPhone || values.website ? (
                  <span className="text-xs break-words text-muted-foreground">
                    {[values.contactEmail, values.contactPhone, values.website]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
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
