import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { FreeValuationProcessing } from "@/features/analyses/components/free-valuation-processing";
import type { TotalLossClaimSecured } from "@/features/total-loss-claim/contracts";
import { resolvedTotalLossClaimJourneyState } from "@/features/total-loss-claim/workflow-route";
import "./report-processing-screen.css";

export function ReportProcessingScreen({
  claim,
  onRefresh,
}: {
  readonly claim: TotalLossClaimSecured;
  readonly onRefresh: () => Promise<unknown>;
}) {
  const fulfillment = claim.journey?.fulfillmentState ?? "finalizing";
  const exception = fulfillment === "exception_review";
  const needsAttention =
    fulfillment === "needs_attention" ||
    resolvedTotalLossClaimJourneyState(claim) === "needs_attention";
  const heading = needsAttention
    ? "We need to check a detail in your case"
    : exception
      ? "We’re checking a detail before your report is ready"
      : "We’re preparing your valuation report";
  const description = needsAttention
    ? "Venfour could not safely move your case forward yet. Your case and any completed payment remain recorded; check again or contact support if this continues."
    : exception
      ? "A detail needs an additional quality check before the report can be released. There’s nothing you need to do right now."
      : "Venfour is validating the evidence and preparing the customer-ready report. This may take a little time.";

  if (!needsAttention && !claim.journey?.retryable) {
    return <FreeValuationProcessing
      fullScreen
      reviewKey={claim.caseId}
      phase="preparing"
      heading={heading}
      description={exception ? description : "We’re checking your report and supporting evidence before it’s ready."}
      notice="Your progress is saved. You can close this page and return to your case."
    />;
  }

  return (
    <section className="report-preparation">
        <p className="report-preparation__eyebrow">
          {needsAttention ? "Case status" : claim.commerce?.paymentStatus === "succeeded" ? "Payment received" : "Report preparation"}
        </p>
        <h1 className="report-preparation__heading">
          {heading}
        </h1>
        <p
          className="report-preparation__description"
          aria-live="polite"
          aria-busy={!needsAttention}
        >
          {description}
        </p>
        {!needsAttention ? <div className="workspace-processing__line" aria-hidden /> : null}
        {claim.journey?.retryable || needsAttention ? (
          <div className="mt-7 flex flex-wrap gap-3">
            <Button
              onClick={() => void onRefresh()}
              type="button"
              variant="outline"
            >
              Check again
            </Button>
            {needsAttention ? (
              <Button asChild variant="ghost">
                <Link to="/contact">Contact support</Link>
              </Button>
            ) : null}
          </div>
        ) : null}
          <p className="workspace-report-status">
            {needsAttention
              ? "Your case remains saved. Checking again only refreshes its status; it does not repeat any completed payment or processing step."
              : "You can close this browser and return to your saved case. Report preparation continues independently of this page."}
          </p>
    </section>
  );
}
