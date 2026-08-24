import { useState } from "react";

export const NEW_TOTAL_LOSS_CASE_QUERY_PARAMETER = "newCaseId";

const CLIENT_RESERVED_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isNewTotalLossAppraisalIntentId(value: string): boolean {
  return CLIENT_RESERVED_UUID_PATTERN.test(value);
}

export function newTotalLossAppraisalHref(
  intentId: string = globalThis.crypto.randomUUID(),
): string {
  if (!isNewTotalLossAppraisalIntentId(intentId)) {
    throw new Error("A valid new-appraisal intent ID is required.");
  }

  const search = new URLSearchParams({
    service: "total-loss",
    [NEW_TOTAL_LOSS_CASE_QUERY_PARAMETER]: intentId,
  });
  return `/start?${search.toString()}`;
}

export function useNewTotalLossAppraisalHref(): string {
  const [href] = useState(() => newTotalLossAppraisalHref());
  return href;
}
