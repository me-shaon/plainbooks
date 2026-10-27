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
import type { SetupStatus } from "../../../shared/schemas/setup";
import { api, setUnauthenticatedHandler } from "../../lib/api";
import { redirectToSignIn, safeNext } from "../../lib/auth";
import { PUBLIC_PATHS } from "../../lib/setup";
import { ForgotPasswordPage, ResetPasswordPage } from "./password-reset-forms";
import { SignInPage } from "./sign-in-form";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setUnauthenticatedHandler(null);
});

const STATUS: SetupStatus = {
  needsSetup: false,
  setupEnabled: true,
  googleEnabled: false,
  emailConfigured: true,
};

type Reply = { status: number; body: unknown };
type Handler = (body: Record<string, unknown> | null) => Reply;

/** Stubs fetch with one handler per API path. The setup status has a default reply. */
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

/** The calls to one API path. */
function callsTo(fetchMock: ReturnType<typeof stubApi>, path: string) {
  return fetchMock.mock.calls.filter(([input]) => String(input).startsWith(`/api${path}`));
}

/** Renders a page at `url` in a router that also has `/`, `/invoices`, and `/sign-in`. */
async function renderAt(url: string, page: () => React.JSX.Element) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => <p>Overview</p> }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/invoices",
      component: () => <p>Invoices</p>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: new URL(url, "http://app.test").pathname,
      component: page,
    }),
  ];
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { level: 1 });
  return { router: router as AnyRouter, queryClient };
}

async function signInWith(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Email/), email);
  // Enter in the password field submits the form.
  await user.type(screen.getByLabelText(/^Password/), `${password}{Enter}`);
}

describe("safeNext", () => {
  it("keeps a same-origin relative path", () => {
    expect(safeNext("/invoices?status=overdue#top")).toBe("/invoices?status=overdue#top");
  });

  it("falls back to / for other origins and odd values", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "javascript:alert(1)",
      "invoices",
      "",
      undefined,
      42,
      "/sign-in?next=/invoices",
    ]) {
      expect(safeNext(next), String(next)).toBe("/");
    }
  });
});

describe("SignInPage", () => {
  it("labels the fields and sets the autocomplete values", async () => {
    stubApi({});
    await renderAt("/sign-in", () => <SignInPage />);
    expect(screen.getByLabelText(/^Email/).getAttribute("autocomplete")).toBe("email");
    expect(screen.getByLabelText(/^Password/).getAttribute("autocomplete")).toBe(
      "current-password",
    );
    expect(screen.getByRole("link", { name: "Locked out?" }).getAttribute("href")).toBe("/recover");
  });

  it("lands on next after a valid sign-in", async () => {
    const fetchMock = stubApi({
      "/api/auth/sign-in/email": () => ({ status: 200, body: { user: { id: "u1" } } }),
    });
    const { router } = await renderAt("/sign-in", () => <SignInPage next="/invoices?page=2" />);
    await signInWith("owner@example.com", "correct horse battery");
    expect(await screen.findByText("Invoices")).toBeTruthy();
    expect(router.state.location.href).toBe("/invoices?page=2");
    const [, init] = callsTo(fetchMock, "/auth/sign-in/email")[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      email: "owner@example.com",
      password: "correct horse battery",
    });
  });

  it("lands on / when next points at another site", async () => {
    stubApi({ "/api/auth/sign-in/email": () => ({ status: 200, body: {} }) });
    const { router } = await renderAt("/sign-in", () => <SignInPage next="https://evil.example" />);
    await signInWith("owner@example.com", "correct horse battery");
    expect(await screen.findByText("Overview")).toBeTruthy();
    expect(router.state.location.href).toBe("/");
  });

  it("shows one generic error for wrong credentials", async () => {
    stubApi({
      "/api/auth/sign-in/email": () => ({
        status: 401,
        body: { message: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD" },
      }),
    });
    await renderAt("/sign-in", () => <SignInPage />);
    await signInWith("someone@example.com", "wrong password");
    const alerts = await screen.findAllByRole("alert");
    const messages = alerts.map((a) => a.textContent).filter(Boolean);
    expect(messages).toEqual(["The email or password is not right."]);
    expect(screen.getByLabelText(/^Email/).getAttribute("aria-invalid")).toBeNull();
  });

  it("shows the retry time after too many attempts", async () => {
    stubApi({
      "/api/auth/sign-in/email": () => ({
        status: 429,
        body: { message: "Too many attempts", code: "RATE_LIMITED", retryAfter: 840 },
      }),
    });
    await renderAt("/sign-in", () => <SignInPage />);
    await signInWith("someone@example.com", "a password");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Try again in 14 minutes/);
  });

  it("marks empty fields without calling the API", async () => {
    const fetchMock = stubApi({});
    await renderAt("/sign-in", () => <SignInPage />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email")).toBeTruthy();
    expect(screen.getByLabelText(/^Password/).getAttribute("aria-invalid")).toBe("true");
    expect(callsTo(fetchMock, "/auth/")).toHaveLength(0);
  });

  it("hides the Google button when Google is off", async () => {
    stubApi({}, { googleEnabled: false });
    await renderAt("/sign-in", () => <SignInPage />);
    await screen.findByRole("link", { name: "Forgot your password?" });
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  });

  it("starts Google sign-in with fetch, then a full page load", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, origin: "http://app.test", assign });
    const fetchMock = stubApi(
      {
        "/api/auth/sign-in/social": () => ({
          status: 200,
          body: { url: "https://accounts.google.com/o/oauth2/auth?x=1", redirect: false },
        }),
      },
      { googleEnabled: true },
    );
    await renderAt("/sign-in", () => <SignInPage next="/invoices" />);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/auth?x=1"),
    );
    const [, init] = callsTo(fetchMock, "/auth/sign-in/social")[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: "google",
      callbackURL: "http://app.test/invoices",
      errorCallbackURL: "http://app.test/sign-in?next=%2Finvoices",
      disableRedirect: true,
    });
  });

  it("shows the no-invite message after a refused Google login", async () => {
    stubApi({}, { googleEnabled: true });
    await renderAt("/sign-in?error=signup_disabled", () => <SignInPage error="signup_disabled" />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "This Google account has no invite. Ask your Owner.",
    );
  });

  it("hides the forgot-password link when no email provider is saved", async () => {
    const fetchMock = stubApi({}, { emailConfigured: false });
    await renderAt("/sign-in", () => <SignInPage />);
    await waitFor(() => expect(callsTo(fetchMock, "/setup/status")).toHaveLength(1));
    await screen.findByRole("link", { name: "Locked out?" });
    expect(screen.queryByRole("link", { name: "Forgot your password?" })).toBeNull();
  });
});

