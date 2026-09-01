import type { AppraisalCase } from "@/features/cases/types";
import { appraisalCasePresentation } from "@/features/cases/presentation";
import type { DiminishedValueCaseDetails } from "@/features/diminished-value/data-types";
import type {
  TotalLossClaimJourneyState,
  TotalLossClaimResolver,
} from "@/features/total-loss-claim/contracts";
import {
  authoritativeTotalLossClaimPath,
  resolvedTotalLossClaimJourneyState,
  totalLossClaimBasePath,
} from "@/features/total-loss-claim/workflow-route";
import type { TotalLossCaseDetails } from "@/features/total-loss/data-types";
import type { TotalLossIntakeMode } from "@/features/total-loss/types";

export type CaseDashboardMilestoneState =
  | "complete"
  | "current"
  | "upcoming"
  | "attention";

export interface CaseDashboardMilestone {
  readonly id:
    | "vehicle"
    | "analysis"
    | "continuation"
    | "report"
    | "request"
    | "waiting"
    | "service"
    | "closed";
  readonly label: string;
  readonly state: CaseDashboardMilestoneState;
}

export interface CaseDashboardAction {
  readonly href: string;
  readonly label: string;
  readonly required: boolean;
}

export interface CaseDashboardSafeContext {
  readonly caseId: string;
  readonly serviceType: AppraisalCase["serviceType"];
  readonly vehicleDisplayName: string;
  readonly insurerName: string | null;
  readonly dateOfLoss: string | null;
  readonly statusCode: CaseDashboardStatusCode;
}

export type CaseDashboardStatusTone =
  | "active"
  | "attention"
  | "complete"
  | "neutral";

export type CaseDashboardStatusCode =
  | "intake"
  | "analysis_ready"
  | "analysis_processing"
  | "analysis_attention"
  | "preliminary_result"
  | "claim_in_progress"
  | "secure_claim"
  | "payment"
  | "report_processing"
  | "report_review"
  | "request_preparation"
  | "request_ready"
  | "waiting_for_insurer"
  | "no_dispute"
  | "refund_pending"
  | "needs_attention"
  | "account_check"
  | "service_update"
  | "closed"
  | "unknown";

export interface CaseDashboardModel {
  readonly caseId: string;
  readonly serviceType: AppraisalCase["serviceType"];
  readonly serviceLabel: string;
  readonly vehicleDisplayName: string;
  readonly insurerName: string | null;
  readonly dateOfLoss: string | null;
  readonly statusCode: CaseDashboardStatusCode;
  readonly statusLabel: string;
  readonly statusExplanation: string;
  readonly statusTone: CaseDashboardStatusTone;
  readonly milestones: readonly CaseDashboardMilestone[];
  readonly nextAction: CaseDashboardAction | null;
  readonly canonicalResumeDestination: string | null;
  readonly createdAt: string;
  readonly lastActivityAt: string;
  readonly reportUploadedAt: string | null;
  readonly reportIssuedAt: string | null;
  readonly safeContext: CaseDashboardSafeContext;
}

export interface CaseDashboardModelInput {
  readonly appraisalCase: AppraisalCase;
  readonly totalLossDetails?: TotalLossCaseDetails | null;
  readonly diminishedValueDetails?: DiminishedValueCaseDetails | null;
  readonly claim?: TotalLossClaimResolver | null;
}

interface DashboardStatus {
  readonly code: CaseDashboardStatusCode;
  readonly label: string;
  readonly explanation: string;
  readonly tone: CaseDashboardStatusTone;
  readonly actionLabel: string | null;
  readonly actionRequired: boolean;
}

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function vehicleName(
  appraisalCase: AppraisalCase,
  totalLossDetails?: TotalLossCaseDetails | null,
  diminishedValueDetails?: DiminishedValueCaseDetails | null,
  claim?: TotalLossClaimResolver | null,
) {
  const details = totalLossDetails ?? diminishedValueDetails;
  const structuredName = [
    details?.vehicleYear,
    clean(details?.vehicleMake),
    clean(details?.vehicleModel),
    clean(details?.vehicleTrim),
  ]
    .filter((part): part is number | string => part !== null && part !== undefined)
    .join(" ");

  return (
    clean(structuredName) ??
    clean(claim?.report?.subjectVehicle.description) ??
    (appraisalCase.serviceType === "total_loss"
      ? "Your total-loss case"
      : appraisalCase.serviceType === "diminished_value"
        ? "Your diminished-value case"
        : "Your vehicle case")
  );
}

