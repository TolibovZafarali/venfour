import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import {
  totalLossCaseJourneyProgress,
  type TotalLossCaseJourneyProgress,
  type TotalLossCaseJourneyStage,
} from "./case-journey";
import type {
  TotalLossClaimSecured,
  TotalLossEducationStep,
  TotalLossPublishedReport,
} from "./contracts";
import { requestIsSent, requestReviewComplete } from "./request-state";
import { reviewPrerequisite } from "./use-review-progression";
import { caseIsClosed, currentAcceptedOffer } from "./resolution";
import {
  authoritativeTotalLossClaimPath,
  completedAnalysisStage,
  resolvedTotalLossClaimJourneyState,
  totalLossClaimBasePath,
  totalLossClaimViewPath,
} from "./workflow-route";

export interface CaseWorkspaceSection {
  readonly stage: TotalLossCaseJourneyStage;
  readonly label: string;
  readonly href: string;
  readonly available: boolean;
  readonly complete: boolean;
  readonly current: boolean;
}

export interface CaseWorkspace {
  readonly currentStage: TotalLossCaseJourneyStage;
  readonly currentPath: string;
  readonly currentLabel: string;
  readonly progress: TotalLossCaseJourneyProgress;
  readonly sections: readonly CaseWorkspaceSection[];
}

const reviewStages: readonly TotalLossCaseJourneyStage[] = [
  "result", "insurer", "market", "meaning", "request", "waiting",
  "response", "response_received", "response_reviewing", "response_reviewed", "follow_up",
  "resolution",
];

export function createCaseWorkspace({
  claim,
  report,
  intakeMode,
  hasDraft,
}: {
  readonly claim: TotalLossClaimSecured;
  readonly report: TotalLossPublishedReport;
  readonly intakeMode: TotalLossIntakeMode;
  readonly hasDraft: boolean;
}): CaseWorkspace {
  const closed = caseIsClosed(claim);
  const currentPath = authoritativeTotalLossClaimPath(claim, intakeMode) ??
    totalLossClaimBasePath(claim.caseId);
  const routeStage = reviewStages.find((stage) =>
    totalLossClaimViewPath(claim.caseId, `review_${stage}`) === currentPath,
  ) ?? "result";
  const currentStage = completedAnalysisStage(
    `review_${routeStage}`, new URLSearchParams(), intakeMode,
  );
  const progress = totalLossCaseJourneyProgress({
    continuingSupported: report.conclusion.continuingSupported,
    hasDraft,
    intakeMode,
    stage: currentStage,
    hasFollowUp: Boolean(claim.followUp),
    followUpSent: claim.followUp?.state === "sent",
    isClosed: closed,
  });
  const education = claim.education?.reportVersionId === report.reportId
    ? claim.education.steps
    : null;
  const completed = (...steps: TotalLossEducationStep[]) =>
    steps.every((step) => Boolean(
      education?.[step].completedAt || education?.[step].skippedAt,
    ));
  const sections: CaseWorkspaceSection[] = [];
  const add = (
    stage: TotalLossCaseJourneyStage,
    label: string,
    available: boolean,
    complete: boolean,
  ) => sections.push({
    stage,
    label,
    href: `${totalLossClaimViewPath(claim.caseId, `review_${stage}`)}${stage === "response_received" ? "?view=saved" : ""}`,
    available,
    complete,
    current: stage === currentStage,
  });
  const addEducation = (
    stage: "result" | "insurer" | "market" | "meaning",
    label: string,
    ...steps: TotalLossEducationStep[]
  ) => {
    const complete = completed(...steps);
    add(stage, label, closed || complete || !reviewPrerequisite(claim, report.reportId, intakeMode, stage), complete);
  };

  addEducation("result", "Your result", "result");
  if (intakeMode === "report") {
    addEducation("insurer", "Insurer review", "insurer_review");
  }
  addEducation("market", "Market evidence", ...(
    intakeMode === "manual" ? ["insurer_review", "valuation"] as const : ["valuation"] as const
  ));
  addEducation("meaning", "What it means", "report", "what_next");

  const sent = requestIsSent(claim);
  const response = claim.insurerResponse;
  if ((!closed && report.conclusion.continuingSupported) || sent) {
    add("request", sent ? "Initial request" : "Request preparation",
      sent || requestReviewComplete(claim, report.reportId), sent);
    if (!closed) add("waiting", "Waiting for insurer", sent, Boolean(response) && claim.followUp?.state !== "sent");
  }
  if ((!closed && report.conclusion.continuingSupported) || sent || response) {
    add("response_received", "Insurer response", Boolean(response), Boolean(response));
    const reviewed = response?.processingState === "completed" &&
      Boolean(response.analysis && response.analysisEvidence);
    const reviewAvailable = reviewed || currentStage === "response_reviewing" || currentStage === "response_reviewed";
    add(reviewed ? "response_reviewed" : "response_reviewing", "Response review", reviewAvailable, reviewed);
  }
  if (response?.decision?.choice === "CONTINUE_CHALLENGING" && (!closed || claim.followUp?.sentMessage || claim.followUp?.draft)) {
    add("follow_up", claim.followUp?.state === "sent" ? "Sent follow-up" : "Follow-up request", true, claim.followUp?.state === "sent");
  }

  const awaitingFinalization = !closed && Boolean(currentAcceptedOffer(claim));
  if (closed || awaitingFinalization) add("resolution", closed ? "Case outcome" : "Confirm acceptance", true, closed);
  return {
    currentStage,
    currentPath,
    currentLabel: closed ? "Case complete" : awaitingFinalization ? "Confirm acceptance" : resolvedTotalLossClaimJourneyState(claim) === "insurer_response_review_unavailable"
      ? "Response review needs attention"
      : progress.current.label,
    progress: awaitingFinalization ? { ...progress, current: { ...progress.current, label: "Confirm acceptance" } } : progress,
    sections,
  };
}
