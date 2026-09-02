import type { AppraisalCase } from "@/features/cases/types";

const contactSupportAction = {
  href: "/contact",
  label: "Contact support",
} as const;

export interface AppraisalCasePresentation {
  readonly action: {
    readonly href: string;
    readonly label: string;
  } | null;
  readonly serviceLabel: string;
  readonly statusLabel: string;
}

type RuntimeAppraisalCase = Omit<AppraisalCase, "serviceType" | "status"> & {
  readonly serviceType: string;
  readonly status: string;
  readonly caseStage?: string;
};

function unsupportedPresentation(
  serviceLabel: string,
): AppraisalCasePresentation {
  return {
    action: contactSupportAction,
    serviceLabel,
    statusLabel: "Status needs review",
  };
}

function totalLossStagePresentation(
  caseId: string,
  caseStage: string,
  needsAttention: boolean,
  caseStatus: string,
  analysisStatus: string | null | undefined,
): AppraisalCasePresentation {
  const continueAction = {
    href: `/start?service=total-loss&view=intake&caseId=${caseId}`,
    label: "Continue review",
  } as const;
  const analysisAction = {
    href: `/total-loss/cases/${caseId}/analysis`,
    label: "View progress",
  } as const;
  const needsAttentionPresentation: AppraisalCasePresentation = {
    action: contactSupportAction,
    serviceLabel: "Total-loss review",
    statusLabel: "Needs attention",
  };

  if (
    needsAttention &&
    caseStage !== "analysis_failed" &&
    caseStage !== "needs_attention"
  ) {
    return needsAttentionPresentation;
  }

  switch (caseStage) {
    case "intake_not_started":
      return {
        action: continueAction,
        serviceLabel: "Total-loss review",
        statusLabel: "Draft",
      };
    case "intake_in_progress":
      return {
        action: continueAction,
        serviceLabel: "Total-loss review",
        statusLabel: "Intake in progress",
      };
    case "report_uploaded":
      return {
        action: continueAction,
        serviceLabel: "Total-loss review",
        statusLabel: "Report uploaded",
      };
    case "report_required":
      return {
        action: continueAction,
        serviceLabel: "Total-loss review",
        statusLabel: "Report needed",
      };
    case "ready_for_analysis":
      return {
        action: { ...analysisAction, label: "Start value check" },
        serviceLabel: "Total-loss review",
        statusLabel: "Ready for value check",
      };
    case "analysis_processing":
      return {
        action: analysisAction,
        serviceLabel: "Total-loss review",
        statusLabel: "Value check in progress",
      };
    case "analysis_failed":
      return {
        action: { ...analysisAction, label: "Review value check" },
        serviceLabel: "Total-loss review",
        statusLabel: "Value check needs attention",
      };
    case "analysis_complete":
      return {
        action: { ...analysisAction, label: "View result" },
        serviceLabel: "Total-loss review",
        statusLabel: "Result ready",
      };
    case "closed":
      return {
        action: null,
        serviceLabel: "Total-loss review",
        statusLabel: "Closed",
      };
    case "needs_attention":
      if (analysisStatus) {
        return {
          action: { ...analysisAction, label: "Review value check" },
          serviceLabel: "Total-loss review",
          statusLabel: "Value check needs attention",
        };
      }
      if (caseStatus === "draft") {
        return {
          action: { ...continueAction, label: "Review intake" },
          serviceLabel: "Total-loss review",
          statusLabel: "Needs attention",
        };
      }
      return needsAttentionPresentation;
    case "submitted":
    default:
      return unsupportedPresentation("Total-loss review");
  }
}

export function appraisalCasePresentation(
  appraisalCase: RuntimeAppraisalCase,
): AppraisalCasePresentation {
  const caseId = encodeURIComponent(appraisalCase.id);

  if (appraisalCase.serviceType === "total_loss") {
    if (
      appraisalCase.status === "closed" ||
      appraisalCase.caseStage === "closed"
    ) {
      return {
        action: appraisalCase.hasTotalLossClaimWorkflow
          ? { href: `/total-loss/cases/${caseId}/claim`, label: "View case history" }
          : null,
        serviceLabel: "Total-loss review",
        statusLabel: "Closed",
      };
    }
    if (appraisalCase.hasTotalLossClaimWorkflow) {
      return {
        action: {
          href: `/total-loss/cases/${caseId}/claim`,
          label: "Open case",
        },
        serviceLabel: "Total-loss review",
        statusLabel: "Claim in progress",
      };
    }
    if (appraisalCase.caseStage) {
      return totalLossStagePresentation(
        caseId,
        appraisalCase.caseStage,
        Boolean(appraisalCase.needsAttention),
        appraisalCase.status,
        appraisalCase.analysisStatus,
      );
    }

    switch (appraisalCase.status) {
      case "draft":
        return {
          action: {
            href: `/start?service=total-loss&view=intake&caseId=${caseId}`,
            label: "Continue review",
          },
          serviceLabel: "Total-loss review",
          statusLabel: "Draft",
        };
      case "checking":
        return {
          action: {
            href: `/total-loss/cases/${caseId}/analysis`,
            label: "View progress",
          },
          serviceLabel: "Total-loss review",
          statusLabel: "Value check in progress",
        };
      case "check_complete":
      case "completed":
        return {
          action: {
            href: `/total-loss/cases/${caseId}/analysis`,
            label: "View result",
          },
          serviceLabel: "Total-loss review",
          statusLabel: "Result ready",
        };
      case "closed":
        return {
          action: null,
          serviceLabel: "Total-loss review",
          statusLabel: "Closed",
        };
      case "submitted":
      case "payment_pending":
      case "paid":
      default:
        return unsupportedPresentation("Total-loss review");
    }
  }

  if (appraisalCase.serviceType === "diminished_value") {
    switch (appraisalCase.status) {
      case "draft":
        return {
          action: {
            href: "/start?service=diminished-value",
            label: "View service update",
          },
          serviceLabel: "Diminished-value request",
          statusLabel: "Draft",
        };
      case "submitted":
        return {
          action: {
            href: "/start?service=diminished-value",
            label: "View service update",
          },
          serviceLabel: "Diminished-value request",
          statusLabel: "Submitted",
        };
      case "closed":
        return {
          action: null,
          serviceLabel: "Diminished-value request",
          statusLabel: "Closed",
        };
      case "checking":
      case "check_complete":
      case "payment_pending":
      case "paid":
      case "completed":
      default:
        return unsupportedPresentation("Diminished-value request");
    }
  }

  return unsupportedPresentation("Vehicle review");
}
