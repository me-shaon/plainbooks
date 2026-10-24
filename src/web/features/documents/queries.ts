import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocumentKind } from "../../../shared/domain";
import type {
  ActivityEntry,
  DocumentCreateInput,
  DocumentDetail,
  DocumentListQuery,
  DocumentSummary,
  DocumentUpdateInput,
  FxQuote,
  PaymentInput,
  RevisionSummary,
  SendPreview,
} from "../../../shared/schemas/document";
import type { SendDocumentInput } from "../../../shared/schemas/email";
import { todayIn, WORKSPACE_TIMEZONE } from "../../../shared/time";
import { api } from "../../lib/api";
import { queryKeys } from "../../lib/query-keys";
import { useWorkspaceSettings } from "../settings/queries";

export interface DocumentPage {
  items: DocumentSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export function useDocuments(filters: DocumentListQuery) {
  return useQuery({
    queryKey: queryKeys.documents.list(filters),
    queryFn: ({ signal }) =>
      api<DocumentPage>("/documents", {
        query: filters as Record<string, string | number | undefined>,
        signal,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: queryKeys.documents.detail(id),
    queryFn: () => api<DocumentDetail>(`/documents/${id}`),
  });
}

export function useDocumentActivity(id: string) {
  return useQuery({
    queryKey: queryKeys.documents.activity(id),
    queryFn: () =>
      api<{ items: ActivityEntry[] }>(`/documents/${id}/activity`).then((r) => r.items),
  });
}

export function useDocumentRevisions(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.documents.revisions(id),
    queryFn: () =>
      api<{ items: RevisionSummary[] }>(`/documents/${id}/revisions`).then((r) => r.items),
    enabled,
  });
}

export function useSendPreview(id: string, { revise = false, enabled = true } = {}) {
  return useQuery({
    queryKey: queryKeys.documents.sendPreview(id, revise),
    queryFn: () =>
      api<SendPreview>(`/documents/${id}/send-preview`, {
        query: { revise: revise ? 1 : undefined },
      }),
    enabled,
    staleTime: 0,
  });
}

/** The rate a send on `date` would use. Disabled for the home currency. */
export function useFxRate(currency: string, date: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.fx.rate(currency, date),
    queryFn: () => api<FxQuote>("/fx/rate", { query: { currency, date } }),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
}

/** Stores a fresh detail and refreshes lists, activity, and client pages. */
export function refreshDocument(queryClient: QueryClient, detail?: DocumentDetail) {
  if (detail) queryClient.setQueryData(queryKeys.documents.detail(detail.id), detail);
  void queryClient.invalidateQueries({ queryKey: queryKeys.documents.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.clients.all });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DocumentCreateInput) =>
      api<DocumentDetail>("/documents", { method: "POST", json: input }),
    onSuccess: (detail) => refreshDocument(queryClient, detail),
  });
}

export function useUpdateDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DocumentUpdateInput) =>
      api<DocumentDetail>(`/documents/${id}`, { method: "PATCH", json: input }),
    onSuccess: (detail) => refreshDocument(queryClient, detail),
  });
}

export interface ReviseResult {
  document: DocumentDetail;
  revisionId: string;
  revisionNumber: number;
}

export function useReviseDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DocumentUpdateInput) =>
      api<ReviseResult>(`/documents/${id}/revise`, { method: "POST", json: input }),
    onSuccess: (result) => refreshDocument(queryClient, result.document),
  });
}

export interface SendResult {
  document: DocumentDetail;
  revisionId: string;
  emailId: string;
  recipients: string[];
}

/** Sends by email. Errors are not toasted: the send dialog shows them inline. */
export function useSendDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendDocumentInput) =>
      api<SendResult>(`/documents/${id}/send`, {
        method: "POST",
        json: input,
        toastOnError: false,
      }),
    onSuccess: (result) => refreshDocument(queryClient, result.document),
    // A failed send can still allocate the number, so refresh either way.
    onError: () => refreshDocument(queryClient),
  });
}

type ActionName = "mark-sent" | "void" | "write-off" | "duplicate" | "convert" | "reset-link";

/** POST /documents/:id/<action>. Returns the detail of the affected or new document. */
export function useDocumentAction(id: string, action: ActionName) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await api<DocumentDetail | { document: DocumentDetail }>(
        `/documents/${id}/${action}`,
        { method: "POST", json: {} },
      );
      return "document" in data ? data.document : data;
    },
    onSuccess: (detail) => {
      if (detail.id === id) refreshDocument(queryClient, detail);
      else refreshDocument(queryClient);
    },
  });
}

export function useDeleteDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<null>(`/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.documents.detail(id) });
      refreshDocument(queryClient);
    },
  });
}

/** Records a payment. Errors are not toasted: the dialog shows them inline. */
export function useRecordPayment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PaymentInput) =>
      api<DocumentDetail>(`/documents/${id}/payments`, {
        method: "POST",
        json: input,
        toastOnError: false,
      }),
    onSuccess: (detail) => refreshDocument(queryClient, detail),
  });
}

export function useDeletePayment(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) =>
      api<DocumentDetail>(`/documents/${id}/payments/${paymentId}`, { method: "DELETE" }),
    onSuccess: (detail) => refreshDocument(queryClient, detail),
  });
}

export function kindLabel(kind: DocumentKind): string {
  return kind === "invoice" ? "Invoice" : "Quote";
}

/** "Invoice INV-0042", or "Draft invoice" before a number exists. */
export function documentTitle(doc: { kind: DocumentKind; number: string | null }): string {
  return doc.number
    ? `${kindLabel(doc.kind)} ${doc.number}`
    : `Draft ${kindLabel(doc.kind).toLowerCase()}`;
}

/** Today in the workspace timezone (Asia/Dhaka until the settings load). */
export function useWorkspaceToday(): string {
  const settings = useWorkspaceSettings();
  return todayIn(settings.data?.timezone ?? WORKSPACE_TIMEZONE, Date.now());
}
