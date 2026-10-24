import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentKind } from "../../../shared/domain";
import { HOME_CURRENCY } from "../../../shared/money";
import type { ClientDetail } from "../../../shared/schemas/client";
import type { DocumentDetail } from "../../../shared/schemas/document";
import { EmptyState } from "../../components/ui/empty-state";
import { Skeleton } from "../../components/ui/skeleton";
import { toast } from "../../components/ui/toast";
import { api, issuesByPath } from "../../lib/api";
import type { FieldErrors } from "../../lib/form";
import { queryKeys } from "../../lib/query-keys";
import { useTaxRates, useTemplates } from "../../lib/reference-data";
import { useMe } from "../../lib/session";
import { useClients } from "../clients/queries";
import { useWorkspaceSettings } from "../settings/queries";
import { useCustomFields } from "../templates/queries";
import { DocumentEditor, type EditorMode, type SaveIntent } from "./document-editor";
import {
  changeCurrency,
  type EditorValues,
  emptyValues,
  toDocumentInput,
  valuesFromDetail,
} from "./editor-state";
import { documentPath } from "./labels";
import {
  documentTitle,
  kindLabel,
  useCreateDocument,
  useDocument,
  useReviseDocument,
  useUpdateDocument,
  useWorkspaceToday,
} from "./queries";
import { SendDialog } from "./send-dialog";

/** The new-document route: an empty editor, optionally for one client. */
export function NewDocumentPage({ kind, clientId }: { kind: DocumentKind; clientId?: string }) {
  const settings = useWorkspaceSettings();
  const loadClient = useClientLoader();
  const [initial, setInitial] = useState<EditorValues | null>(null);
  const ws = settings.data;

  useEffect(() => {
    if (!ws || initial) return;
    let live = true;
    const base = emptyValues(kind, ws.homeCurrency);
    base.lines = base.lines.map((l) => ({ ...l, taxRateId: ws.defaultTaxRateId }));
    if (!clientId) {
      setInitial(base);
      return;
    }
    // Prefill from the client, so the editor starts with its currency and tax rate.
    loadClient(clientId)
      .then((detail) => {
        if (!live) return;
        const withClient = changeCurrency({ ...base, clientId }, detail.client.defaultCurrency);
        const tax = detail.client.defaultTaxRateId ?? ws.defaultTaxRateId;
        setInitial({
          ...withClient,
          lines: withClient.lines.map((l) => ({ ...l, taxRateId: tax })),
        });
      })
      .catch(() => live && setInitial(base));
    return () => {
      live = false;
    };
  }, [ws, initial, clientId, kind, loadClient]);

  if (!initial) return <EditorSkeleton />;
  return <EditorContainer mode="create" kind={kind} initialValues={initial} />;
}

/** The edit route: edits a draft, or revises a sent invoice without payments. */
export function EditDocumentPage({ documentId }: { documentId: string }) {
  const query = useDocument(documentId);
  if (query.isPending) return <EditorSkeleton />;
  if (query.isError) {
    return (
      <EmptyState title="This document could not be loaded" description={query.error.message} />
    );
  }
  const doc = query.data;
  const isDraft = doc.status === "draft" && doc.number === null;
  const canRevise = doc.kind === "invoice" && doc.status === "sent" && doc.payments.length === 0;
  if (!isDraft && !canRevise) {
    return (
      <EmptyState
        icon={Lock}
        title={`${documentTitle(doc)} cannot be edited`}
        description={
          doc.kind === "invoice" && doc.payments.length > 0
            ? "It has payments. Delete the payments first, or void it and create a new invoice."
            : "Only drafts and sent invoices without payments can change."
        }
        action={
          <Link
            to={documentPath(doc.kind)}
            params={{ documentId: doc.id }}
            className="text-sm font-medium text-accent underline"
          >
            Back to the {kindLabel(doc.kind).toLowerCase()}
          </Link>
        }
      />
    );
  }
  return (
    <EditorContainer
      key={doc.id}
      mode={isDraft ? "edit" : "revise"}
      kind={doc.kind}
      document={doc}
      initialValues={valuesFromDetail(doc)}
    />
  );
}

function EditorSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function useClientLoader() {
  const queryClient = useQueryClient();
  return useCallback(
    (id: string) =>
      queryClient.fetchQuery({
        queryKey: queryKeys.clients.detail(id),
        queryFn: () => api<ClientDetail>(`/clients/${id}`),
        staleTime: 30 * 1000,
      }),
    [queryClient],
  );
}

function EditorContainer({
  mode,
  kind,
  document,
  initialValues,
}: {
  mode: EditorMode;
  kind: DocumentKind;
  document?: DocumentDetail;
  initialValues: EditorValues;
}) {
  const navigate = useNavigate();
  const { isOwner } = useMe();
  const settings = useWorkspaceSettings();
  const clients = useClients({ archived: "active" });
  const taxRates = useTaxRates({ includeArchived: true });
  const templates = useTemplates();
  const customFields = useCustomFields();
  const today = useWorkspaceToday();
  const loadClient = useClientLoader();
  const create = useCreateDocument();
  const update = useUpdateDocument(document?.id ?? "");
  const revise = useReviseDocument(document?.id ?? "");
  const [revising, setRevising] = useState<EditorValues | null>(null);

  const ws = settings.data;
  const defaults = useMemo(
    () => ({
      homeCurrency: ws?.homeCurrency ?? HOME_CURRENCY,
      paymentTermsDays: ws?.defaultPaymentTermsDays ?? 14,
      quoteValidityDays: ws?.defaultQuoteValidityDays ?? 30,
      taxRateId: ws?.defaultTaxRateId ?? null,
      templateId: ws?.defaultTemplateId ?? null,
    }),
    [ws],
  );

  const word = kindLabel(kind);
  const title =
    mode === "create"
      ? `New ${word.toLowerCase()}`
      : mode === "revise" && document
        ? `Revise ${documentTitle(document)}`
        : `Edit draft ${word.toLowerCase()}`;
  const detailPath = documentPath(kind);

  const onSave = async (
    values: EditorValues,
    intent: SaveIntent,
  ): Promise<FieldErrors | undefined> => {
    if (intent === "revise") {
      setRevising(values);
      return undefined;
    }
    try {
      const input = toDocumentInput(values);
      const detail =
        mode === "create" ? await create.mutateAsync(input) : await update.mutateAsync(input);
      toast({ title: mode === "create" ? "Draft saved" : "Changes saved", tone: "success" });
      void navigate({
        to: detailPath,
        params: { documentId: detail.id },
        search: intent === "send" ? { send: true } : {},
      });
      return undefined;
    } catch (err) {
      // The API call already showed a toast. The editor keeps every edit.
      return issuesByPath(err);
    }
  };

  const saveRevision = async (): Promise<DocumentDetail | null> => {
    if (!revising || !document) return null;
    const initialManual = initialValues.fxManual;
    const fxChanged = JSON.stringify(revising.fxManual) !== JSON.stringify(initialManual);
    const { kind: _kind, ...input } = toDocumentInput(revising, { includeFx: fxChanged });
    try {
      const result = await revise.mutateAsync(input);
      return result.document;
    } catch {
      // The API call already showed a toast. The editor keeps every edit.
      return null;
    }
  };

  return (
    <>
      <DocumentEditor
        mode={mode}
        title={title}
        initialValues={initialValues}
        clients={clients.data ?? []}
        taxRates={taxRates.data ?? []}
        templates={templates.data ?? []}
        customFieldDefs={customFields.data ?? []}
        isOwner={isOwner}
        defaults={defaults}
        today={today}
        loadClient={loadClient}
        onSave={onSave}
        onCancel={() =>
          document
            ? navigate({ to: detailPath, params: { documentId: document.id } })
            : navigate({ to: kind === "invoice" ? "/invoices" : "/quotes" })
        }
      />
      {document && mode === "revise" ? (
        <SendDialog
          isOpen={revising !== null}
          onOpenChange={(open) => !open && setRevising(null)}
          document={document}
          revise={{ onSave: saveRevision, issueDate: revising?.issueDate ?? document.issueDate }}
          onDone={(detail) => void navigate({ to: detailPath, params: { documentId: detail.id } })}
        />
      ) : null}
    </>
  );
}
