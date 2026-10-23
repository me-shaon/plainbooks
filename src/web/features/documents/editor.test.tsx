import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateTotals } from "../../../shared/money";
import type { ClientDetail } from "../../../shared/schemas/client";
import type { DocumentDetail, SendPreview } from "../../../shared/schemas/document";
import type { TaxRate } from "../../../shared/schemas/tax-rate";
import { Toaster, toastQueue } from "../../components/ui/toast";
import { formatMoney } from "../../lib/format";
import { DocumentEditor, type DocumentEditorProps } from "./document-editor";
import { EditDocumentPage } from "./editor-page";
import { emptyValues, newLine } from "./editor-state";
import { SendDialog } from "./send-dialog";

const VAT: TaxRate = { id: "vat", name: "VAT", rate: "15", note: null, archivedAt: null };

const CLIENT: ClientDetail = {
  client: {
    id: "c1",
    name: "Northwind",
    billingAddress: null,
    taxId: null,
    defaultCurrency: "USD",
    defaultTaxRateId: "vat",
    paymentTermsDays: 30,
    templateId: null,
    reminderMode: "inherit",
    recurringSendMode: "inherit",
    notes: null,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
  },
  contacts: [],
  documents: [],
  payments: [],
  schedules: [],
  outstanding: [],
};

function sentInvoice(overrides: Partial<DocumentDetail> = {}): DocumentDetail {
  return {
    id: "d1",
    kind: "invoice",
    status: "sent",
    displayStatus: "sent",
    number: "INV-0001",
    clientId: "c1",
    clientName: "Northwind",
    currency: "BDT",
    issueDate: "2026-10-20",
    dueDate: "2026-11-03",
    expiryDate: null,
    total: 200000,
    amountPaid: 0,
    balance: 200000,
    isOverdue: false,
    updatedAt: 1,
    paymentTermsDays: 14,
    discount: { type: "none" },
    notes: null,
    footerText: null,
    templateId: null,
    reminderMode: "inherit",
    fx: { rate: "1", rateDate: "2026-10-20", provider: "identity", overridden: false },
    publicToken: "tok",
    currentRevisionId: "r1",
    revisionCount: 1,
    subtotal: 200000,
    discountTotal: 0,
    taxTotal: 0,
    sourceQuoteId: null,
    convertedInvoiceId: null,
    decidedAt: null,
    decisionComment: null,
    finalizedAt: 1,
    sentAt: 1,
    paidAt: null,
    voidedAt: null,
    lines: [
      {
        id: "l1",
        position: 0,
        description: "Design",
        quantity: "1",
        unitPrice: 200000,
        taxRateId: null,
      },
    ],
    payments: [],
    customFields: [],
    ...overrides,
  };
}

const PREVIEW: SendPreview = {
  recipients: ["ap@northwind.test"],
  subject: "Invoice INV-0001 from Studio One",
  emailConfigured: true,
  emailsSentToday: 2,
  dailyLimit: 100,
  issueDate: "2026-10-20",
  homeCurrency: "BDT",
  fx: null,
};

type Handler = (url: URL, init: RequestInit | undefined) => Response | undefined;

