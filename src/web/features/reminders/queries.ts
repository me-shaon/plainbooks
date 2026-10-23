import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReminderModeSetting } from "../../../shared/domain";
import type { DocumentDetail } from "../../../shared/schemas/document";
import type { ReminderStatus, ReminderSuggestion } from "../../../shared/schemas/reminder";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";

/** The dashboard "needs reminder" list. */
export function useReminderSuggestions(enabled = true) {
  return useQuery({
    enabled,
    queryKey: queryKeys.reminders.suggestions,
    queryFn: () =>
      api<{ items: ReminderSuggestion[] }>("/reminders/suggestions").then((r) => r.items),
  });
}

export function useReminderStatus(documentId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reminders.status(documentId),
    queryFn: () => api<ReminderStatus>(`/documents/${documentId}/reminders`),
    enabled,
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return (documentId: string) => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.reminders.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.documents.activity(documentId) });
  };
}

/** Sends one reminder now, with the reminder email. */
export function useSendReminder() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (documentId: string) =>
      api<{ offsetDays: number; recipients: string[]; status: ReminderStatus }>(
        `/documents/${documentId}/remind`,
        { method: "POST", json: {} },
      ),
    onSuccess: (_result, documentId) => refresh(documentId),
  });
}

/** Sets the invoice's own reminder mode. "off" wins over the client and workspace. */
export function useSetReminderMode(documentId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (reminderMode: ReminderModeSetting) =>
      api<DocumentDetail>(`/documents/${documentId}/reminder-mode`, {
        method: "PATCH",
        json: { reminderMode },
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.documents.detail(documentId), detail);
      refresh(documentId);
    },
  });
}
