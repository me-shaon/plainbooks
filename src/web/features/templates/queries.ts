import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CustomFieldCreateInput,
  CustomFieldDef,
  CustomFieldUpdateInput,
  CustomFieldValue,
  TemplateCreateInput,
  TemplateDetail,
  TemplateUpdateInput,
} from "../../../shared/schemas/template";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";

export function useTemplate(id: string) {
  return useQuery({
    queryKey: queryKeys.templates.detail(id),
    queryFn: () => api<TemplateDetail>(`/templates/${id}`),
  });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateCreateInput) =>
      api<TemplateDetail>("/templates", { method: "POST", json: input, toastOnError: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.templates.all }),
  });
}

export function useUpdateTemplate(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateUpdateInput) =>
      api<TemplateDetail>(`/templates/${id}`, { method: "PATCH", json: input }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.templates.detail(id), data);
      void queryClient.invalidateQueries({ queryKey: queryKeys.templates.list });
    },
  });
}

export function useSetDefaultTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<TemplateDetail>(`/templates/${id}/default`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.templates.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings.workspace });
    },
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.templates.all }),
  });
}

export function useCustomFields({ includeArchived = false } = {}) {
  return useQuery({
    queryKey: queryKeys.customFields.list(includeArchived),
    queryFn: () =>
      api<{ items: CustomFieldDef[] }>("/custom-fields", {
        query: { archived: includeArchived ? "include" : undefined },
      }).then((r) => r.items),
  });
}

export function useSaveCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id?: string;
      input: CustomFieldCreateInput | CustomFieldUpdateInput;
    }) =>
      id
        ? api<CustomFieldDef>(`/custom-fields/${id}`, {
            method: "PATCH",
            json: input,
            toastOnError: false,
          })
        : api<CustomFieldDef>("/custom-fields", {
            method: "POST",
            json: input,
            toastOnError: false,
          }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.customFields.all }),
  });
}

export function useArchiveCustomField() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      api<CustomFieldDef>(`/custom-fields/${id}/${archive ? "archive" : "restore"}`, {
        method: "POST",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.customFields.all }),
  });
}

export function useCustomFieldValues(scope: "workspace" | "client", entityId: string) {
  return useQuery({
    queryKey: queryKeys.customFields.values(scope, entityId),
    queryFn: () =>
      api<{ items: CustomFieldValue[] }>(`/custom-fields/values/${scope}/${entityId}`).then(
        (r) => r.items,
      ),
  });
}

export function useSaveCustomFieldValues(scope: "workspace" | "client", entityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CustomFieldValue[]) =>
      api<{ items: CustomFieldValue[] }>(`/custom-fields/values/${scope}/${entityId}`, {
        method: "PUT",
        json: { values },
      }).then((r) => r.items),
    onSuccess: (items) =>
      queryClient.setQueryData(queryKeys.customFields.values(scope, entityId), items),
  });
}

/** Fetches the preview HTML for a template config. Aborts when a newer call starts. */
export async function fetchPreview(
  input: { config: TemplateDetail["config"]; documentId?: string },
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch("/render/preview", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/html" },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) throw new Error(`The preview failed (${res.status})`);
  return res.text();
}
