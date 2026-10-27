import { CircleAlert, Copy, ExternalLink, Mail, Plus, Send } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Form } from "react-aria-components";
import type { EmailProviderRole } from "../../../shared/domain";
import type {
  EmailCredentialField,
  EmailProviderInput,
  EmailProviderOption,
  EmailProviderPreset,
  EmailProviderView,
  EmailSettings,
} from "../../../shared/schemas/email-settings";
import { Button } from "../../components/ui/button";
import { AlertDialog } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { ListBoxItem } from "../../components/ui/list-box";
import { NumberField } from "../../components/ui/number-field";
import { Section } from "../../components/ui/section";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { TextField } from "../../components/ui/text-field";
import { toast } from "../../components/ui/toast";
import { ApiError, issuesByPath, toastError } from "../../lib/api";
import { type FieldErrors, fieldError } from "../../lib/form";
import { useMe } from "../../lib/session";
import {
  useEmailSettings,
  useRemoveEmailFallback,
  useSaveEmailProvider,
  useSendTestEmail,
} from "./queries";
import { SaveBar } from "./settings-layout";

/** Readable text for the `parseCredentials` error codes. */
const CREDENTIAL_ERROR_TEXT: Record<string, string> = {
  required: "Enter a value",
  pattern: "Check the format of this value",
  option: "Choose one of the options",
  type: "Enter text",
};

/** Error codes that the form shows in its banner, not as a toast. */
const BANNER_CODES = new Set(["email_verify_failed", "same_email_account", "primary_required"]);

const ROLE_TEXT: Record<EmailProviderRole, { title: string; description: string }> = {
  primary: {
    title: "Primary provider",
    description: "All app email goes through this provider.",
  },
  fallback: {
    title: "Fallback provider",
    description:
      "Optional. The app uses it only when the primary provider does not accept an email.",
  },
};

export function EmailSettingsPage() {
  const { isOwner, isPending } = useMe();
  const settings = useEmailSettings(isOwner);
  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (!isOwner) {
    return (
      <EmptyState
        icon={Mail}
        title="Only an Owner can set up email"
        description="Ask an Owner to change the email provider."
      />
    );
  }
  if (settings.isPending) return <Skeleton className="h-96 w-full" />;
  if (settings.isError) return null;
  return <EmailSettingsView data={settings.data} />;
}

export function EmailSettingsView({ data }: { data: EmailSettings }) {
  const { primary, fallback } = data.settings;
  const [addingFallback, setAddingFallback] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <ProviderForm
        key={JSON.stringify(primary)}
        providerRole="primary"
        data={data}
        saved={primary}
      />
      {fallback || addingFallback ? (
        <ProviderForm
          key={JSON.stringify(fallback)}
          providerRole="fallback"
          data={data}
          saved={fallback}
          onCancel={fallback ? undefined : () => setAddingFallback(false)}
        />
      ) : (
        <Section
          title={ROLE_TEXT.fallback.title}
          description={ROLE_TEXT.fallback.description}
          actions={
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!primary}
              onPress={() => setAddingFallback(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add fallback
            </Button>
          }
        >
          <p className="m-0 text-sm text-muted-foreground">
            {primary
              ? "No fallback provider is set."
              : "Save a primary provider before you add a fallback."}
          </p>
        </Section>
      )}
      <TestEmailSection primary={primary} fallback={fallback} />
    </div>
  );
}

