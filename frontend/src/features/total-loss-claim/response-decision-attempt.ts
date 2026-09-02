import type { TotalLossResponseDecisionInput, TotalLossResponseUsableOffer } from "./contracts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function responseDecisionAttemptKey(userId: string, caseId: string, responseId: string, recommendationId: string) {
  return `venfour:response-decision-attempt:v1:${[userId, caseId, responseId, recommendationId].map(encodeURIComponent).join(":")}`;
}

export function readResponseDecisionAttempt(key: string, recommendationId: string, offer: TotalLossResponseUsableOffer | null): TotalLossResponseDecisionInput | null {
  try {
    const stored: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const item = stored as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== "choice,clientRequestId,offerId,recommendationId,version,workflowRevision" ||
      item.version !== 1 || item.recommendationId !== recommendationId ||
      typeof item.clientRequestId !== "string" || !UUID_PATTERN.test(item.clientRequestId) ||
      typeof item.workflowRevision !== "number" || !Number.isSafeInteger(item.workflowRevision) || item.workflowRevision < 1 ||
      (item.choice !== "ACCEPT_OFFER" && item.choice !== "CONTINUE_CHALLENGING") ||
      (item.choice === "ACCEPT_OFFER" ? !offer || item.offerId !== offer.offerId : item.offerId !== null)) return null;
    return {
      clientRequestId: item.clientRequestId,
      recommendationId,
      choice: item.choice,
      offerId: item.choice === "ACCEPT_OFFER" ? offer!.offerId : null,
      workflowRevision: item.workflowRevision,
    };
  } catch {
    return null;
  }
}

export function writeResponseDecisionAttempt(key: string, input: TotalLossResponseDecisionInput) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ version: 1, ...input }));
    return true;
  } catch {
    return false;
  }
}

export function clearResponseDecisionAttempt(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // The server remains authoritative if browser storage is unavailable.
  }
}
