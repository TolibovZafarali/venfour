import type { TotalLossIntakeMode } from "@/features/total-loss/types";

export type TotalLossCaseJourneyStage =
  | "result"
  | "insurer"
  | "market"
  | "meaning"
  | "request"
  | "waiting"
  | "response"
  | "response_received"
  | "response_reviewing"
  | "follow_up"
  | "response_reviewed";

export type TotalLossCaseJourneyStepId =
  | "understand_result"
  | "review_insurer_report"
  | "review_market_evidence"
  | "understand_comparison"
  | "prepare_request"
  | "send_request"
  | "waiting_for_insurer"
  | "response_received"
  | "response_reviewing"
  | "prepare_follow_up"
  | "waiting_for_follow_up_response"
  | "response_reviewed";

export interface TotalLossCaseJourneyStep {
  readonly id: TotalLossCaseJourneyStepId;
  readonly label: string;
}

export interface TotalLossCaseJourneyProgress {
  readonly current: TotalLossCaseJourneyStep;
  readonly isCaseActive: boolean;
  readonly position: number;
  readonly steps: readonly TotalLossCaseJourneyStep[];
  readonly total: number;
}

const journeySteps = {
  understand_result: {
    id: "understand_result",
    label: "Understand result",
  },
  review_insurer_report: {
    id: "review_insurer_report",
    label: "Review insurer report",
  },
  review_market_evidence: {
    id: "review_market_evidence",
    label: "Review market evidence",
  },
  understand_comparison: {
    id: "understand_comparison",
    label: "Understand comparison",
  },
  prepare_request: {
    id: "prepare_request",
    label: "Prepare request",
  },
  send_request: {
    id: "send_request",
    label: "Send request",
  },
  waiting_for_insurer: {
    id: "waiting_for_insurer",
    label: "Waiting for insurer",
  },
  response_received: {
    id: "response_received",
    label: "Response received",
  },
  response_reviewing: {
    id: "response_reviewing",
    label: "Reviewing response",
  },
  response_reviewed: {
    id: "response_reviewed",
    label: "Response reviewed",
  },
  prepare_follow_up: {
    id: "prepare_follow_up",
    label: "Prepare follow-up",
  },
  waiting_for_follow_up_response: {
    id: "waiting_for_follow_up_response",
    label: "Waiting for insurer",
  },
} as const satisfies Record<
  TotalLossCaseJourneyStepId,
  TotalLossCaseJourneyStep
>;

function currentStepId(
  stage: TotalLossCaseJourneyStage,
  hasDraft: boolean,
): TotalLossCaseJourneyStepId {
  switch (stage) {
    case "result":
      return "understand_result";
    case "insurer":
      return "review_insurer_report";
    case "market":
      return "review_market_evidence";
    case "meaning":
      return "understand_comparison";
    case "request":
      return hasDraft ? "send_request" : "prepare_request";
    case "waiting":
    case "response":
      return "waiting_for_insurer";
    case "response_received":
      return "response_received";
    case "response_reviewing":
      return "response_reviewing";
    case "response_reviewed":
      return "response_reviewed";
    case "follow_up":
      return "prepare_follow_up";
  }
}

export function totalLossCaseJourneyProgress({
  continuingSupported,
  hasDraft,
  intakeMode,
  stage,
  hasFollowUp = false,
  followUpSent = false,
}: {
  readonly continuingSupported: boolean;
  readonly hasDraft: boolean;
  readonly intakeMode: TotalLossIntakeMode;
  readonly stage: TotalLossCaseJourneyStage;
  readonly hasFollowUp?: boolean;
  readonly followUpSent?: boolean;
}): TotalLossCaseJourneyProgress {
  const steps: TotalLossCaseJourneyStep[] = [journeySteps.understand_result];
  if (intakeMode === "report") steps.push(journeySteps.review_insurer_report);
  steps.push(
    journeySteps.review_market_evidence,
    journeySteps.understand_comparison,
  );

  // A saved waiting state remains authoritative even if a later report
  // projection no longer advertises request preparation.
  if (
    continuingSupported ||
    stage === "request" ||
    stage === "waiting" ||
    stage === "response" ||
    stage === "response_received" ||
    stage === "response_reviewing" ||
    stage === "response_reviewed" ||
    stage === "follow_up"
  ) {
    steps.push(
      journeySteps.prepare_request,
      journeySteps.send_request,
      journeySteps.waiting_for_insurer,
      journeySteps.response_received,
      journeySteps.response_reviewing,
      journeySteps.response_reviewed,
    );
  }
  if (stage === "follow_up" || hasFollowUp) steps.push(journeySteps.prepare_follow_up);
  if (followUpSent) steps.push(journeySteps.waiting_for_follow_up_response);

  let id = stage === "waiting" && followUpSent ? "waiting_for_follow_up_response" : currentStepId(stage, hasDraft);
  if (intakeMode === "manual" && id === "review_insurer_report") {
    id = "review_market_evidence";
  }
  const currentIndex = steps.findIndex((step) => step.id === id);
  const position = currentIndex >= 0 ? currentIndex + 1 : steps.length;
  const current = steps[position - 1] ?? journeySteps.understand_result;

  return {
    current,
    isCaseActive:
      current.id === "waiting_for_insurer" ||
      current.id === "waiting_for_follow_up_response" ||
      current.id === "response_reviewing",
    position,
    steps,
    total: steps.length,
  };
}
