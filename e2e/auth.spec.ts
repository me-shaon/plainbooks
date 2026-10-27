import { expect, type Page, test } from "@playwright/test";
import { E2E_SETUP_TOKEN } from "./env";

// Runs on the `auth` server, which starts with an empty database (playwright.config.ts).

const OWNER = {
  name: "Olive Owner",
  email: "olive@example.com",
  password: "olive owner passphrase",
};
const MEMBER = {
  name: "Milo Member",
  email: "milo@example.com",
  password: "milo member passphrase",
};

/** The sidebar shows the signed-in user's name next to the "Sign out" button. */
async function expectSignedInAs(page: Page, name: string) {
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
}

/** The member's row in the Team grid on the Owner's page. */
function memberRow(page: Page) {
  return page.getByRole("grid", { name: "Team" }).getByRole("row", { name: MEMBER.email });
}

test.describe.configure({ mode: "serial" });

test("setup, sign-out, sign-in, invite, and accept", async ({ page, browser }) => {
  await test.step("the first visit opens setup, which creates the Owner", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/setup$/);
    await page.getByLabel(/Setup token/).fill(E2E_SETUP_TOKEN);
    await page.getByLabel(/Your name/).fill(OWNER.name);
    await page.getByLabel(/^Email/).fill(OWNER.email);
    await page.getByLabel(/^Password/).fill(OWNER.password);
    await page.getByLabel(/Confirm password/).fill(OWNER.password);
    await page.getByRole("button", { name: "Create Owner" }).click();
    await expect(page).not.toHaveURL(/\/setup/);
    await expectSignedInAs(page, OWNER.name);
  });

  await test.step("sign out", async () => {
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/settings/team");
    await expect(page).toHaveURL(/\/sign-in/);
  });

  await test.step("sign in returns to the page that asked for it", async () => {
    await page.getByLabel(/^Email/).fill(OWNER.email);
    await page.getByLabel(/^Password/).fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/team$/);
    await expectSignedInAs(page, OWNER.name);
  });

  let link = "";
  await test.step("the Owner invites a member and gets the link", async () => {
    await page.getByRole("button", { name: "Add member" }).click();
    const dialog = page.getByRole("dialog", { name: "Add member" });
    await dialog.getByLabel(/^Email/).fill(MEMBER.email);
    await dialog.getByRole("button", { name: "Add member" }).click();
    const linkDialog = page.getByRole("dialog", { name: "Invite link" });
    link = await linkDialog.getByLabel("Link").inputValue();
    expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);
    await linkDialog.getByRole("button", { name: "Done" }).click();
    await expect(memberRow(page)).toContainText("Invited");
  });

  await test.step("the member accepts the invite and is signed in", async () => {
    const visitor = await browser.newContext();
    const invited = await visitor.newPage();
    await invited.goto(link);
    await expect(invited.getByText(MEMBER.email)).toBeVisible();
    await invited.getByLabel(/Your name/).fill(MEMBER.name);
    await invited.getByLabel(/^Password/).fill(MEMBER.password);
    await invited.getByLabel(/Confirm password/).fill(MEMBER.password);
    await invited.getByRole("button", { name: "Join" }).click();
    await expect(invited).not.toHaveURL(/\/invite\//);
    await expectSignedInAs(invited, MEMBER.name);

    // The link works once.
    await invited.goto(link);
    await expect(
      invited.getByText("The link was used or has expired. Ask your Owner for a new link."),
    ).toBeVisible();
    await visitor.close();
  });

  await test.step("the Team page shows the member as active", async () => {
    await page.reload();
    await expect(memberRow(page)).toContainText("Active");
    await expect(memberRow(page)).toContainText(MEMBER.name);
  });
});
