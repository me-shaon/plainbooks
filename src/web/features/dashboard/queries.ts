import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DashboardData, NotificationList } from "../../../shared/schemas/dashboard";
import type { ListFilter } from "../../../shared/schemas/document";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";

/** The overview aggregate. Changing the recent filter keeps the old data on screen. */
export function useDashboard(recent: ListFilter) {
  return useQuery({
    queryKey: queryKeys.dashboard.view(recent),
    queryFn: () => api<DashboardData>("/dashboard", { query: { recent } }),
    placeholderData: keepPreviousData,
  });
}

export function useNotifications(state: "all" | "unread", page: number) {
  return useQuery({
    queryKey: queryKeys.notifications.list(state, page),
    queryFn: () =>
      api<NotificationList>("/notifications", { query: { state, page, pageSize: 25 } }),
    placeholderData: keepPreviousData,
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
  };
}

export function useDismissNotification() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ ok: true }>(`/notifications/${id}/dismiss`, { method: "POST", json: {} }),
    onSuccess: refresh,
  });
}

export function useDismissAllNotifications() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () =>
      api<{ dismissed: number }>("/notifications/dismiss-all", { method: "POST", json: {} }),
    onSuccess: refresh,
  });
}

/** Owner only: puts a failed background job back in the queue. */
export function useRetryJob() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; status: string }>(`/jobs/${id}/retry`, { method: "POST", json: {} }),
    onSuccess: refresh,
  });
}
