import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserRole } from "../../../shared/domain";
import type {
  BrandKit,
  BrandKitInput,
  TeamMember,
  TeamMemberInput,
  WorkspaceSettings,
  WorkspaceSettingsInput,
} from "../../../shared/schemas/settings";
import type { TaxRate, TaxRateInput } from "../../../shared/schemas/tax-rate";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";

export function useWorkspaceSettings() {
  return useQuery({
    queryKey: queryKeys.settings.workspace,
    queryFn: () => api<WorkspaceSettings>("/settings/workspace"),
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkspaceSettingsInput) =>
      api<WorkspaceSettings>("/settings/workspace", {
        method: "PATCH",
        json: input,
        toastOnError: false,
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.workspace, data),
  });
}

export function useBrandKit() {
  return useQuery({
    queryKey: queryKeys.settings.brandKit,
    queryFn: () => api<BrandKit>("/settings/brand-kit"),
  });
}

export function useUpdateBrandKit() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BrandKitInput) =>
      api<BrandKit>("/settings/brand-kit", { method: "PATCH", json: input, toastOnError: false }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.brandKit, data),
  });
}

/** Uploads a logo file as the raw request body. */
export function useUploadLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api<BrandKit>("/settings/brand-kit/logo", {
        method: "POST",
        body: file,
        contentType: file.type,
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.brandKit, data),
  });
}

export function useRemoveLogo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<BrandKit>("/settings/brand-kit/logo", { method: "DELETE" }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.brandKit, data),
  });
}

export function useSaveTaxRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: TaxRateInput }) =>
      id
        ? api<TaxRate>(`/tax-rates/${id}`, { method: "PATCH", json: input, toastOnError: false })
        : api<TaxRate>("/tax-rates", { method: "POST", json: input, toastOnError: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.taxRates.all }),
  });
}

export function useArchiveTaxRate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archive }: { id: string; archive: boolean }) =>
      api<TaxRate>(`/tax-rates/${id}/${archive ? "archive" : "restore"}`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.taxRates.all }),
  });
}

export function useTeam(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.team.all,
    queryFn: () => api<{ items: TeamMember[] }>("/team").then((r) => r.items),
    enabled,
  });
}

export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TeamMemberInput) =>
      api<TeamMember>("/team", { method: "POST", json: input, toastOnError: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.team.all }),
  });
}

export function useSetMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      api<TeamMember>(`/team/${id}`, { method: "PATCH", json: { role } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.team.all }),
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<null>(`/team/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.team.all }),
  });
}
