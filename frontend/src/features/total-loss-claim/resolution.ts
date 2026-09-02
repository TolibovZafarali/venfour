import type { TotalLossClaimResolver, TotalLossClaimSecured, TotalLossResolutionCode } from "./contracts";

export function caseIsClosed(claim: TotalLossClaimResolver) {
  return Boolean(claim.resolution) || claim.journey?.nextState === "resolved" ||
    claim.workflow?.phase === "resolution";
}

export function currentAcceptedOffer(claim: TotalLossClaimSecured) {
  const response = claim.insurerResponse;
  const decision = response?.decision;
  const offer = response?.usableOffer;
  if (!response || decision?.choice !== "ACCEPT_OFFER" || !offer ||
    decision.offerId !== offer.offerId || decision.amountMinorUnits !== offer.amountMinorUnits ||
    decision.currency !== offer.currency || decision.recommendationId !== response.recommendation?.recommendationId ||
    decision.analysisResultId !== response.recommendation.analysisResultId) return null;
  return { responseId: response.responseId, decision, offer };
}

export function canCloseCase(claim: TotalLossClaimSecured) {
  return !caseIsClosed(claim) && claim.workflow?.phase === "negotiation" &&
    ["awaiting_insurer_response", "insurer_response_received", "insurer_response_reviewed", "insurer_response_review_unavailable", "follow_up_preparation"].includes(claim.workflow.currentTask) &&
    !["pending", "processing", "retryable_failed"].includes(claim.insurerResponse?.processingState ?? "") &&
    ["active", "refunded_access_retained"].includes(claim.commerce?.entitlementStatus ?? "");
}

export function resolutionOutcome(code: TotalLossResolutionCode) {
  switch (code) {
    case "ACCEPTED_VERIFIED_OFFER": return "Accepted insurer offer";
    case "RESOLVED_WITH_INSURER": return "Resolved with insurer";
    case "CUSTOMER_STOPPED_PURSUING": return "No longer pursuing this case";
    case "NO_DISPUTE_SUPPORTED": return "No supported valuation dispute";
  }
}

export function resolutionAmount(amountMinorUnits: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amountMinorUnits / 100);
}