function insurerName(
  totalLossDetails?: TotalLossCaseDetails | null,
  diminishedValueDetails?: DiminishedValueCaseDetails | null,
  claim?: TotalLossClaimResolver | null,
) {
  return (
    clean(totalLossDetails?.insurerName) ??
    clean(diminishedValueDetails?.atFaultInsurer) ??
    clean(claim?.report?.insurerEvidence.insurerName) ??
    clean(claim?.sendingDetails?.insurerName)
  );
}

function claimJourneyState(
  claim: TotalLossClaimResolver,
): TotalLossClaimJourneyState {
  return resolvedTotalLossClaimJourneyState(claim) ?? "secure_claim";
}

function claimStatus(
  claim: TotalLossClaimResolver,
  insurer: string | null,
): DashboardStatus {
  if (claim.state === "account_switch_required") {
    return {
      code: "account_check",
      label: "Account check required",
      explanation:
        "Open the case to continue with the account that has access to this claim.",
      tone: "attention",
      actionLabel: "Review account access",
      actionRequired: true,
    };
  }

  if (claim.journey?.fulfillmentState === "refund_pending") {
    return {
      code: "refund_pending",
      label: "Refund review in progress",
      explanation:
        "The case is being reviewed after the payment change. Open it for the latest available status.",
      tone: "attention",
      actionLabel: "Review status",
      actionRequired: false,
    };
  }

  const journeyState = claimJourneyState(claim);
  switch (journeyState) {
    case "secure_claim":
      return {
        code: "secure_claim",
        label: "Secure your claim",
        explanation:
          "Confirm secure access before continuing with the claim workspace.",
        tone: "active",
        actionLabel: "Secure claim",
        actionRequired: true,
      };
    case "checkout":
    case "checkout_confirmation":
      return {
        code: "payment",
        label:
          journeyState === "checkout_confirmation"
            ? "Confirming your payment"
            : "Ready to continue",
        explanation:
          journeyState === "checkout_confirmation"
            ? "Venfour is confirming the payment before report preparation begins."
            : "Continue to payment when you’re ready to prepare the full valuation report.",
        tone: "active",
        actionLabel:
          journeyState === "checkout_confirmation"
            ? "View payment status"
            : "Continue to payment",
        actionRequired: journeyState === "checkout",
      };
    case "processing":
      return {
        code: "report_processing",
        label: "Your valuation report is being prepared",
        explanation:
          "Venfour is organizing the completed analysis into your customer report.",
        tone: "active",
        actionLabel: "View progress",
        actionRequired: false,
      };
    case "guide_result":
    case "guide_insurer_review":
    case "guide_valuation":
    case "guide_report":
    case "guide_what_next":
      return {
        code: "report_review",
        label: "Your valuation is ready",
        explanation:
          "Review the findings, supporting market evidence, and limitations before deciding what to do next.",
        tone: "complete",
        actionLabel: "Review valuation",
        actionRequired: true,
      };
    case "prepare_request": {
      const requestReady = Boolean(claim.messageDraft);
      return {
        code: requestReady ? "request_ready" : "request_preparation",
        label: requestReady
          ? "Your request is ready to send"
          : "Prepare your request",
        explanation: requestReady
          ? "Review the saved message and recipient details before you send it to the insurer."
          : "Use your report findings to prepare a clear reconsideration request for the insurer.",
        tone: "active",
        actionLabel: requestReady ? "Review and send request" : "Prepare request",
        actionRequired: true,
      };
    }
    case "awaiting_insurer_response":
      return {
        code: "waiting_for_insurer",
        label: insurer ? `Waiting for ${insurer}` : "Waiting for the insurer",
        explanation:
          "You marked the request as sent. Venfour cannot verify delivery or receipt, so return here when the insurer responds.",
        tone: "active",
        actionLabel: "View sent request",
        actionRequired: false,
      };
    case "no_dispute":
      return {
        code: "no_dispute",
        label: "Review complete",
        explanation:
          "The available evidence did not support continuing to an insurer request. Your result and its limitations remain available.",
        tone: "complete",
        actionLabel: "Review result",
        actionRequired: false,
      };
    case "needs_attention":
      return {
        code: "needs_attention",
        label: "Your case needs attention",
        explanation:
          "Venfour could not continue this step automatically. Open the case to review the current status and available next step.",
        tone: "attention",
        actionLabel: "Review status",
        actionRequired: true,
      };
  }
}