/** A role-alert banner, for a failed check or a problem with the saved keys. */
function Banner({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="m-0 flex items-start gap-2 rounded-button bg-danger-tint px-3 py-2.5 text-[13px] text-danger-tint-foreground"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The preset a provider form starts with: the saved one, then "custom", then the first. */
function initialPreset(provider: EmailProviderOption, saved: EmailProviderView | null) {
  if (provider.presets.length === 0) return null;
  if (saved?.providerId === provider.id && saved.presetId) return saved.presetId;
  return (provider.presets.find((p) => p.id === "custom") ?? provider.presets[0])?.id ?? null;
}

/**
 * True for a field that only repeats the preset choice, such as the SMTP `preset` field.
 * Every preset fixes it to the preset ID, so the preset select replaces it.
 */
function isPresetField(provider: EmailProviderOption, field: EmailCredentialField): boolean {
  return provider.presets.length > 0 && provider.presets.every((p) => p.fixed[field.name] === p.id);
}

function defaultCapOf(provider: EmailProviderOption, preset: EmailProviderPreset | undefined) {
  return preset?.defaultDailyCap ?? provider.defaultDailyCap;
}

function ProviderForm({
  providerRole: role,
  data,
  saved,
  onCancel,
}: {
  providerRole: EmailProviderRole;
  data: EmailSettings;
  saved: EmailProviderView | null;
  onCancel?: () => void;
}) {
  const providers = data.providers;
  const startId = saved?.providerId ?? data.defaultProviderId;
  const [providerId, setProviderId] = useState(
    providers.some((p) => p.id === startId) ? startId : (providers[0]?.id ?? ""),
  );
  const provider = providers.find((p) => p.id === providerId) ?? providers[0];
  const [presetId, setPresetId] = useState(() =>
    provider ? initialPreset(provider, saved) : null,
  );
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...(saved?.values ?? {}),
  }));
  const [webhookSecret, setWebhookSecret] = useState("");
  const [dailyCap, setDailyCap] = useState<number | null>(saved?.dailyCap ?? null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const save = useSaveEmailProvider();
  const remove = useRemoveEmailFallback();

  if (!provider) return null;
  const sameProvider = saved?.providerId === provider.id && !saved.needsReentry;
  const preset = provider.presets.find((p) => p.id === presetId);
  const fields = provider.credentialFields.filter((field) => !isPresetField(provider, field));
  const defaultCap = defaultCapOf(provider, preset);
  const savedName = providers.find((p) => p.id === saved?.providerId)?.name ?? "the saved provider";

  const changeProvider = (id: string) => {
    const next = providers.find((p) => p.id === id);
    if (!next) return;
    setProviderId(id);
    setPresetId(initialPreset(next, saved));
    setValues(saved?.providerId === id ? { ...saved.values } : {});
    setWebhookSecret("");
    setErrors({});
    setBanner(null);
  };

  const input = (): EmailProviderInput => {
    const credentials: Record<string, string> = {};
    for (const field of fields) {
      if (preset?.fixed[field.name] !== undefined) continue;
      const value = values[field.name] ?? field.defaultValue ?? "";
      if (value !== "") credentials[field.name] = value;
    }
    return {
      providerId: provider.id,
      presetId: preset?.id ?? null,
      credentials,
      dailyCap,
      // Undefined keeps the saved secret. A new provider starts with none.
      ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
    };
  };

  const submit = async () => {
    setErrors({});
    setBanner(null);
    try {
      await save.mutateAsync({ role, input: input() });
      toast({ title: `${ROLE_TEXT[role].title} saved`, tone: "success" });
    } catch (err) {
      if (err instanceof ApiError && err.code && BANNER_CODES.has(err.code)) {
        setBanner(err.message);
        return;
      }
      const issues = issuesByPath(err);
      if (Object.keys(issues).length > 0) {
        const mapped: FieldErrors = {};
        for (const [path, message] of Object.entries(issues)) {
          mapped[path] = CREDENTIAL_ERROR_TEXT[message] ?? message;
        }
        setErrors(mapped);
      } else {
        toastError(err, "Could not save the email provider");
      }
    }
  };

  const copyWebhookUrl = async () => {
    const url = data.webhookUrls[role];
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Webhook URL copied", description: url, tone: "success" });
    } catch {
      toast({ title: "Copy this URL", description: url });
    }
  };

  const fieldId = (name: string) => `email-${role}-${name}`;

  return (
    <Section
      title={ROLE_TEXT[role].title}
      description={ROLE_TEXT[role].description}
      actions={
        role === "fallback" && saved ? (
          <Button size="sm" variant="secondary" onPress={() => setRemoving(true)}>
            Remove fallback
          </Button>
        ) : null
      }
    >
      <Form
        validationBehavior="aria"
        className="flex flex-col gap-5"
        aria-label={ROLE_TEXT[role].title}
        onSubmit={(event) => {
          event.preventDefault();
          if (saved && saved.providerId !== provider.id) setConfirming(true);
          else void submit();
        }}
      >
        {saved?.needsReentry ? (
          <Banner>The saved keys cannot be read. Enter them again and save.</Banner>
        ) : null}
        {banner ? <Banner>{banner}</Banner> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Provider"
            value={provider.id}
            onChange={(key) => key !== null && changeProvider(String(key))}
            description={
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2"
              >
                {provider.name} documentation
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            }
          >
            {providers.map((option) => (
              <ListBoxItem key={option.id} id={option.id}>
                {option.name}
              </ListBoxItem>
            ))}
          </Select>
          {provider.presets.length > 0 ? (
            <Select
              label="Service"
              value={presetId ?? undefined}
              onChange={(key) => key !== null && setPresetId(String(key))}
            >
              {provider.presets.map((option) => (
                <ListBoxItem key={option.id} id={option.id}>
                  {option.name}
                </ListBoxItem>
              ))}
            </Select>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => {
            const hint = preset?.fieldHints?.[field.name];
            const label = hint?.label ?? field.label;
            const description = hint?.hint ?? field.hint;
            const fixed = preset?.fixed[field.name];
            const error = fieldError(errors, `credentials.${field.name}`);
            if (fixed !== undefined) {
              return (
                <TextField
                  key={field.name}
                  id={fieldId(field.name)}
                  label={label}
                  value={fixed}
                  isReadOnly
                  description={`Set by the ${preset?.name} preset.`}
                />
              );
            }
            if (field.options) {
              return (
                <Select
                  key={field.name}
                  label={label}
                  value={values[field.name] ?? field.defaultValue ?? field.options[0]?.value}
                  onChange={(key) =>
                    key !== null && setValues({ ...values, [field.name]: String(key) })
                  }
                  description={description}
                  {...error}
                >
                  {field.options.map((option) => (
                    <ListBoxItem key={option.value} id={option.value}>
                      {option.label}
                    </ListBoxItem>
                  ))}
                </Select>
              );
            }
            const savedSecret = field.secret && sameProvider && Boolean(saved?.secrets[field.name]);
            return (
              <TextField
                key={field.name}
                id={fieldId(field.name)}
                label={label}
                type={field.secret ? "password" : "text"}
                autoComplete={field.secret ? "new-password" : "off"}
                isRequired={field.required && !savedSecret}
                value={values[field.name] ?? ""}
                onChange={(text) => setValues({ ...values, [field.name]: text })}
                placeholder={
                  savedSecret
                    ? "Saved. Enter a new value to replace it."
                    : (hint?.placeholder ?? field.placeholder ?? field.defaultValue)
                }
                description={savedSecret ? joinText("Saved.", description) : description}
                {...error}
              />
            );
          })}
        </div>

        {provider.webhookSecret ? (
          <div className="flex flex-col gap-4 border-t border-row-border pt-5">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-end gap-2">
                <TextField
                  className="min-w-0 flex-1"
                  label="Webhook URL"
                  value={data.webhookUrls[role]}
                  isReadOnly
                  aria-describedby={`${fieldId("webhook-url")}-hint`}
                  inputClassName="figure text-[13px]"
                />
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label="Copy webhook URL"
                  onPress={() => void copyWebhookUrl()}
                >
                  <Copy className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <p
                id={`${fieldId("webhook-url")}-hint`}
                className="m-0 text-xs text-muted-foreground"
              >
                Give this URL to {provider.name} for bounce and complaint events.
              </p>
            </div>
            <TextField
              label={provider.webhookSecret.label}
              type={provider.id === "ses" ? "text" : "password"}
              autoComplete={provider.id === "ses" ? "off" : "new-password"}
              value={webhookSecret}
              onChange={setWebhookSecret}
              placeholder={
                sameProvider && saved?.webhookSecretConfigured
                  ? "Saved. Enter a new value to replace it."
                  : provider.webhookSecret.placeholder
              }
              description={
                sameProvider && saved?.webhookSecretConfigured
                  ? joinText("Saved.", provider.webhookSecret.hint)
                  : provider.webhookSecret.hint
              }
              {...fieldError(errors, "webhookSecret")}
            />
          </div>
        ) : null}

        <NumberField
          className="sm:max-w-xs"
          label="Daily cap (optional)"
          minValue={1}
          step={1}
          formatOptions={{ maximumFractionDigits: 0, useGrouping: false }}
          value={dailyCap ?? Number.NaN}
          onChange={(n) => setDailyCap(Number.isNaN(n) ? null : n)}
          placeholder={defaultCap === null ? "No limit" : String(defaultCap)}
          description={
            defaultCap === null
              ? "The most emails this provider sends in 24 hours. Leave it empty for no limit."
              : `The most emails this provider sends in 24 hours. Leave it empty to use ${defaultCap}.`
          }
          {...fieldError(errors, "dailyCap")}
        />

        <SaveBar>
          {save.isPending ? (
            <span
              role="status"
              className="self-center text-[13px] text-muted-foreground sm:mr-auto"
            >
              Checking the keys with {provider.name}...
            </span>
          ) : null}
          {onCancel ? (
            <Button variant="secondary" onPress={onCancel} isDisabled={save.isPending}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" isPending={save.isPending}>
            Save {role === "primary" ? "primary" : "fallback"}
          </Button>
        </SaveBar>
      </Form>

      <AlertDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={`Switch to ${provider.name}?`}
        actionLabel={`Switch to ${provider.name}`}
        onAction={() => void submit()}
      >
        This replaces {savedName} and removes its saved keys and webhook secret.
      </AlertDialog>
      <AlertDialog
        isOpen={removing}
        onOpenChange={setRemoving}
        title="Remove the fallback provider?"
        actionLabel="Remove"
        variant="danger"
        onAction={() =>
          remove.mutate(undefined, {
            onSuccess: () => toast({ title: "Fallback removed", tone: "success" }),
          })
        }
      >
        The saved keys are removed. Email then goes only through the primary provider.
      </AlertDialog>
    </Section>
  );
}

function joinText(first: string, second: string | undefined): string {
  return second ? `${first} ${second}` : first;
}

function TestEmailSection({
  primary,
  fallback,
}: {
  primary: EmailProviderView | null;
  fallback: EmailProviderView | null;
}) {
  const test = useSendTestEmail();
  const [pendingRole, setPendingRole] = useState<EmailProviderRole | null>(null);

  const send = async (role: EmailProviderRole) => {
    setPendingRole(role);
    try {
      const result = await test.mutateAsync(role);
      if (result.status === "sent") {
        toast({
          title: "Test email sent",
          description: `Check the inbox of ${result.to}.`,
          tone: "success",
        });
      } else if (result.status === "unknown") {
        toast({
          title: "The provider did not confirm the test email",
          description: `${result.message}. Check the inbox of ${result.to} before you try again.`,
          tone: "danger",
        });
      } else {
        toast({ title: "Test email not sent", description: result.message, tone: "danger" });
      }
    } catch (err) {
      toastError(err, "Test email not sent");
    } finally {
      setPendingRole(null);
    }
  };

  return (
    <Section
      title="Test email"
      description="Sends a short email to your address from the sender email in General settings."
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          isDisabled={!primary || primary.needsReentry || pendingRole === "fallback"}
          isPending={pendingRole === "primary"}
          onPress={() => void send("primary")}
        >
          <Send className="size-4" aria-hidden="true" />
          Send test email
        </Button>
        {fallback ? (
          <Button
            variant="secondary"
            isDisabled={fallback.needsReentry || pendingRole === "primary"}
            isPending={pendingRole === "fallback"}
            onPress={() => void send("fallback")}
          >
            Test the fallback
          </Button>
        ) : null}
      </div>
    </Section>
  );
}
