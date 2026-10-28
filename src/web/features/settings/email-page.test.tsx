import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  EmailProviderOption,
  EmailProviderView,
  EmailSettings,
} from "../../../shared/schemas/email-settings";
import { EmailSettingsView } from "./email-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const apiKeyField = (pattern: string) => ({
  name: "apiKey",
  label: "API key",
  secret: true,
  required: true,
  pattern,
});

const providers: EmailProviderOption[] = [
  {
    id: "resend",
    name: "Resend",
    docsUrl: "https://resend.com/docs",
    credentialFields: [apiKeyField("^re_")],
    presets: [],
    configFields: [],
    webhookSecret: { label: "Signing secret", hint: "Starts with whsec_." },
    defaultDailyCap: 100,
  },
  {
    id: "tosend",
    name: "toSend",
    docsUrl: "https://tosend.com/docs",
    credentialFields: [apiKeyField("^tsend_")],
    presets: [],
    configFields: [],
    webhookSecret: { label: "Webhook signing secret", hint: "Copy it from toSend." },
    defaultDailyCap: null,
  },
  {
    id: "mailchannels",
    name: "MailChannels",
    docsUrl: "https://example.com/mailchannels",
    credentialFields: [apiKeyField("^.+$")],
    presets: [],
    configFields: [
      {
        name: "customerHandle",
        label: "Customer handle",
        hint: "The customer handle of your account.",
        required: true,
        multiline: false,
      },
    ],
    webhookSecret: { label: "Webhook public key", hint: "From MailChannels." },
    defaultDailyCap: null,
  },
  {
    id: "smtp",
    name: "SMTP",
    docsUrl: "https://example.com/smtp",
    credentialFields: [
      {
        name: "preset",
        label: "Service",
        secret: false,
        required: false,
        defaultValue: "custom",
        options: [
          { value: "gmail", label: "Gmail" },
          { value: "custom", label: "Custom server" },
        ],
      },
      { name: "host", label: "SMTP host", secret: false, required: true },
      { name: "port", label: "Port", secret: false, required: false },
      { name: "username", label: "User name", secret: false, required: false },
      { name: "password", label: "Password", secret: true, required: false },
    ],
    presets: [
      {
        id: "gmail",
        name: "Gmail",
        fixed: { preset: "gmail", host: "smtp.gmail.com", port: "587" },
        fieldHints: { password: { label: "App password" } },
        defaultDailyCap: 500,
      },
      { id: "custom", name: "Custom server", fixed: { preset: "custom" } },
    ],
    configFields: [],
    webhookSecret: null,
    defaultDailyCap: null,
  },
];

function view(overrides: Partial<EmailProviderView> = {}): EmailProviderView {
  return {
    role: "primary",
    providerId: "tosend",
    presetId: null,
    dailyCap: null,
    defaultDailyCap: null,
    updatedAt: 1,
    configured: true,
    needsReentry: false,
    config: {},
    values: {},
    secrets: { apiKey: true },
    webhookSecretConfigured: true,
    ...overrides,
  };
}

function settings(primary: EmailProviderView | null = null): EmailSettings {
  return {
    providers,
    defaultProviderId: "tosend",
    settings: { primary, fallback: null },
    webhookUrls: {
      primary: "https://app.example/api/webhooks/email/primary",
      fallback: "https://app.example/api/webhooks/email/fallback",
    },
  };
}

function renderView(data: EmailSettings) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EmailSettingsView data={data} />
    </QueryClientProvider>,
  );
}

function primaryForm() {
  return within(screen.getByRole("form", { name: "Primary provider" }));
}

