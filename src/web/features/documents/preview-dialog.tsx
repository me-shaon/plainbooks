import { Dialog, Modal } from "../../components/ui/dialog";

/** The page width of the document render, in CSS pixels. */
const PAGE_WIDTH = 842;

export interface DocumentPreviewDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** The rendered document HTML. */
  html: string | null;
  title: string;
}

/**
 * Shows the document as the client will see it, with the chosen template. The frame is
 * sandboxed, so the HTML runs no scripts.
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
        <div className="overflow-auto rounded-card bg-sidebar p-3 md:p-5">
          {html ? (
            <iframe
              title={title}
              sandbox=""
              srcDoc={html}
              className="mx-auto block h-[70vh] w-full rounded-small border-0 bg-white shadow-raised"
              style={{ maxWidth: PAGE_WIDTH }}
            />
          ) : null}
        </div>
      </Dialog>
    </Modal>
  );
}
