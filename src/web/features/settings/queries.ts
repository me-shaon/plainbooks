import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EmailProviderRole, UserRole } from "../../../shared/domain";
import type {
  EmailProviderInput,
  EmailProviderView,
  EmailSettings,
  TestEmailResult,
} from "../../../shared/schemas/email-settings";
import type {
  BrandKit,
  BrandKitInput,
  ExchangeRates,
  ExchangeRatesInput,
  MemberLink,
  TeamMember,
  TeamMemberInput,
  UpdateSettingsInput,
  UpdateStatus,
  WorkspaceSettings,
  WorkspaceSettingsInput,
} from "../../../shared/schemas/settings";
import type { TaxRate, TaxRateInput } from "../../../shared/schemas/tax-rate";
import { api, toastError } from "../../lib/api";
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

export function useExchangeRates() {
  return useQuery({
    queryKey: queryKeys.settings.exchangeRates,
    queryFn: () => api<ExchangeRates>("/settings/exchange-rates"),
  });
}

export function useSaveExchangeRates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ExchangeRatesInput) =>
      api<ExchangeRates>("/settings/exchange-rates", {
        method: "PUT",
        json: input,
        toastOnError: false,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings.exchangeRates, data);
      // Editors show the rate a new document would use.
      void queryClient.invalidateQueries({ queryKey: ["fx"] });
    },
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

/** A brand kit image: the logo or the signature. */
export type BrandImage = "logo" | "signature";

/** Uploads a brand image file as the raw request body. */
export function useUploadBrandImage(image: BrandImage) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) =>
      api<BrandKit>(`/settings/brand-kit/${image}`, {
        method: "POST",
        body: file,
        contentType: file.type,
      }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.brandKit, data),
  });
}

export function useRemoveBrandImage(image: BrandImage) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<BrandKit>(`/settings/brand-kit/${image}`, { method: "DELETE" }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.brandKit, data),
  });
}

export const useUploadLogo = () => useUploadBrandImage("logo");
export const useRemoveLogo = () => useRemoveBrandImage("logo");

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

/** Adds a member. The answer holds the invite link, which shows once. */
export function useAddMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TeamMemberInput) =>
      api<MemberLink>("/team", { method: "POST", json: input, toastOnError: false }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.team.all }),
  });
}

/** Replaces an invite link with a new 7-day link. The old link stops working. */
export function useResendInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<MemberLink>(`/team/${id}/invite`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.team.all }),
  });
}

/** Ends a member's sessions, removes the password, and returns a 24-hour reset link. */
export function useResetSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<MemberLink>(`/team/${id}/reset`, { method: "POST" }),
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

/** The email provider list and the masked settings. Owner only. */
export function useEmailSettings(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.settings.email,
    queryFn: () => api<EmailSettings>("/settings/email"),
    enabled,
  });
}

function setEmailRole(
  current: EmailSettings | undefined,
  role: EmailProviderRole,
  view: EmailProviderView | null,
): EmailSettings | undefined {
  return current ? { ...current, settings: { ...current.settings, [role]: view } } : current;
}

/** Checks the keys with the provider, then saves them. Errors come back to the form. */
export function useSaveEmailProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ role, input }: { role: EmailProviderRole; input: EmailProviderInput }) =>
      api<EmailProviderView>(`/settings/email/${role}`, {
        method: "PUT",
        json: input,
        toastOnError: false,
      }),
    onSuccess: (view, { role }) =>
      queryClient.setQueryData<EmailSettings>(queryKeys.settings.email, (current) =>
        setEmailRole(current, role, view),
      ),
  });
}

export function useRemoveEmailFallback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<null>("/settings/email/fallback", { method: "DELETE" }),
    onSuccess: () =>
      queryClient.setQueryData<EmailSettings>(queryKeys.settings.email, (current) =>
        setEmailRole(current, "fallback", null),
      ),
  });
}

export function useSendTestEmail() {
  return useMutation({
    mutationFn: (role: EmailProviderRole) =>
      api<TestEmailResult>("/settings/email/test", {
        method: "POST",
        json: { role },
        toastOnError: false,
      }),
  });
}

/** The running version and the newest release. Owner only. */
export function useUpdateStatus(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.settings.updates,
    queryFn: () => api<UpdateStatus>("/settings/updates"),
    enabled,
  });
}

export function useSetUpdateCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      api<UpdateStatus>("/settings/updates", { method: "PATCH", json: input }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.updates, data),
  });
}

/** Asks GitHub for the newest release now. Owner only. */
export function useCheckForUpdates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<UpdateStatus>("/settings/updates/check", { method: "POST", toastOnError: false }),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings.updates, data),
    onError: (err) => toastError(err, "Could not check for updates"),
  });
}
