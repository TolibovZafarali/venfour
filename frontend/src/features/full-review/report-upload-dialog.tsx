import { ArrowRight, Upload, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { FullReviewReport, type ReportConfirmationDraft } from "./report-review";
import { fullReviewKey, getFullReview } from "./api";
import { fullReviewContinuationInput } from "./continuation";
import { ContinueReviewAction } from "@/features/total-loss-claim/components/continue-review-action";
import { ReviewPrice, ReviewRefundProtection } from "./refund-protection";
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
  const actionRef = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: fullReviewKey(userId, caseId), queryFn: ({ signal }) => getFullReview(caseId, accessToken, signal),
    enabled: !open,
    refetchInterval: q => ["uploading", "uploaded", "extracting"].includes(q.state.data?.status ?? "") || q.state.data?.paymentReadiness.status === "processing" ? 3000 : false });
  const state = query.isError ? undefined : query.data;
  const continuationInput = fullReviewContinuationInput(state);
  const showOffer = Boolean(state && !state.locked && !open && (state.status === "report_required" || continuationInput));
  const completed = state?.ready && ["eligible", "insufficient"].includes(state.paymentReadiness.status);
  const hasSavedReport = Boolean(state?.report || state?.canReuseReport);
  const triggerLabel = query.isPending ? "Checking saved report…"
    : !state ? "Open report review"
    : state.status === "report_invalid" ? "Replace incomplete report"
    : hasSavedReport ? "Review saved report" : "Upload valuation report";
  const finish = useCallback(() => {
    const params = new URLSearchParams(search);
    params.delete("upload");
    void navigate({ pathname: `/total-loss/cases/${caseId}/analysis`, search: params.toString() }, { replace: true, preventScrollReset: true });
  }, [caseId, navigate, search]);

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
      <Button size="lg" className="valuation-result__upload-action" disabled={query.isPending}>{triggerLabel}{hasSavedReport ? <ArrowRight aria-hidden /> : <Upload aria-hidden />}</Button>
    </Dialog.Trigger>;
  const action = <div ref={actionRef} tabIndex={-1} data-report-review-complete={completed || undefined}>
    {completed ? <p className="valuation-result__next-copy" role="status">{state.paymentReadiness.status === "insufficient" ? "Your report is saved. We need more reliable evidence before we can offer the full review." : "Your report is saved and ready."}</p>
      : <p className="valuation-result__next-copy">{query.isPending ? "Checking for your saved report."
        : !state ? "We couldn’t check your saved report. Open the review to try again."
        : state.status === "report_invalid" ? "Please replace this file with the complete valuation report."
        : hasSavedReport ? "Continue with the report you already uploaded."
        : "Add your insurer’s valuation report to continue. Your free result stays saved."}</p>}
    {showOffer ? <div className="review-offer"><ReviewPrice /></div> : null}
    {continuationInput ? <ContinueReviewAction accessToken={accessToken} caseId={caseId} userId={userId} label="Get my full review" input={continuationInput} /> : completed
      ? state.paymentReadiness.status === "eligible" ? <p className="valuation-result__payment-note">Payment is unavailable right now. Please try again later.</p> : null
      : <>{trigger}<p className="valuation-result__payment-note">{state && !hasSavedReport ? "Upload free. Review the price before paying." : "No payment at this step"}</p></>}
    {showOffer ? <div className="review-offer"><ReviewRefundProtection /></div> : null}
  </div>;
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    {children ? children(action) : action}
    <Dialog.Portal>
      <Dialog.Overlay className="report-upload-overlay" />
      <Dialog.Content className="report-upload-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }} onCloseAutoFocus={event => {
        if (actionRef.current) { event.preventDefault(); (actionRef.current.querySelector<HTMLButtonElement>("button") ?? actionRef.current).focus(); }
      }}>
        <Dialog.Title className="sr-only">Insurer valuation review</Dialog.Title>
        <Dialog.Description className="sr-only">Upload or use your saved report, then confirm any details we need. Your free result stays saved.</Dialog.Description>
        <div className="report-upload-dialog__body">
          <FullReviewReport key={`${userId}:${caseId}`} caseId={caseId} userId={userId} accessToken={accessToken} headingLevel="h2" onBusyChange={setBusy} onComplete={finish} confirmationDraft={confirmationDraft} onConfirmationDraftChange={setConfirmationDraft} />
        </div>
        <Dialog.Close asChild><button type="button" className="report-upload-dialog__close" aria-label="Close report review" disabled={busy}><X aria-hidden /></button></Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
