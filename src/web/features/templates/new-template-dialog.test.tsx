import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_PRESETS } from "../../../shared/schemas/template";
import { NewTemplateDialog } from "./new-template-dialog";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://app.test").pathname;
    if (path === "/render/preview") return new Response("<p>preview</p>");
    if (path === "/api/templates" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { name: string; config: unknown };
      return Response.json({ id: "t1", ...body }, { status: 201 });
    }
    return Response.json({}, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderDialog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <NewTemplateDialog isOpen onOpenChange={() => {}} />,
  });
  const editor = createRoute({
    getParentRoute: () => rootRoute,
    path: "/templates/$templateId",
    component: () => <p>editor</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page, editor]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("dialog", { name: "New template" });
}

describe("NewTemplateDialog", () => {
  it("shows each ready-made template with a preview", async () => {
    const fetchMock = stubApi();
    await renderDialog();
    expect(screen.getAllByRole("radio")).toHaveLength(TEMPLATE_PRESETS.length);
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/render/preview")),
      ).toHaveLength(TEMPLATE_PRESETS.length),
    );
  });

  it("creates a copy of the chosen design with its name", async () => {
    const fetchMock = stubApi();
    const user = userEvent.setup();
    await renderDialog();
    await user.click(screen.getByRole("radio", { name: /^Boxed/ }));
    await user.click(screen.getByRole("button", { name: "Create template" }));
    await screen.findByText("editor");
    const post = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/api/templates") && init?.method === "POST",
    );
    const boxed = TEMPLATE_PRESETS.find((p) => p.id === "boxed");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: "Boxed",
      layout: "boxed",
      config: boxed?.config,
    });
  });
});
