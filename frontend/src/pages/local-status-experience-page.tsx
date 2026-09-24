import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { ValuationStatus } from "@/components/valuation-status";
import { FreeValuationProcessing } from "@/features/analyses/components/free-valuation-processing";
import { TotalLossAnalysisResult } from "@/features/analyses/components/total-loss-analysis-experience";
import { materialUndervalueAnalysis } from "@/test/fixtures/analysis-presentation";

const states = ["processing", "success", "insufficient", "unavailable", "retry", "missing", "saved", "expired"] as const;
type State = typeof states[number];

// This route is registered only in development. Its actions never call a service.
export function LocalStatusExperiencePage() {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const initial = query.get("state") as State;
  const [state, setState] = useState<State>(states.includes(initial) ? initial : "processing");
  const [completeAs, setCompleteAs] = useState<State>("insufficient");
  useEffect(() => {
    const timer = window.setTimeout(() => { if (states.includes(initial)) setState(initial); }, 0);
    return () => window.clearTimeout(timer);
  }, [initial]);
  useEffect(() => {
    if (state !== "processing") return;
    const timer = window.setTimeout(() => setState(completeAs), 6500);
    return () => window.clearTimeout(timer);
  }, [state, completeAs]);
  const reset = (next: State) => { setCompleteAs(next); setState("processing"); };
  const analysis = structuredClone(materialUndervalueAnalysis);
  if (state === "insufficient") {
    analysis.assessment.classification = "INSUFFICIENT_EVIDENCE";
    analysis.primaryExternalEvidence = null;
    analysis.marketSearchContext = { baselineStatus: "LIMITED", summary: "Limited market evidence", stopReasons: [], recovery: {kind: "UNRESOLVED_CONFIGURATION", field: "engine", correctionStep: null, message: "We need to check the vehicle details in your saved report. You don’t need to upload it again."} };
  }
  return <div className="w-full pb-44 sm:pb-20">
    <nav aria-label="Synthetic state controls" className="fixed bottom-0 left-0 right-0 z-[70] flex flex-wrap items-center justify-center gap-2 bg-canvas/95 px-3 py-2 text-xs backdrop-blur-sm">
      <strong className="mr-2">Synthetic preview · no requests</strong>
      {states.map(value => <button key={value} className="min-h-11 rounded px-2 underline underline-offset-4 focus-visible:outline-2" onClick={() => setState(value)}>{value}</button>)}
      <button className="min-h-11 rounded px-2 font-semibold text-brand" onClick={() => reset(state === "processing" ? "insufficient" : state)}>Replay transition</button>
    </nav>
    {state === "processing" ? <FreeValuationProcessing reviewKey="synthetic-status" development />
      : state === "success" || state === "insufficient" ? <TotalLossAnalysisResult analysis={analysis} continueAction={<Button onClick={() => setState("saved")}>Upload insurer valuation report</Button>} insurerReportPath="?state=saved" />
      : <ValuationStatus kind={["unavailable", "retry", "expired"].includes(state) ? "error" : "secure"}
          eyebrow={state === "saved" ? "Ready when you are" : undefined}
          heading={state === "saved" ? "Your review is saved." : state === "expired" ? "Let’s get you a new link." : state === "missing" ? "Add your ZIP code to continue." : "We couldn’t finish your value check."}
          description={state === "saved" ? "Come back when you have your insurer’s valuation report." : state === "expired" ? "This link has expired. Request a new one to reopen your saved review." : state === "missing" ? "We use your ZIP code to find nearby vehicles." : "We couldn’t complete the check right now. Your information is saved."}>
          <Button onClick={() => state === "retry" || state === "unavailable" ? reset("success") : setState("saved")}>{state === "saved" ? "Return to my reviews" : state === "expired" ? "Get a new link" : state === "missing" ? "Add ZIP code" : "Try again"}</Button>
          {state === "unavailable" || state === "retry" ? <Button variant="outline" onClick={() => setState("saved")}>Return to my reviews</Button> : null}
        </ValuationStatus>}
  </div>;
}
