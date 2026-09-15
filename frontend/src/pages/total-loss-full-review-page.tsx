import { ValuationStatus } from "@/components/valuation-status";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, FileText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, useSignInDialog } from "@/features/auth";
import { validateTotalLossPdf } from "@/features/total-loss/validation";
import { ContinueReviewAction } from "@/features/total-loss-claim/components/continue-review-action";
import { ClaimWorkflowCard, ClaimWorkflowFrame } from "@/features/total-loss-claim/components/claim-workflow-shell";
import { confirmFullReview, extractFullReview, fullReviewKey, getFullReview, uploadFullReview, type FullReviewState } from "@/features/full-review/api";

export function FullReviewReport({ caseId, userId, accessToken }: { caseId: string; userId: string; accessToken: string }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [recovering, setRecovering] = useState(false);
  const query = useQuery({ queryKey: fullReviewKey(userId, caseId), queryFn: ({ signal }) => getFullReview(caseId, accessToken, signal),
    enabled: !busy,
    refetchInterval: (q) => (recovering && !q.state.data?.report) || ["uploading", "uploaded", "extracting"].includes(q.state.data?.status ?? "") || q.state.data?.paymentReadiness.status === "processing" ? 3000 : q.state.data?.paymentReadiness.status === "awaiting_approval" ? 15000 : false });
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const state = query.data;
  const issue = state?.issues[0];
  const preparing = state?.status === "extracting" || state?.paymentReadiness.status === "processing";
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
  if (query.isPending) return <ValuationStatus kind="loading" heading="Opening your saved report" description="Retrieving your review details." />;
  if (query.isError && !state) return <ValuationStatus kind="error" heading="We couldn’t open your report." description="Your review is saved. Try opening it again."><Button onClick={() => void query.refetch()}>Try again</Button><Button asChild variant="outline"><Link to="/contact">Contact support</Link></Button></ValuationStatus>;
  return <ClaimWorkflowFrame>
    <Link className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-copy" to={`/total-loss/cases/${caseId}/analysis`}><ArrowLeft className="size-4" aria-hidden />Back to your free result</Link>
    <ClaimWorkflowCard>
      <p className="text-sm font-medium text-brand">Your full valuation review</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Add your insurer’s valuation report</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-copy">Your free result is saved. We’ll check the report details and saved market evidence to see whether we can offer a full review.</p>
      {query.isPending ? <p className="mt-6" role="status">Opening your saved report details…</p> : null}
      {query.isError ? <div className="mt-6" role="alert"><p>We couldn’t open the report details.</p><Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div> : null}
      {state ? <>
        {state.report ? <div className="mt-6 flex gap-3 rounded-xl border border-line bg-surface p-4"><FileText className="size-5 shrink-0" aria-hidden /><div><p className="break-all text-sm font-medium">{state.report.filename}</p><p className="mt-1 text-sm text-copy">Saved securely to this case</p></div></div> : null}
        <p className="mt-5 text-sm leading-6 text-copy" role="status">{busy ? "Saving your report…" : recovering && !state.report ? "Checking for your saved upload…" : preparing ? "Checking your report and saved evidence. You can leave and return to this case." : state.ready ? "Your report details are saved." : state.message}</p>
        {!state.ready && !state.locked && !preparing && !issue ? <>
          {state.canReuseReport ? <Button className="mt-5" disabled={busy} onClick={() => void run(() => extractFullReview(caseId, accessToken))}>Use my saved valuation report</Button> : null}
          {state.paymentReadiness.status !== "failed" && (state.status === "extraction_failed" || state.status === "uploaded" || state.status === "uploading") ? <Button className="mt-5 mr-3" disabled={busy} variant="outline" onClick={() => void run(() => extractFullReview(caseId, accessToken))}>Try reading the saved report again</Button> : null}
          <div className="mt-6 rounded-xl border border-dashed border-line p-5">
            <label htmlFor="full-review-report" className="block text-sm font-medium">{state.report ? "Upload a replacement PDF" : "Choose the complete valuation PDF"}</label>
            <input id="full-review-report" className="mt-3 block w-full text-sm" type="file" accept="application/pdf,.pdf" disabled={busy}
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                if (!file) return;
                const validation = validateTotalLossPdf(file);
                if (!validation.valid) { setError(validation.error); return; }
                void run(() => uploadFullReview(caseId, accessToken, file));
                event.currentTarget.value = "";
              }} />
          </div>
        </> : null}
        {issue && state.report ? <form key={`${state.report.id}:${issue.field}`} className="mt-6 rounded-xl border border-line p-5" onSubmit={event => { event.preventDefault(); if (answer && state.report) void run(() => confirmFullReview(caseId, accessToken, state.report!, { [issue.field]: answer })); }}>
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
        {state.ready ? state.checkoutAvailable && state.paymentReadiness.eligible && state.paymentReadiness.reviewId && state.paymentReadiness.version && state.paymentReadiness.digest && state.report && state.analysisInputId && state.analysisInputRevision
          ? <ContinueReviewAction accessToken={accessToken} caseId={caseId} userId={userId} label="Continue to secure checkout"
              input={{ expectedAnalysisInputId: state.analysisInputId, expectedAnalysisInputRevision: state.analysisInputRevision,
                expectedReportId: state.report.id, expectedReportRevision: state.report.revision,
                expectedStrictReviewId: state.paymentReadiness.reviewId, expectedStrictReviewVersion: state.paymentReadiness.version,
                expectedStrictReviewDigest: state.paymentReadiness.digest }} />
          : state.paymentReadiness.status === "insufficient"
            ? <p className="mt-6 rounded-xl border border-line p-4 text-sm leading-6 text-copy" role="status">We don’t yet have enough reliable market evidence to offer the full review. Your report and free result are saved.</p>
            : state.paymentReadiness.status === "awaiting_approval"
              ? <div className="mt-6 rounded-xl border border-line p-5" role="status"><h2 className="font-medium text-ink">Your review is ready for a final Venfour check.</h2><p className="mt-2 text-sm leading-6 text-copy">We’re completing a final review before payment becomes available. Your case is saved, and you can return here to check its progress.</p></div>
            : state.paymentReadiness.status === "not_evaluated" && !state.locked
              ? <Button className="mt-5" disabled={busy} onClick={() => void run(() => extractFullReview(caseId, accessToken))}>Check review availability</Button>
              : !preparing ? <p className="mt-6 rounded-xl border border-line p-4 text-sm leading-6 text-copy" role="status">The full review is not available right now. Your report and free result are saved.</p> : null
          : null}
        {state.locked && !state.ready ? <Button asChild className="mt-5"><Link to={`/total-loss/cases/${caseId}/claim`}>Return to your saved review</Link></Button> : null}
        {busy ? <LoaderCircle className="mt-4 size-5 animate-spin motion-reduce:animate-none" aria-label="Checking report" /> : null}
      </> : null}
      {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="mt-8 border-t border-line pt-5"><h2 className="font-medium text-ink">Don’t have the report yet?</h2><p className="mt-2 text-sm leading-6 text-copy">Ask your insurer for the complete total-loss vehicle valuation report, including the comparable vehicles and adjustment pages. You can return here when it’s available.</p></div>
    </ClaimWorkflowCard>
  </ClaimWorkflowFrame>;
}

export function TotalLossFullReviewPage() {
  const { caseId = "" } = useParams(); const { auth } = useAuth(); const { openSignIn } = useSignInDialog(); const location = useLocation();
  if (auth.status === "signedIn") return <FullReviewReport key={`${auth.user.id}:${caseId}`} caseId={caseId} userId={auth.user.id} accessToken={auth.session.access_token} />;
  return <ValuationStatus kind={auth.status === "loading" ? "loading" : "secure"} heading="Your saved valuation review" description={auth.status === "loading" ? "Checking secure access…" : "Sign in to open this private case and its report."}>{auth.status === "signedOut" ? <Button onClick={() => openSignIn({ returnTo: location.pathname })}>Sign in</Button> : null}</ValuationStatus>;
}
