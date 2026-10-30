import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../../../shared/schemas/settings";
import { UpdatesSection } from "./updates-section";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const STATUS: UpdateStatus = {
  enabled: true,
  currentVersion: "0.1.0",
  latestVersion: "0.1.0",
  releaseUrl: "https://github.com/me-shaon/plainbooks/releases/tag/v0.1.0",
  updateAvailable: false,
  checkedAt: Date.parse("2026-10-23T04:00:00Z"),
};

function renderSection(status: UpdateStatus) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://app.test").pathname;
    if (path !== "/api/settings/updates") return new Response("{}", { status: 404 });
    if (init?.method === "PATCH") {
      const { enabled } = JSON.parse(String(init.body)) as { enabled: boolean };
      return Response.json({ ...status, enabled });
    }
    return Response.json(status);
  });
  vi.stubGlobal("fetch", fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UpdatesSection />
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe("UpdatesSection", () => {
  it("says the app is up to date", async () => {
    renderSection(STATUS);
    expect(await screen.findByText("This app runs version 0.1.0.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/^This is the newest version\./);
    expect(screen.queryByRole("link", { name: /What changed/ })).toBeNull();
  });

  it("links to the release and the guide when a newer version is out", async () => {
    renderSection({
      ...STATUS,
      latestVersion: "0.2.0",
      releaseUrl: "https://github.com/me-shaon/plainbooks/releases/tag/v0.2.0",
      updateAvailable: true,
    });
    expect((await screen.findByRole("status")).textContent).toMatch(
      /^Version 0\.2\.0 is available\./,
    );
    expect(screen.getByRole("link", { name: /What changed/ }).getAttribute("href")).toBe(
      "https://github.com/me-shaon/plainbooks/releases/tag/v0.2.0",
    );
    expect(screen.getByRole("link", { name: /How to update/ }).getAttribute("href")).toMatch(
      /docs\/updating\.md$/,
    );
  });

  it("turns the check off", async () => {
    const fetchMock = renderSection(STATUS);
    await userEvent.click(await screen.findByRole("switch", { name: "Check for new versions" }));
    expect((await screen.findByRole("status")).textContent).toBe("The update check is off.");
    const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ enabled: false });
  });
});
