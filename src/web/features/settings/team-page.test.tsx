import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemberLink, TeamMember } from "../../../shared/schemas/settings";
import { stateLabel, TeamPage } from "./team-page";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOW = Date.now();
const OWNER: TeamMember = {
  id: "u-owner",
  email: "owner@example.com",
  name: "Avery",
  role: "owner",
  state: "active",
  linkExpiresAt: null,
  createdAt: NOW,
};

const member = (overrides: Partial<TeamMember>): TeamMember => ({
  ...OWNER,
  id: `u-${overrides.email}`,
  role: "member",
  name: null,
  ...overrides,
});

const INVITED = member({
  email: "new@example.com",
  state: "invited",
  linkExpiresAt: NOW + 86_400_000,
});
const EXPIRED = member({ email: "late@example.com", state: "expired", linkExpiresAt: NOW - 1 });

function linkFor(target: TeamMember, overrides: Partial<MemberLink> = {}): MemberLink {
  return {
    member: target,
    link: "https://invoices.example.com/invite/abcdef",
    kind: "invite",
    expiresAt: NOW + 7 * 86_400_000,
    emailSent: false,
    ...overrides,
  };
}

function stubApi(routes: Record<string, (body: unknown) => { status: number; body: unknown }>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://app.test").pathname;
    const method = init?.method ?? "GET";
    const key = `${method} ${path}`;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const handler = routes[key];
    const reply = handler ? handler(body) : { status: 404, body: { error: "Not found" } };
    return new Response(reply.status === 204 ? null : JSON.stringify(reply.body), {
      status: reply.status,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage(items: TeamMember[], extra: Parameters<typeof stubApi>[0] = {}) {
  const fetchMock = stubApi({
    "GET /api/me": () => ({ status: 200, body: { user: OWNER } }),
    "GET /api/team": () => ({ status: 200, body: { items } }),
    ...extra,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <TeamPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe("stateLabel", () => {
  it("names each state", () => {
    expect(stateLabel(OWNER)).toBe("Active");
    expect(stateLabel(INVITED)).toMatch(/^Invited, expires /);
    expect(stateLabel(EXPIRED)).toBe("Invite expired");
    expect(stateLabel(member({ state: "reset_pending", linkExpiresAt: NOW + 1000 }), NOW)).toBe(
      "Reset pending",
    );
    expect(stateLabel(member({ state: "reset_pending", linkExpiresAt: NOW - 1 }), NOW)).toBe(
      "Reset link expired",
    );
  });
});

describe("TeamPage", () => {
  it("shows the invite link once after adding a member, with no email", async () => {
    const added = linkFor(INVITED);
    const fetchMock = renderPage([OWNER], {
      "POST /api/team": () => ({ status: 201, body: added }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog", { name: "Add member" });
    await user.type(within(dialog).getByLabelText(/^Email/), "new@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add member" }));

    const linkDialog = await screen.findByRole("dialog", { name: "Invite link" });
    expect((within(linkDialog).getByLabelText("Link") as HTMLInputElement).value).toBe(added.link);
    expect(within(linkDialog).getByText(/No email went out/)).toBeTruthy();
    expect(within(linkDialog).getByText(/issue a fresh link/)).toBeTruthy();

    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(within(linkDialog).getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(added.link);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("says the email went out when it did", async () => {
    renderPage([OWNER], {
      "POST /api/team": () => ({ status: 201, body: linkFor(INVITED, { emailSent: true }) }),
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog", { name: "Add member" });
    await user.type(within(dialog).getByLabelText(/^Email/), "new@example.com{Enter}");
    const linkDialog = await screen.findByRole("dialog", { name: "Invite link" });
    expect(within(linkDialog).getByText(/We emailed this link to new@example.com/)).toBeTruthy();
  });

  it("shows the states and resends an expired invite", async () => {
    const resent = linkFor({ ...EXPIRED, state: "invited" }, { link: "https://x.test/invite/new" });
    renderPage([OWNER, INVITED, EXPIRED], {
      [`POST /api/team/${EXPIRED.id}/invite`]: () => ({ status: 200, body: resent }),
    });
    expect((await screen.findAllByText("Invite expired")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^Invited, expires/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    // The Owner's own row has no actions.
    expect(screen.queryByRole("button", { name: `Actions for ${OWNER.email}` })).toBeNull();

    const user = userEvent.setup();
    const [trigger] = screen.getAllByRole("button", { name: `Actions for ${EXPIRED.email}` });
    await user.click(trigger as HTMLElement);
    await user.click(await screen.findByRole("menuitem", { name: "Resend invite" }));
    const linkDialog = await screen.findByRole("dialog", { name: "Invite link" });
    expect((within(linkDialog).getByLabelText("Link") as HTMLInputElement).value).toBe(resent.link);
  });

  it("resets a member's sign-in after confirmation and shows the reset link", async () => {
    const active = member({ email: "member@example.com" });
    const reset = linkFor(
      { ...active, state: "reset_pending", linkExpiresAt: NOW + 86_400_000 },
      { kind: "reset", link: "https://x.test/invite/reset", expiresAt: NOW + 86_400_000 },
    );
    const fetchMock = renderPage([OWNER, active], {
      [`POST /api/team/${active.id}/reset`]: () => ({ status: 200, body: reset }),
    });
    const user = userEvent.setup();
    const [trigger] = await screen.findAllByRole("button", { name: `Actions for ${active.email}` });
    await user.click(trigger as HTMLElement);
    await user.click(await screen.findByRole("menuitem", { name: "Reset sign-in" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/linked Google account stop working/)).toBeTruthy();
    await user.click(within(confirm).getByRole("button", { name: "Reset sign-in" }));

    const linkDialog = await screen.findByRole("dialog", { name: "Sign-in reset link" });
    expect((within(linkDialog).getByLabelText("Link") as HTMLInputElement).value).toBe(reset.link);
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/team/${active.id}/reset`)),
    ).toBe(true);
  });
});
