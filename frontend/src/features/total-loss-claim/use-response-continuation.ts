import { useCallback, useState } from "react";

function savedRequest(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function useContinuation(key: string) {
  const [pending, setPending] = useState(() => ({ key, requestId: savedRequest(key) }));
  const waitForContinue = useCallback((requestId: string) => {
    setPending({ key, requestId });
    try { sessionStorage.setItem(key, requestId); } catch { /* Keep the current page usable when storage is unavailable. */ }
  }, [key]);
  const continueToReview = useCallback(() => {
    setPending({ key, requestId: null });
    try { sessionStorage.removeItem(key); } catch { /* In-memory navigation remains available. */ }
  }, [key]);
  return { pendingRequestId: pending.key === key ? pending.requestId : savedRequest(key), waitForContinue, continueToReview };
}

export function useResponseContinuation(userId: string, caseId: string, reportId: string) {
  return useContinuation(`venfour:response-continuation:${userId}:${caseId}:${reportId}`);
}

export function useDecisionContinuation(userId: string, caseId: string, responseId: string) {
  return useContinuation(`venfour:decision-continuation:${userId}:${caseId}:${responseId}`);
}

export function useFollowUpContinuation(userId: string, caseId: string, decisionId: string) {
  return useContinuation(`venfour:follow-up-continuation:${userId}:${caseId}:${decisionId}`);
}