function preliminaryStatus(appraisalCase: AppraisalCase): DashboardStatus {
  if (
    appraisalCase.status === "closed" ||
    appraisalCase.caseStage === "closed"
  ) {
    return {
      code: "closed",
      label: "Case closed",
      explanation:
        "This case is closed. Its saved history remains available in your account.",
      tone: "neutral",
      actionLabel: null,
      actionRequired: false,
    };
  }

  if (appraisalCase.serviceType === "diminished_value") {
    return {
      code: "service_update",
      label:
        appraisalCase.status === "submitted"
          ? "Request received"
          : "Service update available",
      explanation:
        appraisalCase.status === "submitted"
          ? "Your Diminished Value request is saved. Open the service update for the current availability information."
          : "Diminished Value intake is currently paused. Your saved case remains in your account.",
      tone: appraisalCase.status === "submitted" ? "complete" : "neutral",
      actionLabel: "View service update",
      actionRequired: false,
    };
  }

  if (
    appraisalCase.hasTotalLossClaimWorkflow &&
    appraisalCase.needsAttention
  ) {
    return {
      code: "needs_attention",
      label: "Your case needs attention",
      explanation:
        "Open the case to review what needs attention before you continue.",
      tone: "attention",
      actionLabel: null,
      actionRequired: true,
    };
  }

  if (
    appraisalCase.needsAttention ||
    appraisalCase.caseStage === "analysis_failed" ||
    appraisalCase.caseStage === "needs_attention"
  ) {
    return {
      code:
        appraisalCase.analysisStatus ||
        appraisalCase.caseStage === "analysis_failed"
          ? "analysis_attention"
          : "needs_attention",
      label:
        appraisalCase.analysisStatus ||
        appraisalCase.caseStage === "analysis_failed"
          ? "Your value check needs attention"
          : "Your case needs attention",
      explanation:
        appraisalCase.analysisStatus ||
        appraisalCase.caseStage === "analysis_failed"
          ? "Open the value check to review the issue and any available retry path."
          : "Open the case to review what needs attention before you continue.",
      tone: "attention",
      actionLabel: null,
      actionRequired: true,
    };
  }

  if (appraisalCase.hasTotalLossClaimWorkflow) {
    return {
      code: "claim_in_progress",
      label: "Your claim is in progress",
      explanation:
        "Open the case to continue from the latest secure payment, report, or request step.",
      tone: "active",
      actionLabel: "Open case",
      actionRequired: false,
    };
  }

  switch (appraisalCase.caseStage) {
    case "ready_for_analysis":
      return {
        code: "analysis_ready",
        label: "Ready for your value check",
        explanation:
          "Your vehicle and valuation details are ready. Start the independent market comparison when you’re ready.",
        tone: "active",
        actionLabel: null,
        actionRequired: true,
      };
    case "analysis_processing":
      return {
        code: "analysis_processing",
        label: "Your value check is in progress",
        explanation:
          "Venfour is reviewing the available market evidence for your vehicle.",
        tone: "active",
        actionLabel: null,
        actionRequired: false,
      };
    case "analysis_complete":
      return {
        code: "preliminary_result",
        label: "Your preliminary result is ready",
        explanation:
          "Open the result to review the comparison, supporting evidence, and important limitations.",
        tone: "complete",
        actionLabel: null,
        actionRequired: true,
      };
    case "intake_not_started":
    case "intake_in_progress":
    case "report_uploaded":
    case "report_required":
    default:
      return {
        code: "intake",
        label:
          appraisalCase.caseStage === "report_required"
            ? "Your valuation report is needed"
            : "Continue your case details",
        explanation:
          appraisalCase.caseStage === "report_required"
            ? "Add the insurer’s valuation report, or switch to manual details, to continue the review."
            : "Finish the saved vehicle and valuation details to move your review forward.",
        tone: "active",
        actionLabel: null,
        actionRequired: true,
      };
  }
}

