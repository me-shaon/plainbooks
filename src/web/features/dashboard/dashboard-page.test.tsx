import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DashboardData } from "../../../shared/schemas/dashboard";
import { queryKeys } from "../../lib/query-keys";
import { DashboardPage } from "./dashboard-page";

afterEach(cleanup);

const EMPTY: DashboardData = {
  homeCurrency: "BDT",
  today: "2026-10-23",
  isEmpty: true,
  outstanding: { home: 0, invoiceCount: 0, currencyCount: 0 },
  overdue: { home: 0, invoiceCount: 0, topClientName: null },
  paidThisMonth: { home: 0, paymentCount: 0, invoiceCount: 0 },
  nextRecurring: null,
  byCurrency: [],
  readyToSend: { count: 0, items: [] },
  recent: [],
  needsReminder: [],
  notifications: { unreadCount: 0, items: [] },
  failedJobs: { count: 0, items: [] },
};

async function renderDashboard(data: DashboardData) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(queryKeys.dashboard.view("all"), data);
  queryClient.setQueryData(queryKeys.me, {
    id: "u1",
    email: "owner@test",
    name: null,
    role: "owner",
  });
  const rootRoute = createRootRoute();
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: DashboardPage,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByText("Overview");
}

describe("DashboardPage", () => {
  it("shows the empty state for a new workspace", async () => {
    await renderDashboard(EMPTY);
    expect(screen.getByText("Send your first invoice")).toBeTruthy();
    expect(screen.getByText("Friday 23 October")).toBeTruthy();
    expect(screen.queryByText("Outstanding by currency")).toBeNull();
  });

  it("shows the KPIs and the exact amount per currency", async () => {
    await renderDashboard({
      ...EMPTY,
      isEmpty: false,
      outstanding: { home: 83874500, invoiceCount: 4, currencyCount: 3 },
      overdue: { home: 39000000, invoiceCount: 1, topClientName: "Halden & Co" },
      paidThisMonth: { home: 6000000, paymentCount: 1, invoiceCount: 1 },
      byCurrency: [
        { currency: "EUR", amount: 300000, home: 39000000, invoiceCount: 1 },
        { currency: "USD", amount: 250000, home: 30150000, invoiceCount: 2 },
      ],
    });
    expect(screen.getByText("838,745.00")).toBeTruthy();
    expect(screen.getByText("3 currencies, 4 invoices")).toBeTruthy();
    expect(screen.getByText("1 invoice, Halden & Co")).toBeTruthy();
    expect(screen.getByText("Paid in October")).toBeTruthy();
    expect(screen.getByText("3,000.00")).toBeTruthy();
    expect(screen.getByText("2,500.00")).toBeTruthy();
    expect(screen.getByText("No invoices yet.")).toBeTruthy();
  });
});
