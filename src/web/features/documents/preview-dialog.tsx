import { ScaledDocumentFrame } from "../../components/document-frame";
import { Dialog, Modal } from "../../components/ui/dialog";

export interface DocumentPreviewDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The rendered document HTML. */
  html: string | null;
  title: string;
}

/**
 * Shows the document as the client will see it, with the chosen template, at page width
 * scaled to fit, so it looks like the PDF.
 */
export function DocumentPreviewDialog({
  isOpen,
  onOpenChange,
  html,
  title,
}: DocumentPreviewDialogProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} className="max-w-5xl">
      <Dialog
        title={title}
        description="This is how the document looks with the chosen template. Nothing is saved."
      >
        {html ? (
          <ScaledDocumentFrame
            title={title}
            html={html}
            className="h-[70vh] rounded-card bg-[#f1f0ec]"
          />
        ) : null}
      </Dialog>
    </Modal>
  );
}
