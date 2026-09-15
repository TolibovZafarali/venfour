import type {
  TotalLossClaimJourneyState,
  TotalLossClaimResolver,
} from "@/features/total-loss-claim/contracts";
import type { TotalLossCaseJourneyStage } from "@/features/total-loss-claim/case-journey";
import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import { currentAcceptedOffer } from "./resolution";

type LegacyCaseView = "overview" | "evidence" | "request" | "activity";
type LegacyReviewView =
  | "review_result"
  | "review_insurer"
  | "review_market"
  | "review_meaning"
  | "review_next"
  | "review_request"
  | "review_response"
  | "review_response_received"
  | "review_response_reviewing"
  | "review_response_reviewed"
  | "review_follow_up"
  | "review_resolution"
  | "review_sent"
  | "review_waiting";

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
    case "review_waiting":
      return `${base}/review/waiting`;
    case "review_response":
      return `${base}/review/response`;
    case "review_response_received":
      return `${base}/review/response-received`;
    case "review_response_reviewing":
      return `${base}/review/response-reviewing`;
    case "review_response_reviewed":
      return `${base}/review/response-reviewed`;
    case "review_follow_up":
      return `${base}/review/follow-up`;
    case "review_resolution":
      return `${base}/review/resolution`;
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
      return totalLossClaimViewPath(caseId, "review_waiting");
    case "insurer_response_received":
      return totalLossClaimViewPath(caseId, "review_response_received");
    case "insurer_response_reviewing":
    case "insurer_response_review_unavailable":
      return totalLossClaimViewPath(caseId, "review_response_reviewing");
    case "insurer_response_reviewed":
      return totalLossClaimViewPath(caseId, "review_response_reviewed");
    case "follow_up_preparation":
      return totalLossClaimViewPath(caseId, "review_follow_up");
    case "resolved":
      return totalLossClaimViewPath(caseId, "review_resolution");
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
    case "case_resolved":
    case "case_closed":
    case "resolved":
      return "resolved";
    case "awaiting_insurer_response":
      return "awaiting_insurer_response";
    case "insurer_response_received":
      return "insurer_response_received";
    case "insurer_response_reviewing":
      return "insurer_response_reviewing";
    case "insurer_response_reviewed":
      return "insurer_response_reviewed";
    case "follow_up_preparation":
      return "follow_up_preparation";
    case "insurer_response_review_unavailable":
      return "insurer_response_review_unavailable";
    case "secure_claim":
    case null:
      return null;
    default:
      return null;
  }
}

export function resolvedTotalLossClaimJourneyState(
  claim: TotalLossClaimResolver,
): TotalLossClaimJourneyState | null {
  return claim.journey?.nextState ?? legacyJourneyState(claim);
}

export function authoritativeTotalLossClaimPath(
  claim: TotalLossClaimResolver,
  intakeMode?: TotalLossIntakeMode,
): string | null {
  if (claim.state === "secure_required")
    return totalLossClaimViewPath(claim.caseId, "checkout");
  if (claim.state === "secured" && !claim.resolution && currentAcceptedOffer(claim))
    return totalLossClaimViewPath(claim.caseId, "review_resolution");
  const state = resolvedTotalLossClaimJourneyState(claim);
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

export type CompletedAnalysisStage = TotalLossCaseJourneyStage;

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
    case "review_waiting":
      return "waiting";
    case "review_response":
      return "response";
    case "review_response_received":
      return "response_received";
    case "review_response_reviewing":
      return "response_reviewing";
    case "review_response_reviewed":
      return "response_reviewed";
    case "review_follow_up":
      return "follow_up";
    case "review_resolution":
      return "resolution";
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