/** Stubs fetch. The first handler that returns a Response answers the call. */
function stubFetch(...handlers: Handler[]) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://app.test");
    for (const handler of handlers) {
      const res = handler(url, init);
      if (res) return res;
    }
    return Response.json({ error: `unexpected ${url.pathname}` }, { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const route =
  (method: string, path: string, body: unknown, status = 200): Handler =>
  (url, init) =>
    url.pathname === path && (init?.method ?? "GET") === method
      ? Response.json(body, { status })
      : undefined;

function withQuery(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderEditor(props: Partial<DocumentEditorProps> = {}) {
  const values = emptyValues("invoice", "USD");
  values.clientId = "c1";
  values.lines = [{ ...newLine("vat") }];
  const onSave = vi.fn(async () => undefined);
  render(
    withQuery(
      <DocumentEditor
        mode="create"
        title="New invoice"
        initialValues={values}
        clients={[
          {
            id: "c1",
            name: "Northwind",
            defaultCurrency: "USD",
            primaryEmail: null,
            archivedAt: null,
            outstanding: [],
          },
        ]}
        taxRates={[VAT]}
        templates={[]}
        customFieldDefs={[]}
        isOwner
        defaults={{
          homeCurrency: "BDT",
          paymentTermsDays: 14,
          quoteValidityDays: 30,
          taxRateId: "vat",
          templateId: null,
        }}
        today="2026-10-24"
        loadClient={async () => CLIENT}
        onSave={onSave}
        onCancel={() => undefined}
        {...props}
      />,
    ),
  );
  return { onSave };
}

const field = (name: RegExp) => screen.getByRole("textbox", { name }) as HTMLInputElement;

beforeEach(() => {
  stubFetch(
    route("GET", "/api/fx/rate", {
      status: "ok",
      rate: "122.5",
      rateDate: "2026-10-23",
      provider: "frankfurter",
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const t of toastQueue.visibleToasts) toastQueue.close(t.key);
});

describe("DocumentEditor", () => {
  it("shows the totals that calculateTotals returns as lines are added", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.type(field(/^Description.*line 1/), "Design");
    await user.clear(field(/^Quantity.*line 1/));
    await user.type(field(/^Quantity.*line 1/), "2");
    await user.type(field(/^Unit price.*line 1/), "100.50");
    await user.click(screen.getByRole("button", { name: "Add line" }));
    await user.clear(field(/^Quantity.*line 2/));
    await user.type(field(/^Quantity.*line 2/), "3");
    await user.type(field(/^Unit price.*line 2/), "19.99");

    const expected = calculateTotals({
      currency: "USD",
      lines: [
        { quantity: "2", unitPrice: 10050, tax: { id: "vat", rate: "15" } },
        { quantity: "3", unitPrice: 1999, tax: { id: "vat", rate: "15" } },
      ],
    });
    const totals = within(screen.getByLabelText("Totals"));
    expect(totals.getByText(formatMoney(expected.subtotal, "USD"))).toBeTruthy();
    expect(totals.getByText(formatMoney(expected.taxTotal, "USD"))).toBeTruthy();
    expect(totals.getByText(formatMoney(expected.total, "USD"))).toBeTruthy();
    expect(screen.getByTestId("line-amount-2").textContent).toBe(formatMoney(5997, "USD"));
  });

  it("removes decimals from the amount fields after a switch to JPY", async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.type(field(/^Unit price.*line 1/), "1500.50");

    await user.click(screen.getByRole("button", { name: /^USD Currency/ }));
    await user.click(await screen.findByRole("option", { name: "JPY" }));

    const price = field(/^Unit price \(JPY\).*line 1/);
    expect(price.value).toBe("1500");
    expect(price.getAttribute("inputmode")).toBe("numeric");
    await user.type(price, ".7");
    expect(price.value).toBe("15007");
  });

  it("tells a Member that only an Owner can turn on auto-send", async () => {
    const user = userEvent.setup();
    renderEditor({ isOwner: false });
    expect(screen.getByText("Only an Owner can turn on auto-send")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Reminders/ }));
    const option = await screen.findByRole("option", { name: "Auto-send reminders" });
    expect(option.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("SendDialog", () => {
  it("shows Retry when Resend rejects the email, and the document stays Ready to send", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch(
      route("GET", "/api/documents/d1/send-preview", PREVIEW),
      route(
        "POST",
        "/api/documents/d1/send",
        { error: "The email was not sent: provider unavailable", code: "email_send_failed" },
        502,
      ),
    );
    const doc = sentInvoice({ status: "draft", displayStatus: "draft", number: null });
    render(withQuery(<SendDialog isOpen onOpenChange={() => undefined} document={doc} />));

    expect(await screen.findByDisplayValue("ap@northwind.test")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByText(/stays Ready to send/)).toBeTruthy();
    expect(screen.getByText("The email was not sent: provider unavailable")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/documents/d1/send")),
      ).toHaveLength(2),
    );
  });
});

describe("Revise", () => {
  it("keeps the edits and shows a toast when the server rejects the revision", async () => {
    const user = userEvent.setup();
    const reviseCalls: unknown[] = [];
    stubFetch(
      route("GET", "/api/documents/d1", sentInvoice()),
      route("GET", "/api/documents/d1/send-preview", PREVIEW),
      route("GET", "/api/me", {
        user: { id: "u1", email: "m@studio.test", name: null, role: "member" },
      }),
      route("GET", "/api/clients", { items: [] }),
      route("GET", "/api/clients/c1", {
        ...CLIENT,
        client: { ...CLIENT.client, defaultCurrency: "BDT" },
      }),
      route("GET", "/api/tax-rates", { items: [VAT] }),
      route("GET", "/api/templates", { items: [] }),
      route("GET", "/api/custom-fields", { items: [] }),
      route("GET", "/api/settings/workspace", {
        homeCurrency: "BDT",
        timezone: "Asia/Dhaka",
        defaultPaymentTermsDays: 14,
        defaultQuoteValidityDays: 30,
        defaultTaxRateId: null,
        defaultTemplateId: null,
      }),
      (url, init) => {
        if (url.pathname !== "/api/documents/d1/revise") return undefined;
        reviseCalls.push(JSON.parse(String(init?.body)));
        return Response.json(
          { error: "A payment was recorded. Reload the invoice.", code: "revise_has_payments" },
          { status: 409 },
        );
      },
    );

    const rootRoute = createRootRoute({
      component: () => (
        <>
          <Outlet />
          <Toaster />
        </>
      ),
    });
    const editRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <EditDocumentPage documentId="d1" />,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([editRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(withQuery(<RouterProvider router={router as never} />));

    const description = (await screen.findByRole("textbox", {
      name: /^Description.*line 1/,
    })) as HTMLInputElement;
    expect(screen.getByRole("heading", { name: "Revise Invoice INV-0001" })).toBeTruthy();
    await user.clear(description);
    await user.type(description, "Design, revised scope");

    await user.click(screen.getByRole("button", { name: "Save revision" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("checkbox", { name: "Email the updated invoice" }),
    ).toBeTruthy();
    await user.click(await within(dialog).findByRole("button", { name: "Save and email" }));

    expect(await screen.findByText("A payment was recorded. Reload the invoice.")).toBeTruthy();
    expect(reviseCalls).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      (screen.getByRole("textbox", { name: /^Description.*line 1/ }) as HTMLInputElement).value,
    ).toBe("Design, revised scope");
  });
});
