import type {
  TotalLossClaimJourneyState,
  TotalLossClaimResolver,
} from "@/features/total-loss-claim/contracts";
import type { TotalLossIntakeMode } from "@/features/total-loss/types";

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
      return `${base}/review/meaning`;
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
  intakeMode: TotalLossIntakeMode = "report",
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
      return totalLossClaimViewPath(
        caseId,
        intakeMode === "manual" ? "review_market" : "review_insurer",
      );
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
  intakeMode?: TotalLossIntakeMode,
): string | null {
  if (claim.state === "secure_required")
    return totalLossClaimViewPath(claim.caseId, "checkout");
  const state = claim.journey?.nextState ?? legacyJourneyState(claim);
  return state ? routeForJourneyState(claim.caseId, state, intakeMode) : null;
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

export type CompletedAnalysisStage =
  | "result"
  | "insurer"
  | "market"
  | "meaning"
  | "request"
  | "sent";

export function completedAnalysisStage(
  view: TotalLossClaimWorkflowView,
  searchParameters: URLSearchParams,
  intakeMode: TotalLossIntakeMode,
): CompletedAnalysisStage {
  const details = searchParameters.get("details");
  if (details === "report") return "request";
  if (details === "market") return "market";
  if (details === "insurer") return intakeMode === "manual" ? "market" : "insurer";
  switch (view) {
    case "insurer_review":
    case "review_insurer":
      return intakeMode === "manual" ? "market" : "insurer";
    case "evidence":
      return intakeMode === "report" && searchParameters.get("evidence") === "insurer"
        ? "insurer"
        : "market";
    case "valuation":
    case "review_market":
      return "market";
    case "report":
    case "what_next":
    case "review_meaning":
    case "review_next":
      return "meaning";
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

export function canonicalCompletedAnalysisPath(
  caseId: string,
  view: TotalLossClaimWorkflowView,
  searchParameters: URLSearchParams,
  intakeMode: TotalLossIntakeMode,
) {
  const stage = completedAnalysisStage(view, searchParameters, intakeMode);
  const parameters = new URLSearchParams(searchParameters);
  if (
    view === "evidence" &&
    parameters.get("evidence") === "insurer" &&
    !parameters.has("details")
  ) {
    parameters.set("details", "insurer");
  }
  parameters.delete("evidence");
  if (intakeMode === "manual" && parameters.get("details") === "insurer") {
    parameters.delete("details");
  }
  const query = parameters.toString();
  return `${totalLossClaimViewPath(caseId, `review_${stage}`)}${query ? `?${query}` : ""}`;
}
