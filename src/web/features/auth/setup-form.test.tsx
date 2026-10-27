import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecoverPage } from "./recover-form";
import { SetupPage } from "./setup-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Stubs fetch with one JSON response and returns the mock. */
function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderPage(page: () => React.JSX.Element) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const pageRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: page });
  const router = createRouter({
    routeTree: rootRoute.addChildren([pageRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: /Create Owner|Set new password/ });
}

async function fillSetup(overrides: Partial<Record<string, string>> = {}) {
  const user = userEvent.setup();
  const values = {
    token: "a-setup-token-that-is-long-enough-123",
    name: "Avery",
    email: "owner@example.com",
    password: "correct horse battery",
    confirm: "correct horse battery",
    ...overrides,
  };
  await user.type(screen.getByLabelText(/Setup token/), values.token);
  await user.type(screen.getByLabelText(/Your name/), values.name);
  await user.type(screen.getByLabelText(/^Email/), values.email);
  await user.type(screen.getByLabelText(/^Password/), values.password);
  await user.type(screen.getByLabelText(/Confirm password/), values.confirm);
  await user.click(screen.getByRole("button", { name: "Create Owner" }));
}

describe("SetupPage", () => {
  it("labels every field and sets the autocomplete values", async () => {
    await renderPage(SetupPage);
    expect(screen.getByLabelText(/^Email/).getAttribute("autocomplete")).toBe("email");
    expect(screen.getByLabelText(/^Password/).getAttribute("autocomplete")).toBe("new-password");
    expect(screen.getByLabelText(/Confirm password/).getAttribute("autocomplete")).toBe(
      "new-password",
    );
  });

  it("shows the wrong-token message", async () => {
    stubFetch(401, { error: "The setup token is not right", code: "invalid_setup_token" });
    await renderPage(SetupPage);
    await fillSetup();
    expect((await screen.findByRole("alert")).textContent).toMatch(/setup token is not right/);
  });

  it("shows a weak password next to the field without calling the API", async () => {
    const fetchMock = stubFetch(201, {});
    await renderPage(SetupPage);
    await fillSetup({ password: "short", confirm: "short" });
    expect(await screen.findByText("Use at least 12 characters")).toBeTruthy();
    expect(screen.getByLabelText(/^Password/).getAttribute("aria-invalid")).toBe("true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows when the passwords do not match", async () => {
    await renderPage(SetupPage);
    await fillSetup({ confirm: "something else entirely" });
    expect(await screen.findByText("The passwords do not match")).toBeTruthy();
  });

  it("shows the retry time for too many attempts", async () => {
    stubFetch(429, { error: "Too many attempts", code: "rate_limited", retryAfter: 600 });
    await renderPage(SetupPage);
    await fillSetup();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Try again in 10 minutes/);
  });

  it("shows that setup is closed", async () => {
    stubFetch(409, { error: "Setup is closed", code: "setup_closed" });
    await renderPage(SetupPage);
    await fillSetup();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Setup is closed/);
  });

  it("shows a server password error on the field", async () => {
    stubFetch(400, {
      error: "Invalid request",
      code: "invalid_request",
      issues: [{ path: "password", message: "Use 128 characters or fewer" }],
    });
    await renderPage(SetupPage);
    await fillSetup();
    expect(await screen.findByText("Use 128 characters or fewer")).toBeTruthy();
  });
});

describe("RecoverPage", () => {
  it("shows one message for a refused recovery, and success after it works", async () => {
    stubFetch(401, { error: "Refused", code: "recovery_refused" });
    await renderPage(RecoverPage);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Setup token/), "a-setup-token-that-is-long-enough-123");
    await user.type(screen.getByLabelText(/Owner email/), "owner@example.com");
    await user.type(screen.getByLabelText(/^New password/), "a brand new passphrase");
    await user.type(screen.getByLabelText(/Confirm new password/), "a brand new passphrase");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /setup token or the Owner email is not right/,
    );

    stubFetch(200, { ok: true });
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByText("Password changed")).toBeTruthy();
  });
});
