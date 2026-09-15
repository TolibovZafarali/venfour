import { ValuationStatus } from "@/components/valuation-status";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { FileText, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { validateTotalLossPdf } from "@/features/total-loss/validation";
import { ContinueReviewAction } from "@/features/total-loss-claim/components/continue-review-action";
import { confirmFullReview, extractFullReview, fullReviewKey, getFullReview, uploadFullReview, type FullReviewState } from "@/features/full-review/api";
import { fullReviewContinuationInput } from "./continuation";

export interface ReportConfirmationDraft { readonly key: string; readonly answer: string }

export function FullReviewReport({ caseId, userId, accessToken, headingLevel = "h1", onBusyChange, onComplete, confirmationDraft, onConfirmationDraftChange }: {
  caseId: string; userId: string; accessToken: string;
  headingLevel?: "h1" | "h2";
  onBusyChange?: (busy: boolean) => void;
  onComplete?: () => void;
  confirmationDraft?: ReportConfirmationDraft | null;
  onConfirmationDraftChange?: (draft: ReportConfirmationDraft) => void;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [recovering, setRecovering] = useState(false);
  const query = useQuery({ queryKey: fullReviewKey(userId, caseId), queryFn: ({ signal }) => getFullReview(caseId, accessToken, signal),
    enabled: !busy,
    refetchInterval: (q) => (recovering && !q.state.data?.report) || ["uploading", "uploaded", "extracting"].includes(q.state.data?.status ?? "") || q.state.data?.paymentReadiness.status === "processing" ? 3000 : q.state.data?.paymentReadiness.status === "awaiting_approval" ? 15000 : false });
  const [error, setError] = useState<string | null>(null);
  const [localAnswer, setLocalAnswer] = useState("");
  const state = query.data;
  const issue = state?.issues[0];
  const draftKey = JSON.stringify([state?.report?.id, state?.report?.revision, issue?.field, issue?.code, issue?.savedValue, issue?.reportValue]);
  const answer = onConfirmationDraftChange ? confirmationDraft?.key === draftKey ? confirmationDraft.answer : "" : localAnswer;
  function setAnswer(value: string) {
    if (onConfirmationDraftChange) onConfirmationDraftChange({ key: draftKey, answer: value });
    else setLocalAnswer(value);
  }
  const preparing = state?.status === "extracting" || state?.paymentReadiness.status === "processing";
  const continuationInput = fullReviewContinuationInput(state);
  const completed = state?.status === "ready" && state.ready && !!state.report && !state.issues.length
    && ["eligible", "insufficient"].includes(state.paymentReadiness.status);
  useEffect(() => {
    if (completed && query.isFetchedAfterMount && !query.isFetching && !query.isError && !busy && !recovering && !error) onComplete?.();
  }, [completed, query.isFetchedAfterMount, query.isFetching, query.isError, busy, recovering, error, onComplete]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (!recovering || state?.report) return;
    const timer = window.setTimeout(() => {
      setRecovering(false);
      setError("We couldn’t confirm the upload. Try uploading the same PDF again; any saved copy will be reused.");
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [recovering, state?.report]);
  async function run(action: () => Promise<FullReviewState>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); setRecovering(false);
    const before = state;
    await client.cancelQueries({ queryKey: fullReviewKey(userId, caseId) });
    try {
      await action();
      // Read persisted state after acknowledgement; mutation responses cannot
      // overwrite a newer report or a completed background preparation.
      await query.refetch();
      setAnswer("");
    } catch {
      const recovered = await query.refetch();
      const saved = recovered.data;
      if (!before?.report && !saved?.report) setRecovering(true);
      else if (!saved || (saved.report?.id === before?.report?.id && saved.report?.revision === before?.report?.revision
          && saved.paymentReadiness.status === before?.paymentReadiness.status)) {
        setError("We couldn’t finish this step. Your case and saved report are preserved. Please try again.");
      }
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (query.isPending) return <ValuationStatus kind="loading" headingLevel={headingLevel} heading="Opening your saved report" description="Retrieving your review details." />;
  if (query.isError && !state) return <ValuationStatus kind="error" headingLevel={headingLevel} heading="We couldn’t open your report." description="Your review is saved. Try opening it again."><Button onClick={() => void query.refetch()}>Try again</Button><Button asChild variant="outline"><Link to="/contact">Contact support</Link></Button></ValuationStatus>;
  const heading = busy ? "Saving your report."
    : preparing ? state?.status === "extracting" ? "Reading your valuation report." : "Reviewing your report and evidence."
    : issue ? "One detail to confirm."
    : state?.ready ? state.paymentReadiness.eligible ? "Ready for your full review." : "Your report is saved."
    : state?.status === "report_invalid" ? "We need the complete valuation report."
    : "Add your insurer’s valuation report";
  const Heading = headingLevel;
  return <section className="workspace-stage" aria-labelledby="full-review-heading">
    <p className="workspace-stage__eyebrow">Full valuation review</p>
    <Heading id="full-review-heading" className="workspace-stage__heading">{heading}</Heading>
    {!state?.report && !busy && !recovering ? <p className="workspace-stage__description">Add the complete PDF so we can review your vehicle details, comparable vehicles, and adjustments.</p> : null}
    {query.isError ? <div className="mt-6" role="alert"><p>We couldn’t open the report details.</p><Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div> : null}
    {state ? <>
      {state.report ? <div className="workspace-report-file"><FileText aria-hidden /><div><strong>{state.report.filename}</strong><span>Saved securely to this case</span></div></div> : null}
      {busy || recovering || preparing || (!state.ready && state.status !== "report_required") ? <p className="workspace-report-status" role="status">{busy ? "Saving your report…" : recovering && !state.report ? "Checking for your saved upload…" : preparing ? "Checking your report and saved evidence. Your progress is saved." : state.message}</p> : null}
      {preparing || busy ? <div className="workspace-processing__line" aria-hidden /> : null}
      {!state.ready && !state.locked && !preparing && !issue ? <>
        {state.canReuseReport ? <Button className="mt-5" disabled={busy} onClick={() => void run(() => extractFullReview(caseId, accessToken))}>Use my saved valuation report</Button> : null}
        {state.paymentReadiness.status !== "failed" && (state.status === "extraction_failed" || state.status === "uploaded" || state.status === "uploading") ? <Button className="mt-5 mr-3" disabled={busy} variant="outline" onClick={() => void run(() => extractFullReview(caseId, accessToken))}>Try reading the saved report again</Button> : null}
        <label htmlFor="full-review-report" className="workspace-upload">
          <Upload aria-hidden />
          <span className="workspace-upload__title">{state.report ? "Upload a replacement PDF" : "Choose the complete valuation PDF"}</span>
          <span className="workspace-upload__hint">Include all comparable vehicle and adjustment pages.</span>
          <span className="workspace-upload__button" aria-hidden>Choose PDF</span>
          <input id="full-review-report" aria-label={state.report ? "Upload a replacement PDF" : "Choose the complete valuation PDF"} type="file" accept="application/pdf,.pdf" disabled={busy}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              const validation = validateTotalLossPdf(file);
              if (!validation.valid) { setError(validation.error); return; }
              void run(() => uploadFullReview(caseId, accessToken, file));
              event.currentTarget.value = "";
            }} />
        </label>
      </> : null}
      {issue && state.report ? <form key={`${state.report.id}:${issue.field}`} className="workspace-confirmation" onSubmit={event => { event.preventDefault(); if (answer && state.report) void run(() => confirmFullReview(caseId, accessToken, state.report!, { [issue.field]: answer })); }}>
        <fieldset disabled={busy}><legend className="font-medium text-ink">{issue.message}</legend>
          {issue.code === "REPORT_FACT_CONFLICT" ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {([ ["report", "In the report", issue.reportValue], ["saved", "Saved in this case", issue.savedValue] ] as const).map(([value,label,fact]) => <label key={value} className="flex cursor-pointer gap-3 rounded-lg border border-line p-4 text-sm"><input type="radio" name="fact" value={value} checked={answer === value} onChange={() => setAnswer(value)} /><span>{label}<strong className="mt-1 block">{fact}</strong></span></label>)}
          </div> : issue.field === "drivetrain" ? <label className="mt-4 block text-sm">Drive type<select className="mt-2 block min-h-11 w-full rounded-lg border border-line bg-surface px-3" aria-label="Drive type" value={answer} required onChange={event => setAnswer(event.target.value)}>
            <option value="">Choose drive type</option><option value="FWD">Front-wheel drive</option><option value="RWD">Rear-wheel drive</option><option value="AWD">All-wheel drive</option><option value="4WD">Four-wheel drive</option>
          </select></label> : <label className="mt-4 block text-sm">Vehicle detail<input className="mt-2 block min-h-11 w-full rounded-lg border border-line bg-surface px-3" aria-label="Vehicle detail" value={answer} maxLength={200} required onChange={event => setAnswer(event.target.value)} /></label>}
          <p className="mt-3 text-xs leading-5 text-copy">This choice applies to the full review. The original report and your free result remain in your case history.</p>
          <Button className="mt-4" disabled={busy || !answer.trim()} type="submit">Confirm and continue</Button>
        </fieldset>
      </form> : null}
      {state.ready ? continuationInput
        ? <ContinueReviewAction accessToken={accessToken} caseId={caseId} userId={userId} label="Continue to payment"
            input={continuationInput} />
        : state.paymentReadiness.status === "insufficient"
          ? <p className="workspace-report-status" role="status">We don’t yet have enough reliable market evidence to offer the full review. Your report and free result are saved.</p>
          : state.paymentReadiness.status === "not_evaluated" && !state.locked
            ? <Button className="mt-5" disabled={busy} onClick={() => void run(() => extractFullReview(caseId, accessToken))}>Check review availability</Button>
            : !preparing ? <p className="workspace-report-status" role="status">The full review is not available right now. Your report and free result are saved.</p> : null
        : null}
      {state.locked && !state.ready ? <Button asChild className="mt-5"><Link to={`/total-loss/cases/${caseId}/claim`}>Continue review</Link></Button> : null}
      {busy ? <LoaderCircle className="sr-only" aria-label="Checking report" /> : null}
    </> : null}
    {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
    {!state?.report && !busy && !recovering ? <details className="workspace-report-help"><summary>Don’t have it yet?</summary><p>Ask your insurer for the complete total-loss vehicle valuation report, including comparable vehicles and adjustments. Add it here whenever you’re ready.</p></details> : null}
  </section>;
}