describe("EmailSettingsView", () => {
  it("preselects toSend on a fresh install and shows its webhook URL", () => {
    renderView(settings());
    const form = primaryForm();
    expect(form.getByRole("button", { name: /Provider/ }).textContent).toContain("toSend");
    expect((form.getByRole("textbox", { name: "Webhook URL" }) as HTMLInputElement).value).toBe(
      "https://app.example/api/webhooks/email/primary",
    );
    expect(form.getByRole("button", { name: "Copy webhook URL" })).toBeTruthy();
    expect(form.queryByText(/^Saved\./)).toBeNull();
    expect(screen.getByRole("button", { name: "Add fallback" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Send test email" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("never prefills a saved secret and says it is saved", () => {
    renderView(settings(view()));
    const form = primaryForm();
    const key = form.getByLabelText(/API key/) as HTMLInputElement;
    expect(key.value).toBe("");
    expect(key.type).toBe("password");
    expect(key.placeholder).toBe("Saved. Enter a new value to replace it.");
    expect(form.getByText("Saved. Copy it from toSend.")).toBeTruthy();
  });

  it("shows the verify failure in a banner and keeps the form", async () => {
    const fetchSpy = vi.fn(async () =>
      Response.json(
        {
          error: "The provider refused the keys. Check them and try again.",
          code: "email_verify_failed",
        },
        { status: 422 },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    renderView(settings());
    const form = primaryForm();
    await user.type(form.getByLabelText(/API key/), "tsend_wrong");
    await user.click(form.getByRole("button", { name: "Save primary" }));

    const alert = await form.findByRole("alert");
    expect(alert.textContent).toContain("The provider refused the keys");
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/settings/email/primary");
    expect(JSON.parse(String(init.body))).toEqual({
      providerId: "tosend",
      presetId: null,
      credentials: { apiKey: "tsend_wrong" },
      dailyCap: null,
    });
  });

  it("shows the saved config of a provider and sends it with the save", async () => {
    const fetchSpy = vi.fn(async () => Response.json(view({ providerId: "mailchannels" })));
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    renderView(
      settings(view({ providerId: "mailchannels", config: { customerHandle: "studio-one" } })),
    );
    const form = primaryForm();
    const handle = form.getByLabelText(/Customer handle/) as HTMLInputElement;
    expect(handle.value).toBe("studio-one");
    await user.clear(handle);
    await user.type(handle, "studio-two");
    await user.click(form.getByRole("button", { name: "Save primary" }));

    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      providerId: "mailchannels",
      config: { customerHandle: "studio-two" },
    });
  });

  it("shows parseCredentials errors next to the field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "Check these fields: apiKey",
            code: "invalid_credentials",
            issues: [{ path: "credentials.apiKey", message: "pattern" }],
          },
          { status: 400 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderView(settings());
    const form = primaryForm();
    await user.type(form.getByLabelText(/API key/), "bad");
    await user.click(form.getByRole("button", { name: "Save primary" }));
    expect(await form.findByText("Check the format of this value")).toBeTruthy();
  });

  it("shows SMTP preset values read-only with the preset cap as the placeholder", () => {
    renderView(
      settings(
        view({
          providerId: "smtp",
          presetId: "gmail",
          values: { preset: "gmail", host: "smtp.gmail.com", port: "587", username: "a@b.co" },
          secrets: { password: true },
          defaultDailyCap: 500,
          webhookSecretConfigured: false,
        }),
      ),
    );
    const form = primaryForm();
    const host = form.getByRole("textbox", { name: "SMTP host" }) as HTMLInputElement;
    expect(host.value).toBe("smtp.gmail.com");
    expect(host.readOnly).toBe(true);
    expect(form.getByLabelText(/App password/)).toBeTruthy();
    expect(form.queryByRole("textbox", { name: "Webhook URL" })).toBeNull();
    const cap = form.getByRole("textbox", { name: /Daily cap/ }) as HTMLInputElement;
    expect(cap.placeholder).toBe("500");
    expect(cap.value).toBe("");
  });

  it("asks before a provider switch replaces the saved keys", async () => {
    const fetchSpy = vi.fn(async () => Response.json(view({ providerId: "resend" })));
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    renderView(settings(view()));
    const form = primaryForm();
    await user.click(form.getByRole("button", { name: /Provider/ }));
    await user.click(await screen.findByRole("option", { name: "Resend" }));
    await user.type(form.getByLabelText(/API key/), "re_new_key");
    await user.click(form.getByRole("button", { name: "Save primary" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("This replaces toSend");
    expect(fetchSpy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Switch to Resend" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