describe("ForgotPasswordPage", () => {
  it("shows the same message for a known and an unknown email", async () => {
    const reply = {
      status: 200,
      body: { status: true, message: "If this email exists, check your email" },
    };
    const texts: string[] = [];
    for (const email of ["member@example.com", "nobody@example.com"]) {
      const fetchMock = stubApi({ "/api/auth/request-password-reset": () => reply });
      await renderAt("/forgot-password", ForgotPasswordPage);
      await userEvent.setup().type(screen.getByLabelText(/^Email/), `${email}{Enter}`);
      texts.push((await screen.findByRole("status")).textContent ?? "");
      const [, init] = callsTo(fetchMock, "/auth/request-password-reset")[0] ?? [];
      expect(JSON.parse(String(init?.body))).toEqual({ email });
      cleanup();
    }
    expect(texts[0]).toMatch(/If this email belongs to a member/);
    expect(texts[1]).toBe(texts[0]);
  });
});

describe("ResetPasswordPage", () => {
  it("shows the ask-for-a-new-link state for a used or expired token", async () => {
    stubApi({
      "/api/auth/reset-password": () => ({
        status: 400,
        body: { message: "Invalid token", code: "INVALID_TOKEN" },
      }),
    });
    await renderAt("/reset-password", () => <ResetPasswordPage token="old-token" />);
    const user = userEvent.setup();
    expect(screen.getByLabelText(/^New password/).getAttribute("autocomplete")).toBe(
      "new-password",
    );
    await user.type(screen.getByLabelText(/^New password/), "a brand new passphrase");
    await user.type(screen.getByLabelText(/Confirm new password/), "a brand new passphrase{Enter}");
    expect((await screen.findByRole("alert")).textContent).toMatch(/Ask for a new link/);
    expect(await screen.findByRole("link", { name: "Ask for a new link" })).toBeTruthy();
  });

  it("shows the same state when the link has no token", async () => {
    stubApi({});
    await renderAt("/reset-password", () => <ResetPasswordPage />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/used or has expired/);
  });

  it("sets the new password with the token", async () => {
    const fetchMock = stubApi({
      "/api/auth/reset-password": () => ({ status: 200, body: { status: true } }),
    });
    await renderAt("/reset-password", () => <ResetPasswordPage token="good-token" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New password/), "a brand new passphrase");
    await user.type(screen.getByLabelText(/Confirm new password/), "a brand new passphrase{Enter}");
    expect(await screen.findByText("Password changed")).toBeTruthy();
    const [, init] = callsTo(fetchMock, "/auth/reset-password")[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      token: "good-token",
      newPassword: "a brand new passphrase",
    });
  });

  it("checks the password rules and the confirmation before the API call", async () => {
    const fetchMock = stubApi({});
    await renderAt("/reset-password", () => <ResetPasswordPage token="good-token" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New password/), "short");
    await user.type(screen.getByLabelText(/Confirm new password/), "short{Enter}");
    expect(await screen.findByText("Use at least 12 characters")).toBeTruthy();
    expect(callsTo(fetchMock, "/auth/")).toHaveLength(0);
  });
});

describe("a 401 mid-session", () => {
  it("opens sign-in and keeps the path in next", async () => {
    stubApi({
      "/api/clients": () => ({
        status: 401,
        body: { error: "Sign in to continue.", code: "unauthenticated" },
      }),
    });
    const { router } = await renderAt("/sign-in", () => <SignInPage />);
    await router.navigate({ href: "/invoices?status=overdue" });
    await screen.findByText("Invoices");
    setUnauthenticatedHandler(() => redirectToSignIn(router, PUBLIC_PATHS));

    await expect(api("/clients")).rejects.toMatchObject({ status: 401 });
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toEqual({ next: "/invoices?status=overdue" });
  });

  it("does not leave sign-in for a wrong password", async () => {
    const handler = vi.fn();
    setUnauthenticatedHandler(handler);
    stubApi({
      "/api/auth/sign-in/email": () => ({
        status: 401,
        body: { message: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD" },
      }),
    });
    await renderAt("/sign-in", () => <SignInPage />);
    await signInWith("someone@example.com", "wrong password");
    await screen.findByText("The email or password is not right.");
    expect(handler).not.toHaveBeenCalled();
  });
});
