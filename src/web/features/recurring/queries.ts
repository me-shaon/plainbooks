import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  RecurringCreateInput,
  RecurringDetail,
  RecurringSummary,
  RecurringUpdateInput,
} from "../../../shared/schemas/recurring";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";

export function useSchedules() {
  return useQuery({
    queryKey: queryKeys.recurring.list,
    queryFn: () => api<{ items: RecurringSummary[] }>("/recurring").then((r) => r.items),
  });
}

export function useSchedule(id: string) {
  return useQuery({
    queryKey: queryKeys.recurring.detail(id),
    queryFn: () => api<RecurringDetail>(`/recurring/${id}`),
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return (detail?: RecurringDetail) => {
    if (detail) queryClient.setQueryData(queryKeys.recurring.detail(detail.id), detail);
    void queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
  };
}

/** Creates a schedule from an invoice. Errors are not toasted: the dialog shows them. */
export function useCreateSchedule() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: RecurringCreateInput) =>
      api<RecurringDetail>("/recurring", { method: "POST", json: input, toastOnError: false }),
    onSuccess: (detail) => refresh(detail),
  });
}

export function useUpdateSchedule(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (input: RecurringUpdateInput) =>
      api<RecurringDetail>(`/recurring/${id}`, {
        method: "PATCH",
        json: input,
        toastOnError: false,
      }),
    onSuccess: (detail) => refresh(detail),
  });
}

export function useScheduleAction(id: string, action: "pause" | "resume") {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: () =>
      api<RecurringDetail>(`/recurring/${id}/${action}`, { method: "POST", json: {} }),
    onSuccess: (detail) => refresh(detail),
  });
}

export function useDeleteSchedule(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<null>(`/recurring/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.recurring.detail(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
    },
  });
}
