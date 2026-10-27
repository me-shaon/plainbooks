import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReviewJobView } from "../../../shared/schemas/dashboard";
import { queryKeys } from "../../lib/query-keys";
import { NeedsReviewPanel } from "./needs-review";

afterEach(cleanup);

const JOB: ReviewJobView = {
  id: "job-1",
  type: "document_send",
  lastError: "tosend unknown/timeout: The request timed out.",
  updatedAt: Date.UTC(2026, 9, 23, 6, 0),
  documentId: "d1",
  documentKind: "invoice",
  documentNumber: "INV-0001",
};

async function renderPanel(role: "owner" | "member") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(queryKeys.reviewJobs, { items: [JOB] });
  queryClient.setQueryData(queryKeys.me, { id: "u1", email: "u@test", name: null, role });
  const rootRoute = createRootRoute({ component: NeedsReviewPanel });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText("Emails that need review");
}

describe("NeedsReviewPanel", () => {
  it("shows the job with its reason and both actions for an Owner", async () => {
    await renderPanel("owner");
    expect(screen.getByText("INV-0001")).toBeTruthy();
    expect(screen.getByText(JOB.lastError ?? "")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as sent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send again" })).toBeTruthy();
  });

  it("asks before Mark as sent and says that no email is sent", async () => {
    await renderPanel("owner");
    fireEvent.click(screen.getByRole("button", { name: "Mark as sent" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Mark this email as sent?");
    expect(dialog.textContent).toContain("No email is sent.");
  });

  it("asks before Send again and warns that the client may get the email twice", async () => {
    await renderPanel("owner");
    fireEvent.click(screen.getByRole("button", { name: "Send again" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Send this email again?");
    expect(dialog.textContent).toContain("the client gets the email twice");
  });

  it("shows no actions to a Member", async () => {
    await renderPanel("member");
    expect(screen.getByText("Only an Owner can resolve these emails.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send again" })).toBeNull();
  });
});
