import { Upload, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { FullReviewReport, type ReportConfirmationDraft } from "./report-review";
import "./report-upload-dialog.css";

export function ReportUploadDialog({ caseId, userId, accessToken, reportWorkspace = false, children }: {
  readonly caseId: string;
  readonly userId: string;
  readonly accessToken: string;
  readonly reportWorkspace?: boolean;
  readonly children?: (trigger: ReactNode) => ReactNode;
}) {
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const openedFrom = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmationDraft, setConfirmationDraft] = useState<ReportConfirmationDraft | null>(null);
  const open = reportWorkspace || search.get("upload") === "report";

  function changeOpen(next: boolean) {
    if (busy) return;
    if (next) {
      openedFrom.current = location.key;
      const params = new URLSearchParams(search);
      params.set("upload", "report");
      setSearch(params, { preventScrollReset: true, state: { reportUploadFrom: location.key } });
    } else if (reportWorkspace) {
      void navigate(`/total-loss/cases/${caseId}/analysis`, { replace: true });
    } else if (openedFrom.current && location.state?.reportUploadFrom === openedFrom.current) {
      void navigate(-1);
    } else {
      const params = new URLSearchParams(search);
      params.delete("upload");
      setSearch(params, { replace: true, preventScrollReset: true });
    }
  }

  const trigger = <Dialog.Trigger asChild>
      <Button size="lg" className="valuation-result__upload-action">Upload insurer valuation report<Upload aria-hidden /></Button>
    </Dialog.Trigger>;
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    {children ? children(trigger) : trigger}
    <Dialog.Portal>
      <Dialog.Overlay className="report-upload-overlay" />
      <Dialog.Content className="report-upload-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <Dialog.Title className="sr-only">Insurer valuation review</Dialog.Title>
        <Dialog.Description className="sr-only">Upload your report, confirm its details, and follow the review. Your free result stays saved.</Dialog.Description>
        <div className="report-upload-dialog__body">
          <FullReviewReport key={`${userId}:${caseId}`} caseId={caseId} userId={userId} accessToken={accessToken} headingLevel="h2" onBusyChange={setBusy} confirmationDraft={confirmationDraft} onConfirmationDraftChange={setConfirmationDraft} />
        </div>
        <Dialog.Close asChild><button type="button" className="report-upload-dialog__close" aria-label="Close report review" disabled={busy}><X aria-hidden /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
