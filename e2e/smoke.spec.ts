import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const RUN = Date.now().toString(36);
const CLIENT = `Smoke Client ${RUN}`;
const CONTACT_EMAIL = `billing-${RUN}@example.com`;

/** Fails on serious or critical axe violations and prints them for the log. */
async function expectNoSeriousA11yIssues(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  const summary = serious.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
  expect(summary, `axe on ${label}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("quote to paid invoice", async ({ page, browser, request }) => {
  // The sender address is a prerequisite for email.
  const settings = await request.patch("/api/settings/workspace", {
    data: { emailFromAddress: "billing@example.com" },
  });
  expect(settings.ok()).toBe(true);

  await test.step("create a client", async () => {
    await page.goto("/clients");
    await page.getByRole("button", { name: "New client" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New client" });
    await dialog.getByRole("textbox", { name: "Client name" }).fill(CLIENT);
    await dialog.getByRole("combobox", { name: "Default currency" }).fill("USD");
    await page.getByRole("option", { name: /^USD/ }).first().click();
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Rahim Uddin");
    await dialog.getByRole("textbox", { name: "Email", exact: true }).fill(CONTACT_EMAIL);
    await dialog.getByRole("button", { name: "Create client" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("create a quote and send it", async () => {
    await page.goto("/quotes/new");
    await page.getByRole("combobox", { name: "Client" }).fill(CLIENT);
    await page.getByRole("option", { name: CLIENT }).click();
    await expect(page.getByRole("button", { name: /USD Currency/ })).toBeVisible();
    await page.getByRole("textbox", { name: "Description , line 1" }).fill("Website redesign");
    await page.getByRole("textbox", { name: "Quantity , line 1" }).fill("2");
    await page.getByRole("textbox", { name: /Unit price \(USD\) , line 1/ }).fill("500");
    await expect(page.getByText("USD 1,000.00").first()).toBeVisible();
    await page.getByRole("button", { name: "Save and send" }).click();

    const send = page.getByRole("dialog", { name: /^Send/ });
    await expect(send).toBeVisible();
    await expect(send.getByRole("textbox", { name: "Recipient 1" })).toHaveValue(CONTACT_EMAIL);
    await send.getByRole("button", { name: /^Send/ }).click();
    await expect(send).toBeHidden();
    await expect(page.getByText("Sent").first()).toBeVisible();
  });

  /** Reads the public link from the "Copy public link" toast. */
  async function publicLink(): Promise<string> {
    await page.getByRole("button", { name: "Copy public link" }).click();
    const text = await page
      .getByText(/\/p\/[A-Za-z0-9_-]+/)
      .first()
      .textContent();
    const match = text?.match(/https?:\/\/\S+\/p\/[A-Za-z0-9_-]+/);
    if (!match) throw new Error(`No public link in "${text}"`);
    return match[0];
  }

  const quoteUrl = page.url();
  const quoteLink = await publicLink();

  await test.step("accept the quote on the public page without signing in", async () => {
    const visitor = await browser.newContext();
    const pub = await visitor.newPage();
    const res = await pub.goto(quoteLink);
    expect(res?.status()).toBe(200);
    await expect(pub.getByText("Website redesign")).toBeVisible();
    await pub.getByRole("button", { name: "Accept quote" }).click();
    await expect(pub.getByText("Thank you. You accepted this quote.")).toBeVisible();
    await visitor.close();
  });

  await test.step("convert the quote to an invoice and send it", async () => {
    await page.goto(quoteUrl);
    await page.getByRole("button", { name: "Convert to invoice" }).click();
    await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
    await page.getByRole("button", { name: /^Send/ }).first().click();
    const send = page.getByRole("dialog", { name: /^Send/ });
    await expect(send.getByRole("textbox", { name: "Recipient 1" })).toHaveValue(CONTACT_EMAIL);
    await send.getByRole("button", { name: /^Send/ }).click();
    await expect(send).toBeHidden();
  });

  const invoiceUrl = page.url();
  const invoiceLink = await publicLink();

  await test.step("record the full payment", async () => {
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Record payment" });
    await expect(dialog.getByRole("textbox", { name: "Amount (USD)" })).toHaveValue(/1,?000/);
    await dialog.getByRole("button", { name: /Record payment/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("Paid").first()).toBeVisible();
  });

  await test.step("the dashboard shows the invoice as paid", async () => {
    await page.goto("/");
    const recent = page.getByRole("grid", { name: "Recent invoices" });
    const row = recent.getByRole("row").filter({ hasText: CLIENT });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("gridcell", { name: "Paid", exact: true })).toBeVisible();
    await expectNoSeriousA11yIssues(page, "dashboard");
  });

  await test.step("the invoice editor has no serious accessibility issues", async () => {
    await page.goto("/invoices/new");
    await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
    await expectNoSeriousA11yIssues(page, "invoice editor");
  });

  await test.step("the public invoice page is accessible and fits a phone", async () => {
    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pub = await visitor.newPage();
    await pub.goto(invoiceLink);
    await expect(pub.getByText("Website redesign")).toBeVisible();
    await expectNoSeriousA11yIssues(pub, "public invoice");
    const overflow = await pub.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "horizontal scroll at 390px").toBeLessThanOrEqual(0);
    await visitor.close();
  });
  expect(invoiceUrl).toMatch(/\/invoices\//);
});
