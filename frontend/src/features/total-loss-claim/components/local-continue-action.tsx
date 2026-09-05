import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import type { CaseAnalysisStatus } from "@/features/analyses/api/case-analysis";
import { caseAnalysisQueryKeys } from "@/features/analyses/case-analysis-queries";
import { appraisalCaseQueryKeys } from "@/features/cases/queries";
import { initializeTotalLossClaim } from "@/features/total-loss-claim/api";
import { totalLossClaimQueryKeys } from "@/features/total-loss-claim/queries";

export function LocalContinueAction({ accessToken, caseId, userId }: {
  readonly accessToken: string;
  readonly caseId: string;
  readonly userId: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);
  const failureRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (failed) failureRef.current?.focus();
  }, [failed]);

  async function initialize() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailed(false);
    try {
      const claim = await initializeTotalLossClaim(caseId, accessToken);
      queryClient.setQueryData(totalLossClaimQueryKeys.detail(userId, caseId), claim);
      queryClient.setQueryData<CaseAnalysisStatus>(
        caseAnalysisQueryKeys.detail(userId, caseId),
        (current) => current?.status === "completed"
          ? { ...current, intakeCorrectionAllowed: false }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: appraisalCaseQueryKeys.list(userId) });
      void navigate(`/total-loss/cases/${caseId}/claim/checkout`);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <>
    <Button
      type="button"
      size="lg"
      className="report-action-focus mt-6 min-h-13 w-full gap-3 rounded-xl bg-brand px-7 text-base font-semibold text-white shadow-[0_8px_20px_-10px_rgba(21,94,239,0.55)] hover:bg-brand-strong sm:w-auto sm:min-w-72"
      disabled={pending}
      aria-busy={pending}
      onClick={() => void initialize()}
    >
      {pending ? "Opening your claim…" : "Continue my review"}
      {pending ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowRight className="size-5" aria-hidden />}
    </Button>
    {failed ? <div ref={failureRef} tabIndex={-1} role="alert" className="report-action-focus mx-auto mt-4 max-w-lg rounded-lg border border-line p-4 text-sm text-copy">
      We couldn’t open your claim. Your saved result is unchanged. Please try again.
      <Button type="button" variant="outline" className="ml-3" onClick={() => void initialize()}>Retry</Button>
    </div> : null}
  </>;
}
