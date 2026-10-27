import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  DashboardData,
  NotificationList,
  ReviewJobView,
} from "../../../shared/schemas/dashboard";
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

/** The email jobs that need review, newest first. */
export function useReviewJobs() {
  return useQuery({
    queryKey: queryKeys.reviewJobs,
    queryFn: () => api<{ items: ReviewJobView[] }>("/jobs/needs-review"),
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.reviewJobs });
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

/**
 * Owner only: resolves an email that needs review. "mark-sent" records the send without an
 * email. "send-again" releases the send key and queues the email once more. Both refresh
 * every document query, because the document status and its badge change.
 */
export function useResolveReviewJob(action: "mark-sent" | "send-again") {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ id: string; status: string }>(`/jobs/${id}/${action}`, { method: "POST", json: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
    },
  });
}
