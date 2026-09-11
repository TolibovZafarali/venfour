import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "react-router";
import { ArrowLeft, FileText, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, useSignInDialog } from "@/features/auth";
import { validateTotalLossPdf } from "@/features/total-loss/validation";
import { LocalContinueAction } from "@/features/total-loss-claim/components/local-continue-action";
import { ClaimWorkflowCard, ClaimWorkflowFrame } from "@/features/total-loss-claim/components/claim-workflow-shell";
import { confirmFullReview, extractFullReview, fullReviewKey, getFullReview, uploadFullReview, type FullReviewState } from "@/features/full-review/api";

export function FullReviewReport({ caseId, userId, accessToken }: { caseId: string; userId: string; accessToken: string }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: fullReviewKey(userId, caseId), queryFn: () => getFullReview(caseId, accessToken),
    refetchInterval: (q) => q.state.data?.status === "extracting" ? 3000 : false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const state = query.data;
  const issue = state?.issues[0];
  async function run(action: () => Promise<FullReviewState>) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await action();
      client.setQueryData(fullReviewKey(userId, caseId), result);
      setAnswer("");
    } catch {
      setError("We couldn’t finish this step. Your case and saved report are preserved. Please try again.");
    } finally { setBusy(false); }
  }
  return <ClaimWorkflowFrame>
    <Link className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-copy" to={`/total-loss/cases/${caseId}/analysis`}><ArrowLeft className="size-4" aria-hidden />Back to your free estimate</Link>
    <ClaimWorkflowCard>
      <p className="text-sm font-medium text-brand">Your full valuation review</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Add your insurer’s valuation report</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-copy">Your free estimate is saved. We’ll use the complete report to review the vehicle details, comparable vehicles, and valuation adjustments before payment becomes available.</p>
      {query.isPending ? <p className="mt-6" role="status">Opening your saved report details…</p> : null}
      {query.isError ? <div className="mt-6" role="alert"><p>We couldn’t open the report details.</p><Button className="mt-3" variant="outline" onClick={() => void query.refetch()}>Try again</Button></div> : null}
      {state ? <>
        {state.report ? <div className="mt-6 flex gap-3 rounded-xl border border-line bg-surface p-4"><FileText className="size-5 shrink-0" aria-hidden /><div><p className="break-all text-sm font-medium">{state.report.filename}</p><p className="mt-1 text-sm text-copy">Saved securely to this case</p></div></div> : null}
        <p className="mt-5 text-sm leading-6 text-copy" role="status">{busy ? "Saving and checking your report…" : state.status === "extracting" ? "Reading your report. You can leave and return to this case." : state.message}</p>
        {!state.ready && !state.locked && state.status !== "extracting" && !issue ? <>
          {state.canReuseReport ? <Button className="mt-5" disabled={busy} onClick={() => void run(() => extractFullReview(caseId, accessToken))}>Use my saved valuation report</Button> : null}
          {state.status === "extraction_failed" || state.status === "uploaded" || state.status === "uploading" ? <Button className="mt-5 mr-3" disabled={busy} variant="outline" onClick={() => void run(() => extractFullReview(caseId, accessToken))}>Try reading the saved report again</Button> : null}
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
            </div> : <label className="mt-4 block text-sm">Vehicle detail<input className="mt-2 block min-h-11 w-full rounded-lg border border-line bg-surface px-3" aria-label="Vehicle detail" value={answer} maxLength={200} required onChange={event => setAnswer(event.target.value)} /></label>}
            <p className="mt-3 text-xs leading-5 text-copy">This choice applies to the full review. The original report and your free estimate remain in your case history.</p>
            <Button className="mt-4" disabled={busy || !answer.trim()} type="submit">Confirm and continue</Button>
          </fieldset>
        </form> : null}
        {state.ready ? <LocalContinueAction accessToken={accessToken} caseId={caseId} userId={userId} label="Continue to secure checkout" /> : null}
        {busy ? <LoaderCircle className="mt-4 size-5 animate-spin motion-reduce:animate-none" aria-label="Checking report" /> : null}
      </> : null}
      {error ? <p className="mt-4 text-sm text-danger" role="alert">{error}</p> : null}
      <div className="mt-8 border-t border-line pt-5"><h2 className="font-medium text-ink">Don’t have the report yet?</h2><p className="mt-2 text-sm leading-6 text-copy">Ask your insurer for the complete total-loss vehicle valuation report, including the comparable vehicles and adjustment pages. You can return here when it’s available.</p><Button asChild className="mt-4" variant="outline"><Link to="/appraisals">Return to my appraisals</Link></Button></div>
    </ClaimWorkflowCard>
  </ClaimWorkflowFrame>;
}

export function TotalLossFullReviewPage() {
  const { caseId = "" } = useParams(); const { auth } = useAuth(); const { openSignIn } = useSignInDialog(); const location = useLocation();
  if (auth.status === "signedIn") return <FullReviewReport key={`${auth.user.id}:${caseId}`} caseId={caseId} userId={auth.user.id} accessToken={auth.session.access_token} />;
  return <ClaimWorkflowFrame><ClaimWorkflowCard><h1 className="text-2xl font-semibold">Your saved valuation review</h1><p className="mt-4 text-copy">{auth.status === "loading" ? "Checking secure access…" : "Sign in to open this private case and its report."}</p>{auth.status === "signedOut" ? <Button className="mt-5" onClick={() => openSignIn({ returnTo: location.pathname })}>Sign in</Button> : null}</ClaimWorkflowCard></ClaimWorkflowFrame>;
}
