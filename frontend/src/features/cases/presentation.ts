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

function postContinuePresentation(
  caseId: string,
  task: string,
): AppraisalCasePresentation {
  const resumeAction = (label: string) => ({
    href: `/total-loss/cases/${caseId}/claim`,
    label,
  });
  switch (task) {
    case "secure_claim":
      return {
        action: resumeAction("Secure claim"),
        serviceLabel: "Total-loss review",
        statusLabel: "Secure claim",
      };
    case "continue_payment":
      return {
        action: resumeAction("Continue payment"),
        serviceLabel: "Total-loss review",
        statusLabel: "Continue payment",
      };
    case "preparing_report":
      return {
        action: resumeAction("View progress"),
        serviceLabel: "Total-loss review",
        statusLabel: "Preparing report",
      };
    case "review_report":
      return {
        action: resumeAction("Review report"),
        serviceLabel: "Total-loss review",
        statusLabel: "Review report",
      };
    case "prepare_request":
      return {
        action: resumeAction("Prepare request"),
        serviceLabel: "Total-loss review",
        statusLabel: "Prepare request",
      };
    case "waiting_for_insurer":
      return {
        action: resumeAction("View request"),
        serviceLabel: "Total-loss review",
        statusLabel: "Waiting for insurer",
      };
    case "review_complete":
      return {
        action: resumeAction("Review result"),
        serviceLabel: "Total-loss review",
        statusLabel: "Review complete",
      };
    case "needs_attention":
      return {
        action: resumeAction("Review status"),
        serviceLabel: "Total-loss review",
        statusLabel: "Needs attention",
      };
    default:
      return unsupportedPresentation("Total-loss review");
  }
}

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
    if (appraisalCase.claimResumeTask) {
      return postContinuePresentation(caseId, appraisalCase.claimResumeTask);
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
