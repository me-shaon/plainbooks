import { toast } from "../../components/ui/toast";
import { toastError } from "../../lib/api";

/**
 * Downloads a document PDF through /api/documents/:id/pdf. A 202 means the PDF is still
 * being prepared, so it shows a toast with the wait instead.
 */
export async function downloadPdf(
  documentId: string,
  { revision, filename }: { revision?: number; filename: string },
): Promise<void> {
  const query = revision ? `?revision=${revision}` : "";
  try {
    const res = await fetch(`/api/documents/${documentId}/pdf${query}`, {
      credentials: "same-origin",
    });
    if (res.status === 202) {
      const wait = Number(res.headers.get("retry-after")) || 10;
      toast({
        title: "The PDF is being prepared",
        description: `Try again in about ${wait} seconds.`,
      });
      return;
    }
    if (!res.ok) {
      const info = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(info?.error ?? `Download failed (${res.status})`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    toastError(err, "Could not download the PDF");
  }
}
