import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClientArchiveFilter,
  ClientCreateInput,
  ClientDetail,
  ClientSummary,
  ClientUpdateInput,
} from "../../../shared/schemas/client";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";

export function useClients(filters: { q?: string; archived: ClientArchiveFilter }) {
  return useQuery({
    queryKey: queryKeys.clients.list(filters),
    queryFn: ({ signal }) =>
      api<{ items: ClientSummary[] }>("/clients", { query: filters, signal }).then((r) => r.items),
    placeholderData: (previous) => previous,
  });
}

export function useClient(id: string) {
  return useQuery({
    queryKey: queryKeys.clients.detail(id),
    queryFn: () => api<ClientDetail>(`/clients/${id}`),
  });
}

/** Creates a client, or updates one when `id` is set. Refreshes every client query. */
export function useSaveClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ClientCreateInput | ClientUpdateInput }) =>
      id
        ? api<ClientDetail>(`/clients/${id}`, { method: "PATCH", json: input, toastOnError: false })
        : api<ClientDetail>("/clients", { method: "POST", json: input, toastOnError: false }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.clients.detail(detail.client.id), detail);
      return queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
    },
  });
}

export function useArchiveClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      api<ClientDetail>(`/clients/${id}/${archive ? "archive" : "restore"}`, { method: "POST" }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.clients.detail(detail.client.id), detail);
      return queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
    },
  });
}
