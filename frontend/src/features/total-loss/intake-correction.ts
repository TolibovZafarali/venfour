import { NEW_TOTAL_LOSS_CASE_QUERY_PARAMETER } from "@/features/total-loss/new-appraisal";

export const TOTAL_LOSS_INTAKE_CORRECTION_INTENT = "correct-intake";

const caseIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TotalLossIntakeCorrectionIntent {
  readonly caseId: string;
  readonly focus: "insurer-offer" | null;
}

export function totalLossIntakeCorrectionPath(
  caseId: string,
  focus?: "insurer-offer",
) {
  const search = new URLSearchParams({
    service: "total-loss",
    caseId,
    intent: TOTAL_LOSS_INTAKE_CORRECTION_INTENT,
  });
  if (focus) search.set("focus", focus);
  return `/start?${search.toString()}`;
}

export function readTotalLossIntakeCorrectionIntent(
  search: string,
): TotalLossIntakeCorrectionIntent | null {
  const parameters = new URLSearchParams(search);
  const caseId = parameters.get("caseId");
  if (
    parameters.get("intent") !== TOTAL_LOSS_INTAKE_CORRECTION_INTENT ||
    !caseId ||
    !caseIdPattern.test(caseId) ||
    parameters.has(NEW_TOTAL_LOSS_CASE_QUERY_PARAMETER)
  ) {
    return null;
  }
  return {
    caseId,
    focus: parameters.get("focus") === "insurer-offer" ? "insurer-offer" : null,
  };
}
