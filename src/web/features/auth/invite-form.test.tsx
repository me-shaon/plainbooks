import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InviteLinkInfo } from "../../../shared/schemas/settings";
import type { SetupStatus } from "../../../shared/schemas/setup";
import { googleErrorMessage, isPublicPath } from "../../lib/auth";
import { PUBLIC_PATHS } from "../../lib/setup";
import { InvitePage } from "./invite-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATUS: SetupStatus = {
  needsSetup: false,
  setupEnabled: true,
  googleEnabled: false,
  emailConfigured: false,
};

const INVITE: InviteLinkInfo = {
  kind: "invite",
  email: "riley@example.com",
  name: "riley",
  expiresAt: Date.now() + 86_400_000,
};

type Reply = { status: number; body: unknown };
type Handler = (body: Record<string, unknown> | null) => Reply;

function stubApi(handlers: Record<string, Handler>, status: Partial<SetupStatus> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://app.test").pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const handler =
      handlers[path] ??
      (path === "/api/setup/status"
        ? () => ({ status: 200, body: { ...STATUS, ...status } })
        : () => ({ status: 404, body: { error: "Not found" } }));
    const reply = handler(body);
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const callsTo = (fetchMock: ReturnType<typeof stubApi>, path: string) =>
  fetchMock.mock.calls.filter(([input]) => String(input).startsWith(`/api${path}`));

async function renderInvite(token = "tok_123") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Overview</p> }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/sign-in",
      component: () => <p>Sign in</p>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/invite/$token",
      component: () => <InvitePage token={token} />,
    }),
  ];
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [`/invite/${token}`] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1 });
  return router as AnyRouter;
}

describe("invite page", () => {
  it("is a public page without the app shell", () => {
    expect(isPublicPath("/invite/abc", PUBLIC_PATHS)).toBe(true);
    expect(isPublicPath("/invoices", PUBLIC_PATHS)).toBe(false);
  });

  it("sets the name and password, then opens the app", async () => {
    const fetchMock = stubApi({
      "/api/invites/lookup": () => ({ status: 200, body: INVITE }),
      "/api/invites/accept": () => ({ status: 200, body: { ok: true, kind: "invite" } }),
    });
    const router = await renderInvite();
    await screen.findByRole("heading", { name: "Join the team" });
    expect(screen.getByText("riley@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();

    const password = screen.getByLabelText(/^Password/) as HTMLInputElement;
    expect(password.autocomplete).toBe("new-password");
    const user = userEvent.setup();
    const name = screen.getByLabelText(/Your name/);
    await user.clear(name);
    await user.type(name, "Riley Member");
    await user.type(password, "correct horse battery");
    await user.type(screen.getByLabelText(/Confirm password/), "correct horse battery{Enter}");

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    const [, init] = callsTo(fetchMock, "/invites/accept")[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      token: "tok_123",
      name: "Riley Member",
      password: "correct horse battery",
    });
  });

  it("shows field errors and sends nothing for different passwords", async () => {
    const fetchMock = stubApi({ "/api/invites/lookup": () => ({ status: 200, body: INVITE }) });
    await renderInvite();
    await screen.findByRole("heading", { name: "Join the team" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Password/), "correct horse battery");
    await user.type(screen.getByLabelText(/Confirm password/), "another passphrase{Enter}");
    expect(await screen.findByText("The passwords do not match")).toBeTruthy();
    expect(callsTo(fetchMock, "/invites/accept")).toHaveLength(0);
  });

  it("offers Google when it is set up", async () => {
    stubApi(
      { "/api/invites/lookup": () => ({ status: 200, body: INVITE }) },
      { googleEnabled: true },
    );
    await renderInvite();
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("asks only for a new password on a reset link", async () => {
    stubApi({
      "/api/invites/lookup": () => ({ status: 200, body: { ...INVITE, kind: "reset" } }),
    });
    await renderInvite();
    await screen.findByRole("heading", { name: "Set a new password" });
    expect(screen.queryByLabelText(/Your name/)).toBeNull();
    expect(screen.getByLabelText(/^New password/)).toBeTruthy();
  });

  it("shows 'Ask your Owner for a new link' for a used or expired link", async () => {
    stubApi({
      "/api/invites/lookup": () => ({
        status: 410,
        body: { error: "This link was used or has expired.", code: "link_invalid" },
      }),
    });
    await renderInvite();
    expect(await screen.findByRole("heading", { name: "This link does not work" })).toBeTruthy();
    expect(screen.getByText(/Ask your Owner for a new link/)).toBeTruthy();
  });

  it("switches to the invalid state when the link is used during the visit", async () => {
    stubApi({
      "/api/invites/lookup": () => ({ status: 200, body: INVITE }),
      "/api/invites/accept": () => ({
        status: 410,
        body: { error: "This link was used or has expired.", code: "link_invalid" },
      }),
    });
    await renderInvite();
    await screen.findByRole("heading", { name: "Join the team" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Password/), "correct horse battery");
    await user.type(screen.getByLabelText(/Confirm password/), "correct horse battery{Enter}");
    expect(await screen.findByRole("heading", { name: "This link does not work" })).toBeTruthy();
  });

  it("maps the Google refusal codes to messages", () => {
    expect(googleErrorMessage("invite_expired")).toMatch(/Ask your Owner for a new link/);
    expect(googleErrorMessage("email_not_verified")).toMatch(/not verified/);
  });
});