function milestone(
  id: CaseDashboardMilestone["id"],
  label: string,
  state: CaseDashboardMilestoneState,
): CaseDashboardMilestone {
  return { id, label, state };
}

function preliminaryMilestones(
  appraisalCase: AppraisalCase,
  status: DashboardStatus,
): readonly CaseDashboardMilestone[] {
  if (status.code === "closed") {
    return [
      milestone("vehicle", "Vehicle details", "complete"),
      ...(appraisalCase.serviceType === "total_loss"
        ? [milestone("analysis", "Value analysis", "complete")]
        : []),
      milestone("closed", "Case closed", "current"),
    ];
  }

  if (appraisalCase.serviceType === "diminished_value") {
    return [
      milestone(
        "vehicle",
        "Vehicle details",
        appraisalCase.status === "submitted" ? "complete" : "current",
      ),
      milestone(
        "service",
        appraisalCase.status === "submitted"
          ? "Request received"
          : "Service update",
        appraisalCase.status === "submitted" ? "current" : "upcoming",
      ),
    ];
  }

  if (status.code === "needs_attention") {
    if (appraisalCase.hasTotalLossClaimWorkflow) {
      return [
        milestone("vehicle", "Vehicle details", "complete"),
        milestone("analysis", "Value analysis", "complete"),
        milestone("continuation", "Claim continuation", "attention"),
        milestone("report", "Valuation report", "upcoming"),
      ];
    }
    return [
      milestone("vehicle", "Vehicle details", "attention"),
      milestone("analysis", "Value analysis", "upcoming"),
    ];
  }

  if (status.code === "intake") {
    return [
      milestone("vehicle", "Vehicle details", "current"),
      milestone("analysis", "Value analysis", "upcoming"),
    ];
  }

  if (status.code === "claim_in_progress") {
    return [
      milestone("vehicle", "Vehicle details", "complete"),
      milestone("analysis", "Value analysis", "complete"),
      milestone("continuation", "Claim continuation", "current"),
      milestone("report", "Valuation report", "upcoming"),
    ];
  }

  if (
    status.code === "analysis_ready" ||
    status.code === "analysis_processing" ||
    status.code === "analysis_attention"
  ) {
    return [
      milestone("vehicle", "Vehicle details", "complete"),
      milestone(
        "analysis",
        "Value analysis",
        status.code === "analysis_attention" ? "attention" : "current",
      ),
    ];
  }

  return [
    milestone("vehicle", "Vehicle details", "complete"),
    milestone("analysis", "Value analysis", "current"),
  ];
}

