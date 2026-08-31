import type {
  TotalLossClaimJourneyState,
  TotalLossClaimResolver,
} from "@/features/total-loss-claim/contracts";

type LegacyCaseView = "overview" | "evidence" | "request" | "activity";
type LegacyReviewView =
  | "review_result"
  | "review_insurer"
  | "review_market"
  | "review_meaning"
  | "review_next"
  | "review_request"
  | "review_sent";

export type TotalLossClaimWorkflowView =
  | LegacyCaseView
  | LegacyReviewView
  | "checkout"
  | "checkout_return"
  | "processing"
  | "result"
  | "insurer_review"
  | "valuation"
  | "report"
  | "what_next"
  | "send";

export function totalLossClaimBasePath(caseId: string) {
  return `/total-loss/cases/${encodeURIComponent(caseId)}/claim`;
}

export function totalLossClaimViewPath(
  caseId: string,
  view: TotalLossClaimWorkflowView,
) {
  const base = totalLossClaimBasePath(caseId);
  switch (view) {
    case "checkout":
      return `${base}/checkout`;
    case "checkout_return":
      return `${base}/checkout/return`;
    case "processing":
      return `${base}/processing`;
    case "overview":
    case "result":
    case "review_result":
      return `${base}/review/result`;
    case "insurer_review":
    case "review_insurer":
      return `${base}/review/insurer`;
    case "evidence":
    case "valuation":
    case "review_market":
      return `${base}/review/market`;
    case "review_meaning":
      return `${base}/review/meaning`;
    case "report":
    case "what_next":
    case "review_next":
      return `${base}/review/next`;
    case "activity":
    case "review_sent":
      return `${base}/review/sent`;
    case "request":
    case "send":
    case "review_request":
      return `${base}/review/request`;
  }
}

export function routeForJourneyState(
  caseId: string,
  state: TotalLossClaimJourneyState,
) {
  switch (state) {
    case "secure_claim":
      return totalLossClaimBasePath(caseId);
    case "checkout":
      return totalLossClaimViewPath(caseId, "checkout");
    case "checkout_confirmation":
      return totalLossClaimViewPath(caseId, "checkout");
    case "processing":
    case "needs_attention":
      return totalLossClaimViewPath(caseId, "processing");
    case "guide_result":
    case "no_dispute":
      return totalLossClaimViewPath(caseId, "result");
    case "guide_insurer_review":
      return totalLossClaimViewPath(caseId, "insurer_review");
    case "guide_valuation":
      return totalLossClaimViewPath(caseId, "valuation");
    case "guide_report":
      return totalLossClaimViewPath(caseId, "report");
    case "guide_what_next":
      return totalLossClaimViewPath(caseId, "what_next");
    case "prepare_request":
      return totalLossClaimViewPath(caseId, "request");
    case "awaiting_insurer_response":
      return totalLossClaimViewPath(caseId, "activity");
  }
}

function legacyJourneyState(
  claim: TotalLossClaimResolver,
): TotalLossClaimJourneyState | null {
  if (claim.state !== "secured") return "secure_claim";
  const task = claim.commerce?.nextTask ?? claim.workflow?.currentTask ?? null;
  switch (task) {
    case "checkout":
      return "checkout";
    case "purchase_complete":
    case "finalizing":
      return "processing";
    case "exception_review":
    case "payment_review":
    case "purchase_unavailable":
      return "needs_attention";
    case "report_ready":
      return "guide_result";
    case "no_dispute_supported":
    case "no_dispute_resolved":
      return "no_dispute";
    case "awaiting_insurer_response":
      return "awaiting_insurer_response";
    case "secure_claim":
    case null:
      return null;
    default:
      return null;
  }
}

export function authoritativeTotalLossClaimPath(
  claim: TotalLossClaimResolver,
): string | null {
  if (claim.state === "secure_required")
    return totalLossClaimViewPath(claim.caseId, "checkout");
  const state = claim.journey?.nextState ?? legacyJourneyState(claim);
  return state ? routeForJourneyState(claim.caseId, state) : null;
}

export function isCompletedAnalysisView(view: TotalLossClaimWorkflowView) {
  return (
    view.startsWith("review_") ||
    view === "overview" ||
    view === "evidence" ||
    view === "request" ||
    view === "activity" ||
    view === "result" ||
    view === "insurer_review" ||
    view === "valuation" ||
    view === "report" ||
    view === "what_next" ||
    view === "send"
  );
}

export type CompletedAnalysisSection =
  | "result"
  | "insurer"
  | "market"
  | "report"
  | "request"
  | "sent";

export function completedAnalysisSection(
  view: TotalLossClaimWorkflowView,
  searchParameters: URLSearchParams,
): CompletedAnalysisSection {
  const details = searchParameters.get("details");
  if (details === "insurer" || details === "market" || details === "report") {
    return details;
  }
  switch (view) {
    case "insurer_review":
    case "review_insurer":
      return "insurer";
    case "evidence":
      return searchParameters.get("evidence") === "insurer"
        ? "insurer"
        : "market";
    case "valuation":
    case "review_market":
      return "market";
    case "report":
    case "what_next":
    case "review_next":
      return "report";
    case "send":
    case "request":
    case "review_request":
      return "request";
    case "activity":
    case "review_sent":
      return "sent";
    default:
      return "result";
  }
}
