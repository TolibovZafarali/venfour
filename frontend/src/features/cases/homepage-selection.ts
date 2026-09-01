import type { AppraisalCase } from "@/features/cases/types";

export interface SignedInHomepageCaseSelection {
  readonly focalCase: AppraisalCase | null;
  readonly hasActiveTotalLossDraft: boolean;
  readonly allCasesClosed: boolean;
  readonly historicalCaseCount: number;
}

function focalCasePriority(appraisalCase: AppraisalCase): number {
  if (
    appraisalCase.status === "closed" ||
    appraisalCase.caseStage === "closed"
  ) return 8;

  if (
    appraisalCase.needsAttention ||
    appraisalCase.caseStage === "analysis_failed" ||
    appraisalCase.caseStage === "needs_attention"
  ) {
    return 0;
  }

  // Exact downstream state belongs to the focal-only claim resolver. The
  // collection contract intentionally exposes only workflow existence.
  if (appraisalCase.hasTotalLossClaimWorkflow) return 1;

  // Diminished Value is currently a saved service-update experience, even
  // when its generic case stage resembles an active intake.
  if (appraisalCase.serviceType === "diminished_value") return 6;

  switch (appraisalCase.caseStage) {
    case "analysis_complete":
      return 2;
    case "ready_for_analysis":
      return 3;
    case "report_required":
    case "report_uploaded":
    case "intake_in_progress":
    case "intake_not_started":
      return 4;
    case "analysis_processing":
      return 5;
    case "submitted":
      return 6;
  }

  return 7;
}

export function selectSignedInHomepageCases(
  cases: readonly AppraisalCase[],
): SignedInHomepageCaseSelection {
  let focalCase: AppraisalCase | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (const appraisalCase of cases) {
    const priority = focalCasePriority(appraisalCase);
    if (priority < bestPriority) {
      focalCase = appraisalCase;
      bestPriority = priority;
    }
  }

  const historicalCaseIds = new Set(
    cases
      .filter((appraisalCase) => appraisalCase.id !== focalCase?.id)
      .map((appraisalCase) => appraisalCase.id),
  );

  return {
    focalCase,
    hasActiveTotalLossDraft: cases.some(
      (appraisalCase) =>
        appraisalCase.serviceType === "total_loss" &&
        appraisalCase.status === "draft",
    ),
    allCasesClosed:
      cases.length > 0 &&
      cases.every(
        (appraisalCase) =>
          appraisalCase.status === "closed" ||
          appraisalCase.caseStage === "closed",
      ),
    historicalCaseCount: historicalCaseIds.size,
  };
}
