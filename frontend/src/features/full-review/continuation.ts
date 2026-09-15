import type { TotalLossContinuationInput } from "@/features/total-loss-claim/api";
import type { FullReviewState } from "./api";

export function fullReviewContinuationInput(state: FullReviewState | undefined): TotalLossContinuationInput | null {
  if (!state?.ready || !state.checkoutAvailable || !state.paymentReadiness.eligible
      || !state.paymentReadiness.reviewId || !state.paymentReadiness.version || !state.paymentReadiness.digest
      || !state.report || !state.analysisInputId || !state.analysisInputRevision) return null;
  return {
    expectedAnalysisInputId: state.analysisInputId,
    expectedAnalysisInputRevision: state.analysisInputRevision,
    expectedReportId: state.report.id,
    expectedReportRevision: state.report.revision,
    expectedStrictReviewId: state.paymentReadiness.reviewId,
    expectedStrictReviewVersion: state.paymentReadiness.version,
    expectedStrictReviewDigest: state.paymentReadiness.digest,
  };
}