function claimMilestones(
  claim: TotalLossClaimResolver,
  status: DashboardStatus,
): readonly CaseDashboardMilestone[] {
  const base: CaseDashboardMilestone[] = [
    milestone("vehicle", "Vehicle details", "complete"),
    milestone("analysis", "Value analysis", "complete"),
  ];

  if (status.code === "closed") {
    return [...base, milestone("closed", "Case closed", "current")];
  }

  const journeyState = claimJourneyState(claim);
  if (
    journeyState === "secure_claim" ||
    journeyState === "checkout" ||
    journeyState === "checkout_confirmation"
  ) {
    return [
      ...base,
      milestone(
        "continuation",
        "Claim continuation",
        status.tone === "attention" ? "attention" : "current",
      ),
      milestone("report", "Valuation report", "upcoming"),
    ];
  }

  const continuation = milestone(
    "continuation",
    "Claim continuation",
    "complete",
  );

  if (status.code === "refund_pending" || journeyState === "no_dispute") {
    return [
      ...base,
      continuation,
      milestone(
        "report",
        "Valuation result",
        status.code === "refund_pending" ? "attention" : "current",
      ),
    ];
  }

  if (journeyState === "processing" || journeyState === "needs_attention") {
    return [
      ...base,
      continuation,
      milestone(
        "report",
        "Valuation report",
        journeyState === "needs_attention" ? "attention" : "current",
      ),
    ];
  }

  if (journeyState.startsWith("guide_")) {
    return [
      ...base,
      continuation,
      milestone("report", "Valuation report", "current"),
      milestone("request", "Request", "upcoming"),
    ];
  }

  if (journeyState === "prepare_request") {
    return [
      ...base,
      continuation,
      milestone("report", "Valuation report", "complete"),
      milestone("request", "Request", "current"),
      milestone("waiting", "Insurer follow-up", "upcoming"),
    ];
  }

  return [
    ...base,
    continuation,
    milestone("report", "Valuation report", "complete"),
    milestone("request", "Request sent", "complete"),
    milestone("waiting", "Waiting for insurer", "current"),
  ];
}

export function createCaseDashboardModel({
  appraisalCase,
  totalLossDetails,
  diminishedValueDetails,
  claim,
}: CaseDashboardModelInput): CaseDashboardModel {
  const vehicleDisplayName = vehicleName(
    appraisalCase,
    totalLossDetails,
    diminishedValueDetails,
    claim,
  );
  const insurer = insurerName(totalLossDetails, diminishedValueDetails, claim);
  const dateOfLoss =
    totalLossDetails?.dateOfLoss ??
    diminishedValueDetails?.accidentDate ??
    null;
  const intakeMode: TotalLossIntakeMode | undefined =
    totalLossDetails?.intakeMode;
  const isClosed =
    appraisalCase.status === "closed" ||
    appraisalCase.caseStage === "closed";
  const status = isClosed
    ? preliminaryStatus(appraisalCase)
    : claim
      ? claimStatus(claim, insurer)
      : preliminaryStatus(appraisalCase);
  const fallbackPresentation = appraisalCasePresentation(appraisalCase);
  const canonicalResumeDestination = claim
    ? intakeMode
      ? authoritativeTotalLossClaimPath(claim, intakeMode)
      : totalLossClaimBasePath(claim.caseId)
    : fallbackPresentation.action?.href ?? null;
  const actionLabel = claim
    ? status.actionLabel
    : status.actionLabel ?? fallbackPresentation.action?.label ?? null;
  const nextAction =
    canonicalResumeDestination && actionLabel
      ? {
          href: canonicalResumeDestination,
          label: actionLabel,
          required: status.actionRequired,
        }
      : null;
  const milestones = claim
    ? claimMilestones(claim, status)
    : preliminaryMilestones(appraisalCase, status);
  const safeContext: CaseDashboardSafeContext = {
    caseId: appraisalCase.id,
    serviceType: appraisalCase.serviceType,
    vehicleDisplayName,
    insurerName: insurer,
    dateOfLoss,
    statusCode: status.code,
  };

  return {
    caseId: appraisalCase.id,
    serviceType: appraisalCase.serviceType,
    serviceLabel:
      appraisalCase.serviceType === "total_loss"
        ? "Total Loss"
        : appraisalCase.serviceType === "diminished_value"
          ? "Diminished Value"
          : "Vehicle appraisal",
    vehicleDisplayName,
    insurerName: insurer,
    dateOfLoss,
    statusCode: status.code,
    statusLabel: status.label,
    statusExplanation: status.explanation,
    statusTone: status.tone,
    milestones,
    nextAction,
    canonicalResumeDestination,
    createdAt: appraisalCase.createdAt,
    lastActivityAt: appraisalCase.lastActivityAt,
    reportUploadedAt: appraisalCase.reportUploadedAt ?? null,
    reportIssuedAt: claim?.report?.issueDate ?? null,
    safeContext,
  };
}
