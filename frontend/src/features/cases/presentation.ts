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

export function appraisalCasePresentation(
  appraisalCase: RuntimeAppraisalCase,
): AppraisalCasePresentation {
  const caseId = encodeURIComponent(appraisalCase.id);

  if (appraisalCase.serviceType === "total_loss") {
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
            href: `/start?service=diminished-value&view=intake&caseId=${caseId}`,
            label: "Continue request",
          },
          serviceLabel: "Diminished-value request",
          statusLabel: "Draft",
        };
      case "submitted":
        return {
          action: {
            href: `/start?service=diminished-value&view=intake&caseId=${caseId}`,
            label: "View submitted request",
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
