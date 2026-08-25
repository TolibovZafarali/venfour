import { appraisalCasePresentation } from "@/features/cases/presentation";
import type { AppraisalCase } from "@/features/cases/types";

const MAX_RECENT_CASES = 3;

export interface SignedInHomepageCaseSelection {
  readonly featuredCase: AppraisalCase | null;
  readonly recentCases: readonly AppraisalCase[];
  readonly hasActiveTotalLossDraft: boolean;
  readonly allCasesClosed: boolean;
}

function featuredCasePriority(appraisalCase: AppraisalCase): number | null {
  const presentation = appraisalCasePresentation(appraisalCase);

  if (
    !presentation.action ||
    appraisalCase.status === "closed" ||
    appraisalCase.caseStage === "closed"
  ) {
    return null;
  }

  if (
    appraisalCase.needsAttention ||
    appraisalCase.caseStage === "analysis_failed" ||
    appraisalCase.caseStage === "needs_attention"
  ) {
    return 0;
  }

  // Diminished Value remains a service-update-only experience. Its persisted
  // case stage may still look like intake work, so classify the authoritative
  // action before applying Total-Loss workflow-stage priorities.
  if (presentation.action.label === "View service update") return 5;

  switch (appraisalCase.caseStage) {
    case "analysis_complete":
      return 1;
    case "ready_for_analysis":
      return 2;
    case "report_required":
    case "report_uploaded":
    case "intake_in_progress":
    case "intake_not_started":
      return 3;
    case "analysis_processing":
      return 4;
    case "submitted":
      return 5;
  }

  if (appraisalCase.serviceType === "total_loss") {
    switch (appraisalCase.status) {
      case "check_complete":
      case "completed":
        return 1;
      case "draft":
        return 3;
      case "checking":
        return 4;
    }
  }

  return 7;
}

export function selectSignedInHomepageCases(
  cases: readonly AppraisalCase[],
): SignedInHomepageCaseSelection {
  let featuredCase: AppraisalCase | null = null;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (const appraisalCase of cases) {
    const priority = featuredCasePriority(appraisalCase);
    if (priority !== null && priority < bestPriority) {
      featuredCase = appraisalCase;
      bestPriority = priority;
    }
  }

  const seenCaseIds = new Set<string>();
  if (featuredCase) seenCaseIds.add(featuredCase.id);

  const recentCases: AppraisalCase[] = [];
  for (const appraisalCase of cases) {
    if (seenCaseIds.has(appraisalCase.id)) continue;
    seenCaseIds.add(appraisalCase.id);
    recentCases.push(appraisalCase);
    if (recentCases.length === MAX_RECENT_CASES) break;
  }

  return {
    featuredCase,
    recentCases,
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
  };
}
